# IMA 日记 API 与存储约定

本技能不新增后端接口，也不复制 ima-skills 的代码：所有请求都通过已安装的 `ima-skill/ima_api.cjs` 发往 IMA 的 `openapi/note/v1`。
本文说明依赖定位、存储约定、实际请求参数与常见错误，便于排查问题和二次开发。

## 依赖：定位 ima-skills

请求由子进程执行 `node <ima_api.cjs> <apiPath> <jsonBody>` 完成，成功时 stdout 是响应 JSON，失败时 stderr 是 `{"code","msg"}`。
本仓库自带同级的 `ima-skill/`，因此克隆后在仓库内运行即可直接命中；单独安装时按以下顺序定位（`scripts/lib/ima.cjs`）：

| 顺序 | 来源                                                     |
| ---- | -------------------------------------------------------- |
| 1    | `IMA_SKILL_API` 环境变量（指向 `ima_api.cjs` 文件）      |
| 2    | `IMA_SKILL_DIR` 环境变量 / `diary.json` 的 `imaSkillDir` |
| 3    | 本技能同级目录 `../ima-skill/ima_api.cjs`                |
| 4    | `~/.claude/skills/ima-skill`、`~/.codex/skills/ima-skill`、`~/.agents/skills/ima-skill`、`~/.config/agents/skills/ima-skill`、`~/.local/share/skills/ima-skill` |

找不到时直接报 `-100` 并给出安装/配置提示，不会静默降级。

## 存储模型

- **一篇笔记 = 一天**，笔记标题（Markdown 第一个 `#` 标题）为 `YYYY-MM-DD`。
- 正文结构：

```markdown
# 2026-10-28

## 08:10

早上跑步 5 公里。

## 19:48

> 天气：晴 · 心情：平静 · #工作 #运动

把日记技能接进来了，晚上第一次用它写日记。
```

- 无元信息时省略引用行。
- 同一天再次写入时不新建笔记，而是追加 `\n\n## HH:mm\n\n<正文>\n`。
- 标题必须是纯日期：脚本按标题精确匹配去重；带后缀（如 `2026-10-28 日记`）会被视为普通笔记。
- **只认配置笔记本内的笔记**：`folder`（默认 `日记`）对应 `folder_id`；该目录之外的同名笔记不读取、不追加。找不到笔记本时写入直接报 `-100`，不会落到默认位置。

## 请求链路

| diary 命令              | IMA 接口调用                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `write`（当天已有笔记） | `list_notebook` → `list_note`（最近 20 条）→ `search_note` → `append_doc` |
| `write`（当天没有笔记） | `list_notebook` → `list_note` → `search_note` → `import_doc`（目标笔记本） |
| `read`                  | `list_note` / `search_note` → `get_doc_content`（format 2）         |
| `list`                  | 对区间内每一天执行 `search_note`                                    |
| `search`                | `search_note`（`search_type=1`，正文检索）                          |
| `review`                | 对区间内每一天执行 `search_note` + `get_doc_content`                |
| `export`                | 同 `review`，额外把正文写到本地 `YYYY-MM-DD.md`                     |
| `check`                 | `list_notebook`                                                     |

## 接口参数

### search_note — 按标题/正文检索

```json
{
  "search_type": 0,
  "sort_type": 0,
  "query_info": { "title": "2026-10-28" },
  "start": 0,
  "end": 20
}
```

- `search_type`：`0` 标题 / `1` 正文。
- `start` / `end` 相差不超过 20；`is_end=true` 时停止。
- 日记脚本只接受 `title.trim() === "YYYY-MM-DD"` 的结果；同一天多篇时优先 `note_ext_info.folder_id` 等于「日记」文件夹、且 `create_time` 最早的一篇，并通过 stderr 告警。
- ⚠️ `search_note` 有分钟级索引延迟：刚写入的笔记可能立刻搜不到。因此 `write` 前会先看 `list_note` 最近 20 条（`list_note` 立即可见），再退回搜索，避免同一天重复新建。

### list_notebook — 定位日记笔记本

```json
{ "cursor": "0", "limit": 20 }
```

- 首次 `cursor: "0"`，后续用 `next_cursor`，`is_end=true` 停止。
- 匹配 `note_folder_infos[].name === folder`，取 `folder_id`。
- 找不到同名笔记本时**不写入任何位置**：报 `-100` 并提示创建笔记本或修改 `folder`。

### import_doc — 新建当天笔记

```json
{
  "content_format": 1,
  "content": "# 2026-10-28\n\n## 19:48\n\n正文\n",
  "folder_id": "<日记文件夹 ID，可选>"
}
```

- `content_format` 固定 `1`（Markdown）。
- 返回 `data.note_id`；后续当天追加都用它。
- 笔记标题由正文首个 `#` 标题决定，因此正文第一行必须是 `# YYYY-MM-DD`。

### append_doc — 追加当天记录

```json
{
  "note_id": "<当天笔记 ID>",
  "content_format": 1,
  "content": "\n\n## 21:05\n\n晚上又记了一条\n"
}
```

### get_doc_content — 读取正文

```json
{ "note_id": "<笔记 ID>", "target_content_format": 2 }
```

- **实测纯文本（`0`）会把换行全部吃掉**（例如 `2026-10-2820:24测试…`），所以读取/回顾/导出统一用 JSON（`2`），在本地渲染成 Markdown；JSON 失败或为空时才回退 `0`。
- JSON 返回 `data.content` 是字符串化的块数组，例如 `[{"type":"h1","children":[{"text":"2026-10-28"}]}, …]`；渲染规则见 `scripts/lib/render.cjs`（h1–h6、blockquote、列表、段落）。
- 回顾/导出时去掉开头重复的 `# 日期` 标题。

## 日期与时区

- `today` 由 `Intl.DateTimeFormat` 按配置时区计算，避免服务器时区与用户所在时区不一致。
- 支持 `--date today|yesterday|前天|明天|-2|2026-10-28`，以及 `YYYY/MM/DD`、`YYYYMMDD`。
- 区间参数：`--days N`（默认最近 7 天，含今天）、`--month YYYY-MM`、`--from/--to`；单次最多 366 天。

## 错误码

| code   | 含义                      | 处理建议                              |
| ------ | ------------------------- | ------------------------------------- |
| -100   | 程序错误（依赖/凭证/参数） | 按 `msg` 修正；先跑 `check`           |
| -200   | 上游 ima-skills 需要更新   | 升级 ima-skill（本技能一般无需改动）  |
| 100001 | 参数错误                  | 检查日期、时间、正文是否为空          |
| 100005 | 无权限                    | 确认操作的是自己的笔记                |
| 100006 | 笔记已删除                | 重新查找/新建当天笔记                 |
| 100009 | 单篇笔记超过大小限制      | 拆成多次 `append_doc`（多次 `write`） |
| 20002  | 限频                      | 稍后重试                              |
| 20004  | 鉴权失败                  | 检查 Client ID / API Key              |

## 边界

- 日记写入图片：仍按 `ima-skill` 的 notes 图片流程处理（`notes/scripts/note-images.cjs`），不要走 knowledge-base。
- 把日记关联到知识库：先 `read --json` 取 `noteId`，再按 `ima-skill` 的 `add_knowledge`（`media_type=11`）处理。
