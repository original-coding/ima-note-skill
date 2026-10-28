'use strict';

/**
 * 把 get_doc_content(target_content_format=2) 返回的 JSON 块渲染成 Markdown。
 *
 * 实测纯文本格式会把换行全部吃掉（"2026-10-2820:24…"），JSON 格式则保留块结构，
 * 因此读取/回顾/导出统一走 JSON，失败时由 service 回退到纯文本。
 */

const HEADING_RE = /^h([1-6])$/;

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node !== 'object') return '';

  let out = typeof node.text === 'string' ? node.text : '';
  if (Array.isArray(node.children)) out += node.children.map(textOf).join('');
  return out;
}

function parseBlocks(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function renderBlock(block) {
  const type = block && typeof block.type === 'string' ? block.type : '';
  const text = textOf(block).trim();
  if (!text) return '';

  const heading = HEADING_RE.exec(type);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${text}`;
  if (type === 'blockquote') return `> ${text}`;
  if (/^(bulleted|bullet|unordered)_list$/.test(type) || type === 'list') return `- ${text}`;
  if (/^(numbered|ordered)_list$/.test(type)) return `- ${text}`;
  if (type === 'code' || type === 'code_block') return ['```', text, '```'].join('\n');
  return text;
}

/** JSON 块数组 → Markdown；不是 JSON 时原样返回（兼容纯文本响应）。 */
function renderNoteContent(raw) {
  const blocks = parseBlocks(raw);
  if (!blocks) return String(raw ?? '');
  return blocks
    .map(renderBlock)
    .filter(Boolean)
    .join('\n\n');
}

module.exports = { renderNoteContent, parseBlocks, renderBlock, textOf };
