'use strict';

/**
 * 日记业务层：一天一篇笔记（标题 = YYYY-MM-DD），当天重复记录按时间追加。
 *
 * 所有网络访问都通过注入的 `call(apiPath, body)` 完成，便于用假 IMA 服务测试。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DiaryError } = require('./errors.cjs');
const { checkCredentials } = require('./config.cjs');
const { describeImaSkill, IMA_MISSING_MESSAGE } = require('./ima.cjs');
const { renderNoteContent } = require('./render.cjs');
const {
  addDays,
  composeAppend,
  composeNewNote,
  currentTime,
  dateFromTitle,
  enumerateRange,
  formatEntry,
  formatDayLabel,
  todayYmd,
  weekdayCn,
} = require('./core.cjs');

const NOTE_API = 'openapi/note/v1';
const SEARCH_PAGE = 20;
const MAX_SEARCH_START = 200;
// 搜索索引有分钟级延迟：写入前先看最近 20 条笔记，避免同一天重复新建
const RECENT_SCAN_LIMIT = 20;

/** 去掉正文开头的 `# YYYY-MM-DD`，避免与 review 的日期小标题重复。 */
function stripDayHeader(content, date) {
  const lines = content.trim().split('\n');
  if (lines[0] && lines[0].trim() === `# ${date}`) {
    return lines.slice(1).join('\n').replace(/^\n+/, '').trim();
  }
  return content.trim();
}

class DiaryService {
  constructor({ call, config = {}, now = new Date(), warn = () => {}, env = process.env }) {
    if (typeof call !== 'function') throw new TypeError('DiaryService 需要 call(apiPath, body) 函数');
    this.call = call;
    this.config = config;
    this.now = now;
    this.warn = warn;
    this.env = env;
    this._noteCache = new Map();
    this._recentNotes = null;
    this._notebooks = null;
    this._folderResolved = false;
    this.folderId = null;
  }

  get timeZone() {
    return this.config.timeZone || '';
  }

  get folderName() {
    return this.config.folder || '';
  }

  todayYmd() {
    return todayYmd(this.timeZone, this.now);
  }

  currentTime() {
    return currentTime(this.timeZone, this.now);
  }

  async listNotebooks() {
    if (this._notebooks) return this._notebooks;
    const all = [];
    let cursor = '0';
    let pages = 0;
    for (;;) {
      const data = await this.call(`${NOTE_API}/list_notebook`, { cursor, limit: 20 });
      const list = data.note_folder_infos || [];
      all.push(...list);
      pages += 1;
      const next = data.next_cursor;
      if (data.is_end || !list.length || !next || pages >= 50) break;
      cursor = next;
    }
    this._notebooks = all;
    return all;
  }

  async resolveFolderId() {
    if (this._folderResolved) return this.folderId;
    this._folderResolved = true;
    if (!this.folderName) return null;

    const notebooks = await this.listNotebooks();
    const match = notebooks.find((item) => item.name === this.folderName);
    if (!match) return null;
    this.folderId = match.folder_id;
    return this.folderId;
  }

  /** 配置了笔记本时必须能找到；找不到就报错，绝不写到别的地方。 */
  async requireFolderId() {
    if (!this.folderName) return null;
    const folderId = await this.resolveFolderId();
    if (!folderId) {
      throw new DiaryError(
        -100,
        `未找到名为「${this.folderName}」的笔记本，本次未写入。请先在 IMA 中创建同名笔记本，或修改 ~/.config/ima/diary.json 的 folder`,
      );
    }
    return folderId;
  }

  rankNotes(notes) {
    return [...notes].sort((a, b) => (Number(a.create_time) || 0) - (Number(b.create_time) || 0));
  }

  isInFolder(note, folderId) {
    return Boolean(folderId) && note.note_ext_info && note.note_ext_info.folder_id === folderId;
  }

  /**
   * 按标题精确查找某天的日记。找不到返回 null。
   * 标题必须是纯日期；同一天多篇时优先「日记」笔记本内、创建时间最早的一篇。
   */
  /** 最近修改的笔记（按修改时间倒序）。用于兜住 search_note 的索引延迟。 */
  async getRecentNotes() {
    if (this._recentNotes) return this._recentNotes;
    const data = await this.call(`${NOTE_API}/list_note`, {
      folder_id: '',
      sort_type: 0,
      cursor: '',
      limit: RECENT_SCAN_LIMIT,
    });
    this._recentNotes = data.note_book_list || [];
    return this._recentNotes;
  }

