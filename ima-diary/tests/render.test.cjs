'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderNoteContent } = require('../scripts/lib/render.cjs');

test('把 JSON 块渲染为 Markdown', () => {
  const raw = JSON.stringify([
    { type: 'h1', children: [{ text: '2026-10-28' }] },
    { type: 'h2', children: [{ text: '19:48' }] },
    { type: 'blockquote', children: [{ text: '天气：晴 · 心情：平静' }] },
    { type: 'p', children: [{ text: '今天把日记技能接进来了。' }] },
    { type: 'bulleted_list', children: [{ text: '一条' }] },
  ]);
  assert.equal(
    renderNoteContent(raw),
    ['# 2026-10-28', '## 19:48', '> 天气：晴 · 心情：平静', '今天把日记技能接进来了。', '- 一条'].join('\n\n'),
  );
});

test('兼容带 marks 的富文本节点', () => {
  const raw = JSON.stringify([{ type: 'p', children: [{ text: '加粗', marks: ['bold'] }, { text: '普通' }] }]);
  assert.equal(renderNoteContent(raw), '加粗普通');
});

test('非 JSON 响应原样返回，空内容返回空串', () => {
  assert.equal(renderNoteContent('纯文本内容'), '纯文本内容');
  assert.equal(renderNoteContent(''), '');
  assert.equal(renderNoteContent('[]'), '');
});
