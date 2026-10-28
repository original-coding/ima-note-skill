'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeIma } = require('./fake-ima.cjs');

const NOW_ISO = '2026-10-28T11:48:00.000Z'; // 北京时间 19:48

/**
 * 起一个假 IMA 服务 + 临时配置目录，跑完自动清理。
 * fn 收到 { server, dir, env }；env 可直接传给 CLI 子进程。
 */
async function withFakeIma(fn, options = {}) {
  const server = await startFakeIma(options);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-diary-test-'));
  const configPath = path.join(dir, 'diary.json');
  fs.writeFileSync(configPath, JSON.stringify({ folder: '日记', timeZone: 'Asia/Shanghai' }), 'utf8');

  const env = {
    ...process.env,
    IMA_OPENAPI_CLIENTID: 'test-client-id',
    IMA_OPENAPI_APIKEY: 'test-api-key',
    IMA_BASE_URL: server.url,
    IMA_LAST_CHECK_FILE: path.join(dir, 'last_update_check'),
    IMA_DIARY_CONFIG: configPath,
    IMA_SKILL_API: path.resolve(__dirname, '../../../ima-skill/ima_api.cjs'),
    IMA_DIARY_NOW: NOW_ISO,
    // 避免用户真实配置干扰测试
    IMA_DIARY_FOLDER: undefined,
    IMA_DIARY_TZ: undefined,
  };
  delete env.IMA_DIARY_FOLDER;
  delete env.IMA_DIARY_TZ;
  delete env.IMA_SKILL_DIR;

  try {
    return await fn({ server, dir, env, configPath });
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { withFakeIma, NOW_ISO };
