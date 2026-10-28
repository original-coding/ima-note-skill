'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { withFakeIma } = require('./helpers/workspace.cjs');

const execFileAsync = promisify(execFile);
const CLI = path.resolve(__dirname, '../scripts/diary.cjs');

async function runCliAt(script, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], { env, timeout: 60000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

async function runCli(args, env) {
  return runCliAt(CLI, args, env);
}

function parseJson(text) {
  return JSON.parse(String(text).trim());
}

test('help 与 version 可用', async () => {
  const help = await runCli(['help'], process.env);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /write/);
  assert.match(help.stdout, /review/);

  await withFakeIma(async ({ env }) => {
    const version = await runCli(['--version'], env);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /^ima-diary 1\.0\.0/);
    assert.match(version.stdout, /ima-skill 1\.1\.10/);
  });
});

test('write → read → list 的完整 JSON 输出', async () => {
  await withFakeIma(async ({ env }) => {
    const first = parseJson((await runCli(['write', '--json', '--content', '今天在写日记 skill'], env)).stdout);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(first.date, '2026-10-28');
    assert.equal(first.time, '19:48');

    const second = parseJson(
      (await runCli(['write', '--json', '--content', '晚上又记了一条', '--time', '22:10'], env)).stdout,
    );
    assert.equal(second.created, false);

    const read = parseJson((await runCli(['read', '--json'], env)).stdout);
    assert.equal(read.found, true);
    assert.match(read.content, /今天在写日记 skill/);
    assert.match(read.content, /## 22:10/);

    const list = parseJson((await runCli(['list', '--json', '--days', '3'], env)).stdout);
    assert.equal(list.days.length, 3);
    assert.equal(list.writtenDays, 1);
  });
});

test('dry-run 只预览，不写入', async () => {
  await withFakeIma(async ({ env, server }) => {
    const result = parseJson((await runCli(['write', '--json', '--dry-run', '--content', '预览'], env)).stdout);
    assert.equal(result.dryRun, true);
    assert.equal(result.wouldCreate, true);
    assert.match(result.markdown, /^# 2026-10-28/);
    assert.equal(server.requests.filter((req) => /import_doc|append_doc/.test(req.api)).length, 0);
  });
});

test('search 与 export 走命令行', async () => {
  await withFakeIma(async ({ env, dir }) => {
    await runCli(['write', '--content', '晨跑五公里'], env);

    const search = parseJson((await runCli(['search', '晨跑', '--json'], env)).stdout);
    assert.equal(search.hits.length, 1);
    assert.equal(search.hits[0].date, '2026-10-28');

    const outDir = path.join(dir, 'export');
    const exported = parseJson(
      (await runCli(['export', '--json', '--month', '2026-10', '--out', outDir], env)).stdout,
    );
    assert.deepEqual(exported.written, ['2026-10-28']);
    assert.match(fs.readFileSync(path.join(outDir, '2026-10-28.md'), 'utf8'), /晨跑五公里/);
  });
});

test('非法日期以结构化错误退出', async () => {
  await withFakeIma(async ({ env }) => {
    const result = await runCli(['read', '--date', '2026-02-30'], env);
    assert.equal(result.code, 1);
    const error = parseJson(result.stderr);
    assert.equal(error.code, -100);
    assert.match(error.msg, /有效日期/);
  });
});

test('单独安装且找不到 ima-skill 时，check 给出安装提示', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-diary-alone-'));
  try {
    fs.cpSync(path.resolve(__dirname, '..'), path.join(tmp, 'ima-diary'), { recursive: true });
    const env = { ...process.env, HOME: tmp };
    for (const key of ['IMA_SKILL_API', 'IMA_SKILL_DIR', 'IMA_DIARY_CONFIG']) delete env[key];

    const result = await runCliAt(path.join(tmp, 'ima-diary/scripts/diary.cjs'), ['check'], env);
    assert.equal(result.code, 1);
    const error = parseJson(result.stderr);
    assert.equal(error.code, -100);
    assert.match(error.msg, /未找到 ima-skills/);
    assert.match(error.msg, /IMA_SKILL_DIR/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('写入成功只输出一行确认，不附带提醒', async () => {
  await withFakeIma(async ({ env }) => {
    const result = await runCli(['write', '--content', '只回一行'], env);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), '已记入 2026-10-28 日记（19:48）');
    assert.equal(result.stderr.trim(), '');
  });
});
