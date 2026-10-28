'use strict';

/**
 * 日记模块配置：
 *   1. 命令行参数（优先级最高，见 cli）
 *   2. 环境变量 IMA_DIARY_FOLDER / IMA_DIARY_TZ / IMA_DIARY_CONFIG / IMA_DIARY_NOW
 *   3. ~/.config/ima/diary.json
 *   4. 默认值：笔记本「日记」、系统时区、纯日期标题
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DiaryError } = require('./errors.cjs');

const DEFAULT_FOLDER = '日记';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config/ima/diary.json');

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 允许配置里写 ~/xxx（Windows 上是 ~\xxx），避免用户手写绝对路径。 */
function expandHome(value) {
  if (!value) return value;
  return String(value).replace(/^~(?=$|[\\/])/, os.homedir());
}

function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    throw new DiaryError(-100, `时区不合法：${timeZone}（示例：Asia/Shanghai）`);
  }
  return timeZone;
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    throw new DiaryError(-100, `读取配置文件失败：${configPath}（${error.message}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DiaryError(-100, `配置文件不是合法 JSON：${configPath}（${error.message}）`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DiaryError(-100, `配置文件必须是 JSON 对象：${configPath}`);
  }
  return parsed;
}

function pick(env, envKey, file, fileKey, fallback) {
  if (has(env, envKey)) return env[envKey];
  if (has(file, fileKey)) return file[fileKey];
  return fallback;
}

function loadConfig(env = process.env) {
  const configPath = expandHome(env.IMA_DIARY_CONFIG || DEFAULT_CONFIG_PATH);
  const file = readConfigFile(configPath);

  const folderRaw = pick(env, 'IMA_DIARY_FOLDER', file, 'folder', DEFAULT_FOLDER);
  const folder = folderRaw === null || folderRaw === undefined ? DEFAULT_FOLDER : String(folderRaw);

  const timeZoneRaw = pick(env, 'IMA_DIARY_TZ', file, 'timeZone', '');
  const timeZone = timeZoneRaw ? validateTimeZone(String(timeZoneRaw)) : '';

  const imaSkillDirRaw = pick(env, 'IMA_SKILL_DIR', file, 'imaSkillDir', '');

  return {
    configPath: fs.existsSync(configPath) ? configPath : null,
    folder,
    timeZone,
    imaSkillDir: imaSkillDirRaw ? expandHome(String(imaSkillDirRaw)) : '',
  };
}

/** 与 ima_api.cjs 相同的凭证来源，用于 check / 提前给出友好提示。 */
function checkCredentials(env = process.env) {
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return '';
    }
  };
  const clientId =
    env.IMA_CLIENT_ID ||
    env.IMA_OPENAPI_CLIENTID ||
    read(path.join(os.homedir(), '.config/ima/client_id'));
  const apiKey =
    env.IMA_API_KEY ||
    env.IMA_OPENAPI_APIKEY ||
    read(path.join(os.homedir(), '.config/ima/api_key'));

  return {
    ok: Boolean(clientId && apiKey),
    missing: [!clientId && 'Client ID', !apiKey && 'API Key'].filter(Boolean),
  };
}

module.exports = {
  DEFAULT_FOLDER,
  DEFAULT_CONFIG_PATH,
  expandHome,
  loadConfig,
  checkCredentials,
  validateTimeZone,
};
