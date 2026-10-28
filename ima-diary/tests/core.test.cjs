'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../scripts/lib/core.cjs');

test('isYmd 只接受真实存在的日期', () => {
  assert.equal(core.isYmd('2026-10-28'), true);
  assert.equal(core.isYmd('2024-02-29'), true);
  assert.equal(core.isYmd('2026-02-30'), false);
  assert.equal(core.isYmd('2026-13-01'), false);
  assert.equal(core.isYmd('20261028'), false);
  assert.equal(core.isYmd('2026-10-28 日记'), false);
});

test('resolveDateInput 支持相对与绝对写法', () => {
  const today = '2026-10-28';
  assert.equal(core.resolveDateInput(undefined, { today }), today);
  assert.equal(core.resolveDateInput('今天', { today }), today);
  assert.equal(core.resolveDateInput('yesterday', { today }), '2026-10-27');
  assert.equal(core.resolveDateInput('前天', { today }), '2026-10-26');
  assert.equal(core.resolveDateInput('-3', { today }), '2026-10-25');
  assert.equal(core.resolveDateInput('2026/10/01', { today }), '2026-10-01');
  assert.equal(core.resolveDateInput('20261001', { today }), '2026-10-01');
  assert.throws(() => core.resolveDateInput('下周', { today }), /无法识别的日期/);
  assert.throws(() => core.resolveDateInput('2026-02-30', { today }), /有效日期/);
});

test('monthRange / weekRange 边界正确', () => {
  assert.deepEqual(core.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(core.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(core.weekRange('2026-10-28'), { from: '2026-10-26', to: '2026-11-01' });
  assert.equal(core.weekdayCn('2026-10-28'), '周三');
  assert.equal(core.weekdayCn('2026-11-01'), '周日');
});

test('resolveRange 默认最近 7 天，并限制区间长度', () => {
  const today = '2026-10-28';
  assert.deepEqual(core.resolveRange({ today }), { from: '2026-10-22', to: '2026-10-28' });
  assert.deepEqual(core.resolveRange({ days: 1, today }), { from: today, to: today });
  assert.deepEqual(core.resolveRange({ month: '2026-10', today }), { from: '2026-10-01', to: '2026-10-31' });
  assert.throws(() => core.resolveRange({ days: 0, today }), /正整数/);
  assert.throws(() => core.resolveRange({ days: 999, today }), /最多/);
});

test('enumerateRange 校验起止顺序', () => {
  assert.deepEqual(core.enumerateRange('2026-10-01', '2026-10-03'), [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
  ]);
  assert.throws(() => core.enumerateRange('2026-10-03', '2026-10-01'), /晚于/);
});

test('formatEntry 渲染时间、心情、天气、标签', () => {
  const entry = core.formatEntry({
    time: '19:48',
    content: '  今天把日记 skill 跑通了。\r\n第二行。  ',
    weather: '晴',
    mood: '开心',
    tags: '工作, 周末',
  });
  assert.equal(
    entry,
    ['## 19:48', '', '> 天气：晴 · 心情：开心 · #工作 #周末', '', '今天把日记 skill 跑通了。', '第二行。'].join('\n'),
  );
});

test('formatEntry 在无元信息时不写引用块', () => {
  assert.equal(core.formatEntry({ time: '08:05', content: '早' }), '## 08:05\n\n早');
});

test('时间/正文校验', () => {
  assert.throws(() => core.formatEntry({ time: '24:00', content: 'x' }), /HH:mm/);
  assert.throws(() => core.formatEntry({ time: '19:48', content: '   ' }), /正文为空/);
  assert.throws(() => core.normalizeContent('\uFEFF\r\n\r\n'), /正文为空/);
});

test('新建笔记与追加片段的首尾格式', () => {
  const entry = core.formatEntry({ time: '19:48', content: '正文' });
  assert.equal(core.composeNewNote('2026-10-28', entry), '# 2026-10-28\n\n## 19:48\n\n正文\n');
  assert.equal(core.composeAppend(entry), '\n\n## 19:48\n\n正文\n');
});

test('dateFromTitle 只认纯日期标题', () => {
  assert.equal(core.dateFromTitle('2026-10-28'), '2026-10-28');
  assert.equal(core.dateFromTitle(' 2026-10-28 '), '2026-10-28');
  assert.equal(core.dateFromTitle('2026-10-28 日记'), null);
  assert.equal(core.dateFromTitle('会议纪要'), null);
});

test('todayYmd / currentTime 按时区换算', () => {
  const now = new Date('2026-10-28T16:30:00.000Z');
  assert.equal(core.todayYmd('Asia/Shanghai', now), '2026-10-29');
  assert.equal(core.currentTime('Asia/Shanghai', now), '00:30');
  assert.equal(core.todayYmd('UTC', now), '2026-10-28');
});
