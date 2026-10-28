'use strict';

/**
 * 测试用的假 IMA OpenAPI 服务。
 *
 * 只实现日记模块用到的 notes 接口，让 CLI / service 能真实地走一遍
 * `ima_api.cjs` 子进程 + HTTP 请求，而不需要真实凭证。
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

// 仓库跟踪的上游 ima-skill（版本号用于模拟 check_skill_update）
const UPSTREAM_META = path.resolve(__dirname, '../../../ima-skill/meta.json');

function skillVersion() {
  try {
    return JSON.parse(fs.readFileSync(UPSTREAM_META, 'utf8')).version;
  } catch {
    return '1.1.10';
  }
}

function markdownToBlocks(markdown) {
  return String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) return { type: `h${heading[1].length}`, children: [{ text: heading[2] }] };
      if (line.startsWith('>')) return { type: 'blockquote', children: [{ text: line.replace(/^>\s?/, '') }] };
      if (line.startsWith('- ')) return { type: 'bulleted_list', children: [{ text: line.slice(2) }] };
      return { type: 'p', children: [{ text: line }] };
    });
}

function summarize(content) {
  return String(content || '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function createState() {
  return {
    notes: [],
    folders: [
      { folder_id: 'root_all', name: '全部笔记', folder_type: 1, create_time: 0, modify_time: 0 },
      { folder_id: 'folder_diary', name: '日记', folder_type: 0, create_time: 1, modify_time: 1 },
      { folder_id: 'folder_work', name: '工作', folder_type: 0, create_time: 2, modify_time: 2 },
    ],
    requests: [],
    failImport: null,
    failAppend: null,
    searchLagMs: 0,
    clock: Date.UTC(2026, 9, 28, 0, 0, 0),
    counter: 0,
  };
}

function startFakeIma(options = {}) {
  const state = createState();
  const latestVersion = options.latestVersion || skillVersion();

  const tick = () => {
    state.clock += 1000;
    return state.clock;
  };

  const info = (note) => ({
    note_id: note.note_id,
    title: note.title,
    summary: note.summary || '',
    create_time: note.create_time,
    modify_time: note.modify_time,
    cover_image: '',
    note_ext_info: { folder_id: note.folder_id || '', folder_name: '' },
  });

  const sorted = () => [...state.notes].sort((a, b) => b.modify_time - a.modify_time);

  const routes = {
    'openapi/check_skill_update': () => ({
      code: 0,
      msg: '',
      data: { latest_version: latestVersion, release_desc: '', instruction: '' },
    }),

    'openapi/note/v1/search_note': (body) => {
      const query = body.query_info || {};
      const byContent = body.search_type === 1;
      const needle = String((byContent ? query.content : query.title) || '');
      const cutoff = state.clock - state.searchLagMs;
      const hits = sorted().filter((note) => {
        if (state.searchLagMs > 0 && note.create_time > cutoff) return false; // 模拟索引延迟
        return byContent ? String(note.content || '').includes(needle) : String(note.title || '').includes(needle);
      });
      const start = Number(body.start) || 0;
      const end = Math.min(Number(body.end) || start + 20, start + 20);
      return {
        code: 0,
        msg: '',
        data: {
          search_note_infos: hits
            .slice(start, end)
            .map((note) => ({ note_book_info: info(note), highlightInfo: {} })),
          is_end: end >= hits.length,
          total_hit_num: hits.length,
        },
      };
    },

    'openapi/note/v1/list_note': (body) => {
      const offset = Number(body.cursor) || 0;
      const limit = Math.min(Number(body.limit) || 20, 20);
      const all = sorted();
      return {
        code: 0,
        msg: '',
        data: {
          note_book_list: all.slice(offset, offset + limit).map(info),
          is_end: offset + limit >= all.length,
        },
      };
    },

    'openapi/note/v1/list_notebook': () => ({
      code: 0,
      msg: '',
      data: {
        note_folder_infos: state.folders.map((folder) => ({
          ...folder,
          note_number: state.notes.filter((note) => note.folder_id === folder.folder_id).length,
        })),
        next_cursor: '',
        is_end: true,
      },
    }),

    'openapi/note/v1/import_doc': (body) => {
      if (state.failImport) return { code: state.failImport.code, msg: state.failImport.msg, data: {} };
      const content = String(body.content || '');
      const heading = /^#\s+(.+)$/m.exec(content);
      const now = tick();
      state.counter += 1;
      const note = {
        note_id: `note_${state.counter}`,
        title: heading ? heading[1].trim() : '',
        summary: summarize(content),
        content,
        folder_id: body.folder_id || '',
        create_time: now,
        modify_time: now,
      };
      state.notes.push(note);
      return { code: 0, msg: '', data: { note_id: note.note_id } };
    },

    'openapi/note/v1/append_doc': (body) => {
      if (state.failAppend) return { code: state.failAppend.code, msg: state.failAppend.msg, data: {} };
      const note = state.notes.find((item) => item.note_id === body.note_id);
      if (!note) return { code: 100006, msg: '笔记已删除', data: {} };
      note.content += String(body.content || '');
      note.summary = summarize(note.content);
      note.modify_time = tick();
      return { code: 0, msg: '', data: { note_id: note.note_id } };
    },

    'openapi/note/v1/get_doc_content': (body) => {
      const note = state.notes.find((item) => item.note_id === body.note_id);
      if (!note) return { code: 100006, msg: '笔记已删除', data: {} };
      const content =
        body.target_content_format === 2 ? JSON.stringify(markdownToBlocks(note.content)) : note.content;
      return { code: 0, msg: '', data: { content } };
    },
  };

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }

    const api = new URL(request.url, 'http://localhost').pathname.replace(/^\//, '');
    state.requests.push({ api, body });

    const send = (payload) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    const handler = routes[api];
    if (!handler) {
      send({ code: 210001, msg: `假 IMA 未实现接口：${api}`, data: {} });
      return;
    }
    try {
      send(handler(body));
    } catch (error) {
      send({ code: 210003, msg: `假 IMA 内部错误：${error.message}`, data: {} });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        state,
        notes: state.notes,
        requests: state.requests,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { startFakeIma, skillVersion };
