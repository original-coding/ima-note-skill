#!/usr/bin/env node
'use strict';

/**
 * IMA 日记命令行：一天一篇笔记，标题为 YYYY-MM-DD。
 *
 * 用法见 `node diary.cjs help`；对 agent 的完整说明见同目录的 SKILL.md。
 *
 * 输出约定（与 ima-skill 一致）：
 *   - 成功：结果写到 stdout，退出码 0
 *   - 失败：stderr 输出 {"code": <number>, "msg": "<说明>"}，退出码 1
 */

const fs = require('fs');
const path = require('path');
const { DiaryError, ERR_UPDATE_AVAILABLE } = require('./lib/errors.cjs');
const { DEFAULT_FOLDER, loadConfig, validateTimeZone } = require('./lib/config.cjs');
const { createImaClient, describeImaSkill } = require('./lib/ima.cjs');
const { DiaryService } = require('./lib/service.cjs');
const core = require('./lib/core.cjs');

const DIARY_VERSION = '1.0.0';
const SKILL_ROOT = path.resolve(__dirname, '..');

const BOOLEAN_FLAGS = new Set([
  'json',
  'dry-run',
  'force',
  'week',
  'help',
  'version',
  'quiet',
]);

const HELP = `IMA 日记（一天一篇，标题 YYYY-MM-DD）

依赖：已安装 ima-skills（脚本会通过 IMA_SKILL_DIR / 同级目录 / 常见 skills 目录定位它）
说明：本技能只在显式调用时使用；日常“记一下”类请求请交给 notes 或先与用户确认。

用法：
  diary.cjs <命令> [参数]

命令：
  write    写日记（不存在当天笔记则新建，存在则追加）
             --date <today|yesterday|前天|2026-10-28>   默认今天
             --time <HH:mm>                              默认当前时间
             --content <文本> | --content-file <路径> | 管道输入
             --mood <心情> --weather <天气> --tags <标签,标签>
             --dry-run                                   只预览，不写入
  read     查看某天日记        --date <日期>
  list     看区间内哪些天写了   --days <N>（默认 7）| --month YYYY-MM | --from/--to
  search   在日记正文里搜索     <关键词> [--days N] [--limit N]
  review   汇总区间日记正文     --week | --month YYYY-MM | --from/--to | --days N
  export   导出为本地 md 文件   --out <目录> [--force] [--month|--from/--to|--days]
  check    检查凭证与「日记」笔记本配置

通用参数：
  --folder <名称>    目标笔记本（默认「日记」；传空字符串表示不指定）
  --tz <时区>        覆盖时区（如 Asia/Shanghai）
  --json             以 JSON 输出结果
  --config <路径>    指定日记配置文件（默认 ~/.config/ima/diary.json）

示例：
  node diary.cjs write --content "今天把日记 skill 跑通了" --mood 开心
  node diary.cjs write --date yesterday --content-file /tmp/diary.md
  node diary.cjs list --month 2026-10
  node diary.cjs review --week
  node diary.cjs export --month 2026-10 --out ~/diary
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags, positional };
}

function readSkillMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'meta.json'), 'utf8'));
  } catch {
    return { name: 'ima-diary', version: 'unknown' };
  }
}

function readTextFileUtf8(file) {
  const target = path.resolve(file);
  let buffer;
  try {
    buffer = fs.readFileSync(target);
  } catch (error) {
    throw new DiaryError(-100, `读取文件失败：${target}（${error.message}）`);
  }
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new DiaryError(
      -100,
      `文件不是合法 UTF-8：${target}。请先转码后重试，例如：iconv -f gbk -t utf-8 原文件 > /tmp/diary-utf8.md`,
    );
  }
  return text;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new DiaryError(-100, '标准输入不是合法 UTF-8，请转码后重试');
  }
  return text;
}

function clockInTz(ms, timeZone) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const { type, value } of formatter.formatToParts(date)) {
    if (type !== 'literal') parts[type] = value;
  }
  return `${parts.hour || '00'}:${parts.minute || '00'}`;
}

function buildService(flags) {
  if (flags.config !== undefined && flags.config !== true) {
    process.env.IMA_DIARY_CONFIG = String(flags.config);
  }
  const config = loadConfig(process.env);

  if (Object.prototype.hasOwnProperty.call(flags, 'folder')) {
    config.folder = flags.folder === true ? DEFAULT_FOLDER : String(flags.folder);
  }
  if (Object.prototype.hasOwnProperty.call(flags, 'tz')) {
    config.timeZone = flags.tz === true ? '' : flags.tz;
    if (config.timeZone) config.timeZone = validateTimeZone(config.timeZone);
  }

  const now = core.parseNow(flags.now || process.env.IMA_DIARY_NOW);
  const warn = (message) => {
    if (!flags.quiet) process.stderr.write(`[warn] ${message}\n`);
  };

  const client = createImaClient({ imaSkillDir: config.imaSkillDir });
  return new DiaryService({
    call: client.call,
    config,
    now,
    warn,
  });
}

function resolveRangeFromFlags(flags, service) {
  const today = service.todayYmd();
  if (flags.week) {
    const range = core.weekRange(today);
    // 本周还没过完时，只统计到今天，避免"未来几天没写"的噪声
    return { from: range.from, to: range.to > today ? today : range.to };
  }
  return core.resolveRange({
    days: flags.days,
    month: flags.month,
    from: flags.from,
    to: flags.to,
    today,
  });
}

async function readContent(flags) {
  if (flags.content !== undefined && flags['content-file'] !== undefined) {
    throw new DiaryError(-100, '--content 和 --content-file 只能选一个');
  }
  if (flags['content-file'] !== undefined) {
    return readTextFileUtf8(String(flags['content-file']));
  }
  if (flags.content !== undefined) {
    return flags.content === true ? '' : String(flags.content);
  }
  if (!process.stdin.isTTY) return readStdin();
  throw new DiaryError(-100, '缺少日记正文：用 --content、--content-file 或管道输入');
}

async function cmdWrite(flags, _positionals, service) {
  const date = core.resolveDateInput(flags.date, { today: service.todayYmd() });
  const time = flags.time === undefined ? service.currentTime() : core.validateTime(flags.time);
  const content = await readContent(flags);

  const result = await service.write({
    date,
    time,
    content,
    weather: typeof flags.weather === 'string' ? flags.weather : '',
    mood: typeof flags.mood === 'string' ? flags.mood : '',
    tags: typeof flags.tags === 'string' ? flags.tags : '',
    dryRun: Boolean(flags['dry-run']),
  });

  if (flags.json) {
    return { json: { ok: true, command: 'write', ...result } };
  }

  if (result.dryRun) {
    const action = result.wouldCreate ? `将新建 ${result.date} 的日记` : `将追加到 ${result.date} 的日记`;
    return {
      text: `— 预览（不会写入）—\n${action}：\n\n${String(result.markdown).replace(/^\n+/, '')}`,
    };
  }

  return { text: `已记入 ${result.date} 日记（${result.time}）` };
}

async function cmdRead(flags, _positionals, service) {
  const date = core.resolveDateInput(flags.date, { today: service.todayYmd() });
  const result = await service.read(date);

  if (flags.json) {
    return { json: { ok: true, command: 'read', ...result } };
  }
  if (!result.found) {
    return { text: `${date} 还没有日记。` };
  }
  return { text: `📔 ${core.formatDayLabel(date)}\n\n${result.content.trim()}` };
}

async function cmdList(flags, _positionals, service) {
  const range = resolveRangeFromFlags(flags, service);
  const result = await service.list(range);

  if (flags.json) {
    return { json: { ok: true, command: 'list', ...result } };
  }

  const lines = [
    `📔 ${result.from} ~ ${result.to}（${result.days.length} 天，已写 ${result.writtenDays} 天）`,
    '',
  ];
  for (const day of result.days) {
    if (day.written) {
      lines.push(`✓ ${core.formatDayLabel(day.date)}  ${clockInTz(day.modifyTime, service.timeZone)} 更新`);
    } else {
      lines.push(`· ${core.formatDayLabel(day.date)}  未写`);
    }
  }
  return { text: lines.join('\n') };
}

async function cmdSearch(flags, positionals, service) {
  const query = positionals.slice(1).join(' ').trim();
  if (!query) throw new DiaryError(-100, '请提供搜索关键词，例如：diary.cjs search 跑步');

  const result = await service.search(query, {
    days: flags.days,
    limit: Number(flags.limit) || 20,
  });

  if (flags.json) {
    return { json: { ok: true, command: 'search', ...result } };
  }
  if (!result.hits.length) {
    return { text: `没有找到包含「${query}」的日记。` };
  }

  const lines = [`🔍 在日记中搜索「${query}」：${result.hits.length} 条`];
  for (const hit of result.hits) {
    const summary = hit.summary ? `  ${hit.summary.replace(/\s+/g, ' ').slice(0, 80)}` : '';
    lines.push(`✓ ${core.formatDayLabel(hit.date)}${summary}`);
  }
  if (result.truncated) lines.push('（结果过多已截断，请缩小搜索范围）');
  return { text: lines.join('\n') };
}

async function cmdReview(flags, _positionals, service) {
  const range = resolveRangeFromFlags(flags, service);
  const result = await service.review(range);

  if (flags.json) {
    return { json: { ok: true, command: 'review', ...result } };
  }
  if (!result.entries.length) {
    return { text: `${result.from} ~ ${result.to} 期间的日记还是空的。` };
  }
  return { text: result.markdown.trimEnd() };
}

async function cmdExport(flags, _positionals, service) {
  const range = resolveRangeFromFlags(flags, service);
  if (!flags.out || flags.out === true) throw new DiaryError(-100, '请用 --out 指定导出目录');
  const result = await service.exportToDir(range, String(flags.out), { force: Boolean(flags.force) });

  if (flags.json) {
    return { json: { ok: true, command: 'export', ...result } };
  }

  const parts = [`已导出 ${result.written.length} 篇到 ${result.outDir}`];
  if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 篇已存在的文件（--force 可覆盖）`);
  if (result.empty.length) parts.push(`${result.empty.length} 天没有日记`);
  return { text: parts.join('，') };
}

