#!/usr/bin/env node
'use strict';

/**
 * 跨平台安装脚本：把 ima-skill / ima-diary 安装到 agent 的 skills 目录。
 *
 * 用法：
 *   node scripts/install.cjs                  # 默认 <home>/.agents/skills
 *   node scripts/install.cjs <skills 目录>    # 指定目录
 *   AGENTS_SKILLS_DIR=... node scripts/install.cjs
 *
 * 默认创建目录链接（Windows 上优先 symlink，失败则用 junction，再失败则复制）。
 * 已存在的同名真实目录不会被删除，只跳过并返回非零退出码。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = ['ima-skill', 'ima-diary'];

function resolveTarget(argv) {
  const arg = argv[2];
  const base = arg || process.env.AGENTS_SKILLS_DIR || path.join(os.homedir(), '.agents', 'skills');
  return path.resolve(base);
}

function removeExistingLink(dest) {
  if (!fs.existsSync(dest) && !isLink(dest)) return { exists: false };

  const stat = fs.lstatSync(dest);
  if (!stat.isSymbolicLink()) return { exists: true, removable: false };
  fs.unlinkSync(dest);
  return { exists: true, removable: true, removed: true };
}

function isLink(dest) {
  try {
    return fs.lstatSync(dest).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 依次尝试 symlink → （Windows）junction → 复制。
 * 返回实际采用的方式，便于向用户说明更新语义。
 */
function linkOrCopy(src, dest) {
  try {
    fs.symlinkSync(src, dest, 'dir');
    return 'symlink';
  } catch (error) {
    // 某些 Windows 环境会在失败后留下半成品链接，先清掉再尝试下一种方式
    if (isLink(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch {
        // ignore and keep trying
      }
    }
    if (process.platform === 'win32') {
      try {
        fs.symlinkSync(src, dest, 'junction');
        return 'junction';
      } catch {
        // fall through to copy
      }
    }
    fs.cpSync(src, dest, { recursive: true });
    return 'copy';
  }
}

function installSkill(name, target) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    throw new Error(`仓库里缺少 ${name}/SKILL.md，无法安装`);
  }

  const dest = path.join(target, name);
  const existing = removeExistingLink(dest);
  if (existing.exists && existing.removable === false) {
    throw new Error(`${dest} 已存在且不是链接，已跳过（如需替换请先手动删除）`);
  }

  const mode = linkOrCopy(src, dest);
  return { name, dest, mode };
}

function main() {
  const target = resolveTarget(process.argv);
  fs.mkdirSync(target, { recursive: true });

  console.log(`安装目标：${target}`);
  let failed = false;

  for (const name of SKILLS) {
    try {
      const result = installSkill(name, target);
      const hint =
        result.mode === 'copy'
          ? '（已复制：仓库更新后需重新运行本脚本）'
          : '（链接：仓库更新即时生效）';
      console.log(`✓ ${result.name} -> ${result.dest} [${result.mode}] ${hint}`);
    } catch (error) {
      failed = true;
      console.error(`✗ ${error.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  const diaryScript = path.join(target, 'ima-diary', 'scripts', 'diary.cjs');
  console.log('');
  console.log('完成。自检：');
  console.log(`  node "${diaryScript}" check`);
}

main();
