'use strict';

/**
 * 对 ima-skills 的依赖绑定。
 *
 * 本技能不复制 ima_api.cjs，而是调用已安装的 ima-skills 里的实现，复用它的
 * 凭证读取、请求头、版本与更新检查。因此需要能定位到 ima-skill 目录：
 *
 *   1. IMA_SKILL_API=<ima_api.cjs 的完整路径>
 *   2. IMA_SKILL_DIR=<ima-skill 目录>（或 ~/.config/ima/diary.json 的 imaSkillDir）
 *   3. 与本技能同级的 ../ima-skill/
 *   4. 常见 skills 安装目录（~/.claude/skills、~/.codex/skills 等）
 *
 * 通过子进程调用，保证 stdout/stderr 契约与上游文档一致：
 * 成功时 stdout 是响应 JSON，失败时 stderr 是 {"code","msg"}。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { DiaryError, ERR_PROGRAMMATIC } = require('./errors.cjs');

/** 本技能根目录（ima-diary/）。 */
const SKILL_DIR = path.resolve(__dirname, '../..');

const IMA_MISSING_MESSAGE = [
  '未找到 ima-skills（需要其中的 ima_api.cjs）。',
  '请先安装 ima-skills（https://app-dl.ima.qq.com/skills/ima-skills-1.1.10.zip），',
  '再把 ima-skill 与本技能放在同一父目录下，',
  '或设置 IMA_SKILL_DIR=<ima-skill 目录>，',
  '或在 ~/.config/ima/diary.json 中配置 "imaSkillDir"。',
].join('');

const HOME_SKILL_DIRS = [
  '.claude/skills',
  '.codex/skills',
  '.agents/skills',
  '.config/agents/skills',
  '.local/share/skills',
];

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function expandHome(value) {
  if (!value) return value;
  return String(value).replace(/^~(?=$|[\\/])/, os.homedir());
}

function candidateSkillDirs({ env = process.env, imaSkillDir } = {}) {
  const dirs = [];
  if (imaSkillDir) dirs.push(expandHome(imaSkillDir));
  if (env.IMA_SKILL_DIR) dirs.push(expandHome(env.IMA_SKILL_DIR));
  // 安装在同一个 skills 目录下时，最自然的布局就是同级
  dirs.push(path.resolve(SKILL_DIR, '../ima-skill'));
  for (const base of HOME_SKILL_DIRS) dirs.push(path.join(os.homedir(), base, 'ima-skill'));
  return [...new Set(dirs.filter(Boolean))];
}

function resolveImaScript({ env = process.env, imaSkillDir, imaSkillApi } = {}) {
  if (imaSkillApi && isFile(expandHome(imaSkillApi))) return path.resolve(expandHome(imaSkillApi));
  if (env.IMA_SKILL_API && isFile(expandHome(env.IMA_SKILL_API))) {
    return path.resolve(expandHome(env.IMA_SKILL_API));
  }

  for (const dir of candidateSkillDirs({ env, imaSkillDir })) {
    const script = path.join(path.resolve(dir), 'ima_api.cjs');
    if (isFile(script)) return script;
  }
  return null;
}

function describeImaSkill(options = {}) {
  const script = resolveImaScript(options);
  if (!script) return { ok: false, script: null, dir: null, version: null };

  const dir = path.dirname(script);
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).version || null;
  } catch {
    // ima-skill 没有 meta.json 也不影响调用，只是拿不到版本号
  }
  return { ok: true, script, dir, version };
}

function tryParse(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function runIma(apiPath, body, { env = process.env, timeout = 120000, imaSkillDir, imaSkillApi } = {}) {
  const script = resolveImaScript({ env, imaSkillDir, imaSkillApi });
  if (!script) return Promise.reject(new DiaryError(ERR_PROGRAMMATIC, IMA_MISSING_MESSAGE));

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, apiPath, JSON.stringify(body ?? {})],
      { env, timeout, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const parsed = tryParse(stderr);
          if (parsed && typeof parsed.code === 'number') {
            reject(new DiaryError(parsed.code, parsed.msg || 'IMA 请求失败'));
            return;
          }
          const detail = String(stderr || '').trim();
          const reason = error.killed ? '请求超时' : error.message;
          reject(
            new DiaryError(ERR_PROGRAMMATIC, `调用 IMA 失败：${reason}${detail ? `（${detail}）` : ''}`),
          );
          return;
        }

        const resp = tryParse(stdout);
        if (!resp) {
          reject(new DiaryError(ERR_PROGRAMMATIC, 'IMA 返回内容不是合法 JSON，请检查 ima_api.cjs 是否完整'));
          return;
        }
        if (resp.code !== 0) {
          reject(new DiaryError(resp.code, resp.msg || 'IMA 返回业务错误'));
          return;
        }
        resolve(resp.data && typeof resp.data === 'object' ? resp.data : {});
      },
    );
  });
}

function createImaClient(options = {}) {
  return {
    call: (apiPath, body) => runIma(apiPath, body, options),
    describe: () => describeImaSkill(options),
  };
}

module.exports = {
  SKILL_DIR,
  IMA_MISSING_MESSAGE,
  candidateSkillDirs,
  resolveImaScript,
  describeImaSkill,
  createImaClient,
  runIma,
};
