'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../scripts/lib/config.cjs');

function withConfigFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-config-'));
  try {
    const file = path.join(dir, 'diary.json');
    fs.writeFileSync(file, content, 'utf8');
    return fn(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('读取带 BOM 的 diary.json（Windows PowerShell 常见）', () => {
  withConfigFile('\uFEFF{"folder":"我的日记","timeZone":"Asia/Shanghai"}', (file) => {
    const config = loadConfig({ IMA_DIARY_CONFIG: file });
    assert.equal(config.folder, '我的日记');
    assert.equal(config.timeZone, 'Asia/Shanghai');
  });
});

test('环境变量覆盖配置文件', () => {
  withConfigFile('{"folder":"文件里的日记"}', (file) => {
    const config = loadConfig({ IMA_DIARY_CONFIG: file, IMA_DIARY_FOLDER: '环境变量的日记' });
    assert.equal(config.folder, '环境变量的日记');
  });
});

test('配置路径支持 ~ 展开（POSIX）', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-config-home-'));
  const previous = process.env.HOME;
  try {
    fs.writeFileSync(path.join(home, 'diary.json'), '{"folder":"home 日记"}', 'utf8');
    process.env.HOME = home;
    const config = loadConfig({ IMA_DIARY_CONFIG: '~/diary.json' });
    assert.equal(config.folder, 'home 日记');
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
