'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INSTALLER = path.resolve(__dirname, 'install.cjs');

function runInstaller(target) {
  try {
    const stdout = execFileSync(process.execPath, [INSTALLER, target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : '',
    };
  }
}

test('安装到指定目录，重复执行不报错', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-install-'));
  try {
    const first = runInstaller(tmp);
    assert.equal(first.code, 0);
    assert.match(first.stdout, /ima-skill/);
    assert.match(first.stdout, /ima-diary/);

    for (const name of ['ima-skill', 'ima-diary']) {
      const dest = path.join(tmp, name);
      assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')), `${name}/SKILL.md 应可访问`);
    }

    const second = runInstaller(tmp);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /\[(symlink|junction|copy)\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('已存在的同名真实目录不会被删除', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-install-conflict-'));
  try {
    const conflict = path.join(tmp, 'ima-diary');
    fs.mkdirSync(conflict, { recursive: true });

    const result = runInstaller(tmp);
    assert.equal(result.code, 1, '存在冲突时应返回非零退出码');
    assert.match(result.stderr, /已存在且不是链接/);
    assert.ok(fs.statSync(conflict).isDirectory(), '原有目录应保留');
    assert.ok(fs.existsSync(path.join(tmp, 'ima-skill', 'SKILL.md')), '另一个技能仍应安装成功');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
