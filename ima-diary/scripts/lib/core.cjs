'use strict';

/**
 * 日记模块的纯逻辑：日期换算、区间解析、日记正文排版。
 *
 * 这里不做任何 I/O，全部函数都可以单独测试；需要网络的部分见 service.cjs。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 7;

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const RELATIVE_DAYS = new Map([
  ['today', 0],
  ['今天', 0],
  ['tonight', 0],
  ['yesterday', -1],
  ['昨天', -1],
  ['前天', -2],
  ['tomorrow', 1],
  ['明天', 1],
  ['后天', 2],
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isYmd(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [, y, m, d] = DATE_RE.exec(value);
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() === Number(m) - 1 &&
    dt.getUTCDate() === Number(d)
  );
}

function assertYmd(value, label = '日期') {
  if (!isYmd(value)) {
    throw new RangeError(`${label}必须是 YYYY-MM-DD 格式的有效日期，收到：${String(value)}`);
  }
  return value;
}

function ymdToUtcMs(ymd) {
  const [, y, m, d] = DATE_RE.exec(assertYmd(ymd));
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function utcMsToYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(ymd, delta) {
  return utcMsToYmd(ymdToUtcMs(ymd) + delta * 86400000);
}

function diffDays(from, to) {
  return Math.round((ymdToUtcMs(to) - ymdToUtcMs(from)) / 86400000);
}

function weekdayCn(ymd) {
  return WEEKDAY_CN[new Date(ymdToUtcMs(ymd)).getUTCDay()];
}

/**
 * 解析当前时间（可注入，便于测试/补记）：优先 IMA_DIARY_NOW，其次系统时间。
 */
function parseNow(raw) {
  if (raw === undefined || raw === null || raw === '') return new Date();
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) {
    throw new RangeError(`IMA_DIARY_NOW 不是合法时间：${String(raw)}`);
  }
  return dt;
}

function zonedParts(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const { type, value } of formatter.formatToParts(now)) {
    if (type !== 'literal') parts[type] = value;
  }
  return parts;
}

/**
 * 指定时区的“今天”。timeZone 为空时使用进程本地时区。
 */