  async findNote(ymd) {
    if (this._noteCache.has(ymd)) return this._noteCache.get(ymd);

    const folderId = await this.requireFolderId();
    const keep = (note) =>
      String(note.title || '').trim() === ymd && (!folderId || this.isInFolder(note, folderId));

    const matches = [];

    // 先查最近笔记：刚写入的笔记可能还没进搜索索引
    for (const note of await this.getRecentNotes()) {
      if (keep(note)) matches.push(note);
    }

    let start = 0;
    while (!matches.length) {
      const data = await this.call(`${NOTE_API}/search_note`, {
        search_type: 0,
        sort_type: 0,
        query_info: { title: ymd },
        start,
        end: start + SEARCH_PAGE,
      });
      const infos = data.search_note_infos || [];
      for (const info of infos) {
        const note = info && info.note_book_info;
        if (!note) continue;
        if (keep(note)) matches.push(note);
      }
      if (matches.length || data.is_end || !infos.length) break;
      start += SEARCH_PAGE;
      if (start >= MAX_SEARCH_START) break;
    }

    if (!matches.length) {
      this._noteCache.set(ymd, null);
      return null;
    }

    const ranked = this.rankNotes(matches);
    this._noteCache.set(ymd, ranked[0]);
    return ranked[0];
  }

  /**
   * 写入一条日记。存在当天笔记 → append；不存在 → import_doc 新建。
   * dryRun=true 时只返回将要写入的 Markdown，不产生写请求。
   */
  async write({ date, time, content, weather, mood, tags, dryRun = false }) {
    const entry = formatEntry({ time, content, weather, mood, tags });
    const existing = await this.findNote(date);

    if (dryRun) {
      const folderId = existing ? null : await this.requireFolderId();
      return {
        date,
        time,
        dryRun: true,
        wouldCreate: !existing,
        noteId: existing ? existing.note_id : null,
        markdown: existing ? composeAppend(entry) : composeNewNote(date, entry),
        folder: this.folderName || null,
        folderId,
      };
    }

    if (existing) {
      await this.call(`${NOTE_API}/append_doc`, {
        note_id: existing.note_id,
        content_format: 1,
        content: composeAppend(entry),
      });
      return { date, time, created: false, noteId: existing.note_id, folder: this.folderName || null };
    }

    const folderId = await this.requireFolderId();
    const body = { content_format: 1, content: composeNewNote(date, entry) };
    if (folderId) body.folder_id = folderId;

    const data = await this.call(`${NOTE_API}/import_doc`, body);
    if (!data.note_id) throw new DiaryError(-100, 'IMA 没有返回新笔记 ID，请稍后重试');

    const created = {
      note_id: data.note_id,
      title: date,
      create_time: Date.now(),
      modify_time: Date.now(),
      note_ext_info: folderId ? { folder_id: folderId } : {},
    };
    this._noteCache.set(date, created);
    if (this._recentNotes) this._recentNotes.unshift(created);
    return { date, time, created: true, noteId: data.note_id, folder: this.folderName || null };
  }

  /**
   * 读取笔记正文。优先用 JSON 格式（保留标题/段落），失败或为空时回退纯文本。
   * 纯文本格式在真实 API 上会把换行吃掉，不适合直接展示。
   */
  async getNoteBody(noteId) {
    try {
      const data = await this.call(`${NOTE_API}/get_doc_content`, {
        note_id: noteId,
        target_content_format: 2,
      });
      const rendered = renderNoteContent(data.content);
      if (rendered.trim()) return rendered;
    } catch {
      // 回退到纯文本
    }
    const data = await this.call(`${NOTE_API}/get_doc_content`, {
      note_id: noteId,
      target_content_format: 0,
    });
    return String(data.content ?? '');
  }

  async read(date) {
    const note = await this.findNote(date);
    if (!note) return { date, found: false };
    return {
      date,
      found: true,
      noteId: note.note_id,
      title: note.title,
      modifyTime: Number(note.modify_time) || null,
      content: await this.getNoteBody(note.note_id),
    };
  }

  async collectRange(from, to) {
    const days = [];
    for (const date of enumerateRange(from, to)) {
      const note = await this.findNote(date);
      days.push({ date, note });
    }
    return days;
  }

