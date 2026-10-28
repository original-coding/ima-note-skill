'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { describeImaSkill, SKILL_DIR } = require('../scripts/lib/ima.cjs');

function envWithoutOverrides(overrides = {}) {
  const env = { ...process.env };
  delete env.IMA_SKILL_API;
  delete env.IMA_SKILL_DIR;
  return { ...env, ...overrides };
}

test('自动发现仓库内置的 ima-skill（同级目录）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-diary-home-'));
  try {
    const info = describeImaSkill({ env: envWithoutOverrides({ HOME: home }) });
    assert.equal(info.ok, true);
    assert.equal(info.version, '1.1.10');
    assert.equal(info.dir, path.resolve(SKILL_DIR, '../ima-skill'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('IMA_SKILL_API 优先于自动发现', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-diary-api-'));
  try {
    const script = path.join(dir, 'ima_api.cjs');
    fs.writeFileSync(script, '// fake ima_api\n');
    const info = describeImaSkill({ env: envWithoutOverrides({ IMA_SKILL_API: script }) });
    assert.equal(info.ok, true);
    assert.equal(info.script, path.resolve(script));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