function todayYmd(timeZone, now = new Date()) {
  if (!timeZone) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentTime(timeZone, now = new Date()) {
  if (!timeZone) return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const parts = zonedParts(now, timeZone);
  return `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

function normalizeDateText(raw) {
  const text = String(raw).trim();
  const normalized = text.replace(/[/.]/g, '-');
  if (DATE_RE.test(normalized)) return normalized;
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }
  return null;
}

/**
 * 把 --date 的输入解析为 YYYY-MM-DD。
 * 支持：today/今天、yesterday/昨天、前天、tomorrow/明天、后天、-1 这类相对天数、2026-10-28。
 */
function resolveDateInput(input, { today } = {}) {
  const fallbackToday = today || todayYmd();
  if (input === undefined || input === null || input === '') return fallbackToday;

  const text = String(input).trim();
  if (RELATIVE_DAYS.has(text.toLowerCase())) return addDays(fallbackToday, RELATIVE_DAYS.get(text.toLowerCase()));
  if (/^[+-]\d{1,3}$/.test(text)) return addDays(fallbackToday, Number(text));

  const normalized = normalizeDateText(text);
  if (normalized) return assertYmd(normalized, '日期');
  throw new RangeError(
    `无法识别的日期：${text}（支持 today / yesterday / 前天 / -1 / 2026-10-28 这类写法）`,
  );
}

function monthRange(month) {
  const match = MONTH_RE.exec(String(month).trim());
  if (!match) throw new RangeError(`月份必须是 YYYY-MM 格式，收到：${String(month)}`);
  const year = Number(match[1]);
  const index = Number(match[2]);
  if (index < 1 || index > 12) throw new RangeError(`月份不合法：${String(month)}`);
  const from = `${match[1]}-${match[2]}-01`;
  const to = utcMsToYmd(Date.UTC(year, index, 0));
  return { from, to };
}

/** 本周一至本周日（ISO 周）。 */
function weekRange(today) {
  const day = new Date(ymdToUtcMs(today)).getUTCDay();
  const offset = (day + 6) % 7;
  const from = addDays(today, -offset);
  return { from, to: addDays(from, 6) };
}

function enumerateRange(from, to, maxDays = MAX_RANGE_DAYS) {
  assertYmd(from, '起始日期');
  assertYmd(to, '结束日期');
  const span = diffDays(from, to);
  if (span < 0) throw new RangeError(`起始日期 ${from} 晚于结束日期 ${to}`);
  if (span + 1 > maxDays) {
    throw new RangeError(`日期区间过长（${span + 1} 天），单次最多 ${maxDays} 天，请分段处理`);
  }
  const days = [];
  for (let i = 0; i <= span; i += 1) days.push(addDays(from, i));
  return days;
}

/**
 * 把 list / review / export 的区间参数归一化为 {from, to}。
 * 优先级：--from/--to > --month > --days（默认最近 7 天，含今天）。
 */
function resolveRange({ days, month, from, to, today }) {
  if (from || to) {
    if (!from || !to) throw new RangeError('--from 和 --to 需要同时提供');
    const start = resolveDateInput(from, { today });
    const end = resolveDateInput(to, { today });
    enumerateRange(start, end);
    return { from: start, to: end };
  }
  if (month) return monthRange(month);

  let span = Number(days ?? DEFAULT_RANGE_DAYS);
  if (!Number.isInteger(span) || span < 1) throw new RangeError(`--days 需要是正整数，收到：${String(days)}`);
  if (span > MAX_RANGE_DAYS) throw new RangeError(`--days 最多 ${MAX_RANGE_DAYS}`);
  return { from: addDays(today, -(span - 1)), to: today };
}

function normalizeContent(input) {
  let text = String(input ?? '');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  if (!text) throw new RangeError('日记正文为空，无法写入');
  return text;
}

function validateTime(value) {
  const text = String(value ?? '').trim();
  if (!TIME_RE.test(text)) throw new RangeError(`时间必须是 HH:mm（24 小时制），收到：${text}`);
  return text;
}

function sanitizeMeta(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags) {
  const raw = Array.isArray(tags) ? tags : String(tags ?? '').split(/[,，\s]+/);
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    const tag = sanitizeMeta(item).replace(/^#+/, '');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/**
 * 单条记录的 Markdown：
 *
 *   ## 19:48
 *
 *   > 天气：晴 · 心情：开心 · #工作 #运动
 *
 *   正文……
 */
function formatEntry({ time, content, weather, mood, tags } = {}) {
  const hhmm = validateTime(time);
  const body = normalizeContent(content);
  const meta = [];
  if (weather) meta.push(`天气：${sanitizeMeta(weather)}`);
  if (mood) meta.push(`心情：${sanitizeMeta(mood)}`);
  const tagList = normalizeTags(tags);
  if (tagList.length) meta.push(tagList.map((tag) => `#${tag}`).join(' '));

  const lines = [`## ${hhmm}`, ''];
  if (meta.length) lines.push(`> ${meta.join(' · ')}`, '');
  lines.push(body);
  return lines.join('\n');
}

function formatNoteHeader(ymd) {
  return `# ${assertYmd(ymd)}`;
}

function composeNewNote(ymd, entry) {
  return `${formatNoteHeader(ymd)}\n\n${entry}\n`;
}

function composeAppend(entry) {
  return `\n\n${entry}\n`;
}

function dateFromTitle(title) {
  const text = String(title ?? '').trim();
  return isYmd(text) ? text : null;
}

function isDiaryTitle(title) {
  return dateFromTitle(title) !== null;
}

function formatDayLabel(ymd) {
  return `${ymd} ${weekdayCn(ymd)}`;
}

module.exports = {
  DATE_RE,
  MAX_RANGE_DAYS,
  DEFAULT_RANGE_DAYS,
  isYmd,
  assertYmd,
  ymdToUtcMs,
  utcMsToYmd,
  addDays,
  diffDays,
  weekdayCn,
  parseNow,
  todayYmd,
  currentTime,
  resolveDateInput,
  monthRange,
  weekRange,
  enumerateRange,
  resolveRange,
  normalizeContent,
  validateTime,
  normalizeTags,
  formatEntry,
  formatNoteHeader,
  composeNewNote,
  composeAppend,
  dateFromTitle,
  isDiaryTitle,
  formatDayLabel,
};
