'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SKILL_FILE = path.join(__dirname, '..', 'SKILL.md');
const META_FILE = path.join(__dirname, '..', 'meta.json');

function frontmatter(raw) {
  assert.ok(raw.startsWith('---\n'), 'SKILL.md 必须以 YAML frontmatter 开头');
  const end = raw.indexOf('\n---', 4);
  assert.ok(end > 0, 'SKILL.md 的 frontmatter 没有闭合');
  return raw.slice(4, end);
}

test('SKILL.md 声明了仅手动触发的条件', () => {
  const raw = fs.readFileSync(SKILL_FILE, 'utf8');
  const fm = frontmatter(raw);
  assert.match(fm, /^name: ima-diary$/m);
  assert.match(fm, /^description: \|/m);
  assert.match(raw, /只能在用户显式调用本技能时使用/);
  // 不能靠隐藏技能来实现"手动"：技能仍在模型目录里，由声明约束触发条件
  assert.doesNotMatch(fm, /^disable-model-invocation:/m);
});

test('meta.json 与 SKILL.md 的 name 一致', () => {
  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  assert.equal(meta.name, 'ima-diary');
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
});