async function cmdCheck(flags, _positionals, service) {
  const result = await service.check();

  if (flags.json) {
    const meta = readSkillMeta();
    return { json: { ok: true, command: 'check', diaryVersion: meta.version || DIARY_VERSION, ...result } };
  }

  const lines = [
    `🔗 ${result.imaSkill.version ? `ima-skill ${result.imaSkill.version}（${result.imaSkill.path}）` : `ima-skill（${result.imaSkill.path}）`}`,
    '✅ IMA 凭证可用',
    result.folder
      ? result.folderFound
        ? `📔 日记笔记本：「${result.folder}」`
        : `⚠️ 没有找到「${result.folder}」笔记本：写入会失败，请先在 IMA 中创建同名笔记本`
      : '📔 未指定日记笔记本，日记写到默认位置',
    '📚 可用笔记本：',
  ];
  if (!result.notebooks.length) lines.push('  （没有读到笔记本，可能只有未分类笔记）');
  for (const item of result.notebooks.slice(0, 20)) {
    lines.push(`  · ${item.name}（${item.noteNumber} 篇）`);
  }
  return { text: lines.join('\n') };
}

const COMMANDS = {
  write: cmdWrite,
  read: cmdRead,
  list: cmdList,
  search: cmdSearch,
  review: cmdReview,
  export: cmdExport,
  check: cmdCheck,
};