  async list({ from, to }) {
    const days = [];
    for (const { date, note } of await this.collectRange(from, to)) {
      days.push({
        date,
        weekday: weekdayCn(date),
        written: Boolean(note),
        noteId: note ? note.note_id : null,
        modifyTime: note ? Number(note.modify_time) || null : null,
      });
    }
    return {
      from,
      to,
      days,
      writtenDays: days.filter((day) => day.written).length,
      missingDays: days.filter((day) => !day.written).map((day) => day.date),
    };
  }

  async search(query, { days, limit = 20 } = {}) {
    const minDate = days ? addDays(this.todayYmd(), -(days - 1)) : null;
    const hits = [];
    let start = 0;
    let truncated = false;

    while (hits.length < limit) {
      const data = await this.call(`${NOTE_API}/search_note`, {
        search_type: 1,
        sort_type: 0,
        query_info: { content: query },
        start,
        end: start + SEARCH_PAGE,
      });
      const infos = data.search_note_infos || [];
      for (const info of infos) {
        const note = info && info.note_book_info;
        if (!note) continue;
        const date = dateFromTitle(note.title);
        if (!date) continue;
        if (minDate && date < minDate) continue;
        hits.push({
          date,
          noteId: note.note_id,
          title: note.title,
          summary: note.summary || '',
          modifyTime: Number(note.modify_time) || null,
        });
        if (hits.length >= limit) break;
      }
      if (data.is_end || !infos.length) break;
      start += SEARCH_PAGE;
      if (start >= MAX_SEARCH_START) {
        truncated = true;
        break;
      }
    }

    return { query, hits, truncated };
  }

  async review({ from, to }) {
    const entries = [];
    const missing = [];
    for (const date of enumerateRange(from, to)) {
      const note = await this.findNote(date);
      if (!note) {
        missing.push(date);
        continue;
      }
      entries.push({
        date,
        weekday: weekdayCn(date),
        content: stripDayHeader(await this.getNoteBody(note.note_id), date),
      });
    }

    const markdown = entries
      .map((entry) => `## ${formatDayLabel(entry.date)}\n\n${entry.content}\n`)
      .join('\n');

    return { from, to, entries, missing, markdown };
  }

  async exportToDir({ from, to }, outDir, { force = false } = {}) {
    if (!outDir) throw new DiaryError(-100, '导出目录不能为空');
    const targetDir = path.resolve(String(outDir).replace(/^~(?=$|[\\/])/, os.homedir()));
    fs.mkdirSync(targetDir, { recursive: true });

    const written = [];
    const skipped = [];
    const empty = [];

    for (const date of enumerateRange(from, to)) {
      const note = await this.findNote(date);
      if (!note) {
        empty.push(date);
        continue;
      }
      const file = path.join(targetDir, `${date}.md`);
      if (fs.existsSync(file) && !force) {
        skipped.push(date);
        continue;
      }
      const text = (await this.getNoteBody(note.note_id)).trim();
      const body = new RegExp(`^#\\s+${date}`).test(text) ? text : `# ${date}\n\n${text}`;
      fs.writeFileSync(file, `${body}\n`, 'utf8');
      written.push(date);
    }

    return { from, to, outDir: targetDir, written, skipped, empty };
  }

  async check() {
    const ima = describeImaSkill({ env: this.env, imaSkillDir: this.config.imaSkillDir });
    if (!ima.ok) throw new DiaryError(-100, IMA_MISSING_MESSAGE);

    const credentials = checkCredentials(this.env);
    if (!credentials.ok) {
      throw new DiaryError(
        -100,
        `未找到 IMA 凭证（${credentials.missing.join('、')}）。请到 https://ima.qq.com/agent-interface 获取，然后写入 ~/.config/ima/client_id 与 ~/.config/ima/api_key，或设置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY 环境变量`,
      );
    }

    const notebooks = await this.listNotebooks();
    const folderId = await this.resolveFolderId();
    return {
      credentials: 'ok',
      imaSkill: { path: ima.dir, version: ima.version },
      folder: this.folderName || null,
      folderId,
      folderFound: this.folderName ? Boolean(folderId) : true,
      notebooks: notebooks.map((item) => ({
        name: item.name,
        noteNumber: Number(item.note_number) || 0,
        folderType: item.folder_type,
      })),
    };
  }
}

module.exports = { DiaryService, NOTE_API };