async function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgs(argv);

  if (flags.version) {
    const meta = readSkillMeta();
    let imaSkillDir = '';
    try {
      imaSkillDir = loadConfig(process.env).imaSkillDir;
    } catch {
      // 配置文件损坏时 --version 仍应可用
    }
    const ima = describeImaSkill({ imaSkillDir });
    const imaLabel = ima.ok ? `ima-skill ${ima.version || 'unknown'}（${ima.dir}）` : 'ima-skill 未找到';
    process.stdout.write(`${meta.name || 'ima-diary'} ${meta.version || DIARY_VERSION} · ${imaLabel}\n`);
    return 0;
  }

  const command = positional[0];
  if (flags.help || !command || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    throw new DiaryError(-100, `未知命令：${command}（可用：${Object.keys(COMMANDS).join(' / ')}）`);
  }

  const service = buildService(flags);
  const result = await handler(flags, positional, service);

  if (result && result.json) {
    process.stdout.write(`${JSON.stringify(result.json)}\n`);
  } else if (result && result.text) {
    process.stdout.write(`${result.text}\n`);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const code = error instanceof DiaryError ? error.code : -100;
      let message = error && error.message ? error.message : String(error);
      if (code === ERR_UPDATE_AVAILABLE) {
        message = `${message}（技能需要先与上游 ima-skills 同步，更新后重试）`;
      }
      process.stderr.write(`${JSON.stringify({ code, msg: message })}\n`);
      process.exitCode = 1;
    });
}

module.exports = { main, parseArgs, HELP, DIARY_VERSION };
