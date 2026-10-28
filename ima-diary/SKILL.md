---
name: ima-diary
description: |
  个人日记技能：在 IMA 里按「一天一篇、标题为 YYYY-MM-DD」的约定记录日记，基于已安装的 ima-skills 的笔记接口实现。
  支持写当天、补记某天、查看、检索、周/月回顾，以及导出成本地 YYYY-MM-DD.md。
  触发条件（技能声明）：只能在用户显式调用本技能时使用（如输入 /ima-diary，或明确说「用 ima-diary / 日记技能」）；
  不要因为用户说「帮我记一下」「记录一下」这类泛化意图就自动加载或执行。
---

# ima-diary

个人日记技能。日记存在 IMA 笔记里，**一天一篇，笔记标题固定为日期 `YYYY-MM-DD`**，同一天多次记录按 `## HH:mm` 追加。
查找、去重、新建/追加、回顾、导出都由 `scripts/diary.cjs` 完成，不要手工拼 API。

本技能**不复制** ima-skills 的代码，而是依赖已安装的 `ima-skill`：所有请求都通过它的 `ima_api.cjs` 发出，凭证、请求头、版本检查完全沿用上游。

## 触发条件（仅手动）

本技能在声明（description）里把触发条件限定为**用户显式调用**：它在模型可见的技能目录里，但只有用户明确点名时才应加载、执行。

- ✅ 用户输入 `/ima-diary …`，或明确说「用 ima-diary / 日记技能记…」：按下面的命令表执行。
- ⚠️ 用户只调用技能、没给内容：问一句今天发生了什么，不要连续追问。
- ❌ 用户只泛泛说「帮我记一下」「记录一下」：不要加载本技能；交给 `ima-skill` 的 notes，或先确认是否用日记技能。
- ❌ 不要因为内容"像日记"就自动创建日期标题的笔记。

## 依赖与首次检查

需要 ima-skills 提供 `ima_api.cjs`。本仓库自带同级的 `ima-skill/`，克隆后直接可用；单独安装 `ima-diary` 时，脚本按以下顺序定位：

1. `IMA_SKILL_API`：直接指向 `ima_api.cjs`
2. `IMA_SKILL_DIR`：指向 `ima-skill` 目录（也可写在 `~/.config/ima/diary.json` 的 `imaSkillDir`）
3. 与本技能同级的 `../ima-skill/`
4. 常见 skills 目录：`~/.claude/skills/ima-skill`、`~/.codex/skills/ima-skill` 等

首次使用先跑自检，确认能定位 ima-skill、凭证可用、配置的笔记本（默认「日记」）存在：

```bash
node "<ima-diary 目录>/scripts/diary.cjs" check
```

输出里会带 `ima-skill 1.1.10（路径）`；找不到 ima-skills 时会直接给出安装与配置 `IMA_SKILL_DIR` 的提示。

## 笔记命名约束（硬性）

1. **标题只能是纯日期**：`2026-10-28`。不要加星期、心情、天气、序号、后缀。
2. **只在配置的笔记本内读写**（默认 `日记`，可通过 `folder` 改成 `diary` 等）：该笔记本里存在当天纯日期笔记就追加，不存在就在它里面静默新建。**其它位置**的同名笔记一律不读、不追加。
3. **一天一篇**：同一笔记本内按标题精确查找；找到就追加，找不到才新建。
4. **不要手动改名**：改成 `2026-10-28 日记` 之类后，脚本会认为当天没有日记，从而静默新建纯日期笔记。旧笔记不会被写入。
5. **标题来自正文第一行**：新建时正文必须是 `# YYYY-MM-DD` 开头；脚本自动生成，不需要手写。
6. **补记不改标题**：补记某天用 `--date`，只追加到那一天的笔记。
7. **笔记本不存在时不写入别处**：报 `-100` 并中止；先在 IMA 创建同名笔记本，或修改 `folder` 配置。

## 命令决策表

| 用户意图（在本技能被显式调用后） | 命令                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| 写今天的日记                     | `write --content-file <临时文件>`                            |
| 同一天再补一条                   | `write --content "<一句话>"`（自动追加）                     |
| 补记某一天                       | `write --date 2026-10-20 --content-file <临时文件>`          |
| 查看某天                         | `read --date <日期>`                                         |
| 看最近/某月写了哪些天            | `list --days 7` / `list --month 2026-10`                     |
| 在日记里找内容                   | `search <关键词> [--days 90]`                                |
| 周回顾 / 月回顾                  | `review --week` / `review --month 2026-10`（先取原文再总结） |
| 导出为本地文件（年月日命名）     | `export --month 2026-10 --out ~/diary`                       |
| 自检                             | `check`                                                      |

## 写入流程

1. **收集内容**：用户口述 → 直接整理；对话内容 → 提炼成第一人称记录。用户只点名技能却没给内容时，问一句今天发生了什么（不要连续追问）。
2. **整理成日记语气**：保留时间、地点、事件、人、感受，不编造；不写成工作汇报，不额外加"总结/建议"。
3. **多行内容写临时文件**，避免 shell 引号与换行问题：

```bash
DIARY="<ima-diary 目录>/scripts/diary.cjs"
TMP="$(mktemp)"
cat > "$TMP" <<'EOF'
今天把日记技能接进来了。
上午改脚本，下午补测试，晚上第一次用它写日记。
EOF
node "$DIARY" write --date today --content-file "$TMP"
rm -f "$TMP"
```

4. **短句**：`node "$DIARY" write --content "今天加班到十点，回家路上下了小雨"`。
5. **可选元信息**：`--mood 平静`、`--weather 小雨`、`--tags 工作,运动`，渲染成一条引用行。
6. **长内容或格式敏感时先预览**：加 `--dry-run`，把生成的 Markdown 给用户看，确认后再去掉 `--dry-run`。
7. **内容来源三选一**：`--content` / `--content-file` / 管道，不能同时给。

正文必须是合法 UTF-8；脚本会拒绝非法 UTF-8 文件并提示转码，不会写入乱码。

## 常用命令

```bash
# <ima-diary 目录> 就是本 SKILL.md 所在目录（安装后通常是 ~/.agents/skills/ima-diary，Windows 上是 %USERPROFILE%\.agents\skills\ima-diary）
DIARY="<ima-diary 目录>/scripts/diary.cjs"

node "$DIARY" write --content "今天……"                 # 写今天
node "$DIARY" write --date yesterday --content "昨天……" # 补记昨天
node "$DIARY" read                                     # 看今天
node "$DIARY" read --date 2026-10-20                   # 看某天
node "$DIARY" list --days 30                           # 哪些天写了/漏了
node "$DIARY" list --month 2026-10
node "$DIARY" search 跑步 --days 90
node "$DIARY" review --week                            # 本周原文，交给 agent 总结
node "$DIARY" export --month 2026-10 --out ~/diary     # 每天一个 YYYY-MM-DD.md
node "$DIARY" check                                    # 凭证 / 笔记本 / ima-skill 自检
```

Windows（PowerShell）用同一组参数，只需换路径：

```powershell
$DIARY = "$env:USERPROFILE\.agents\skills\ima-diary\scripts\diary.cjs"
node $DIARY write --content "今天……"
node $DIARY list --days 30
```

`--json` 输出结构化结果（如 `read --json` → `{found, content, noteId}`，`review --json` → `{entries, missing, markdown}`）。

## 回复模板

**写入成功只回一行**：

```
已记入 2026-10-28 日记（19:48）
```

不要再附加任何内容：不要提重复笔记、测试内容、时间戳、清理/删除/改名建议，也不要问"要不要我顺手处理"。stderr 里的 `[warn]` 在写入成功时直接忽略（只有失败时才把 `msg` 转述给用户）。

其他命令：

- 查看：直接给出正文，不改写用户原文
- 回顾：先给"区间内写了几篇、哪几天没写"，再给能追溯到原文的总结
- 导出：`已导出 12 篇到 ~/diary（跳过 3 篇已存在）`

不要在回复里暴露 `noteId`、`folder_id` 等内部 ID。

## 隐私

- 日记属于用户隐私：只回复用户本人；群聊/多人会话中只回日期与"已记录"，不回显正文。
- 不要主动把日记内容转发到知识库、其他笔记或其他会话。
- 用户明确要求"加到知识库"时，才用 `read --json` 拿 `noteId`，再转 `ima-skill` 的 knowledge-base 流程（`add_knowledge`，`media_type=11`）。

## 错误处理

| 现象                                        | 处理                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `{"code":-100,"msg":"未找到 ima-skills…"}`  | 安装 ima-skills，并设置 `IMA_SKILL_DIR`（或放在 `../ima-skill`）后重试                 |
| `{"code":-100,"msg":"未找到 IMA 凭证…"}`    | 到 https://ima.qq.com/agent-interface 获取，写入 `~/.config/ima/client_id`、`api_key`  |
| `{"code":-200,…}`                           | 上游 ima-skills 需要更新；先升级 ima-skill（本技能通常无需改动），再重试               |
| `100009` 单篇笔记超过大小限制               | 拆成多次 `write`，或建议用户精简                                                       |
| `20002` 限频                                | 稍等后重试，不要循环重试                                                               |
| `20004` 鉴权失败                            | 检查 Client ID / API Key                                                               |
| `未找到名为「…」的笔记本`（-100）           | 不会写入任何位置；在 IMA 创建同名笔记本，或修改 `~/.config/ima/diary.json` 的 `folder` |
| 正文为空 / 日期不合法                       | 按 `msg` 修正参数                                                                      |

失败一律以 `{"code","msg"}` 输出到 stderr、退出码 1；直接把 `msg` 转述给用户。

## 配置

`~/.config/ima/diary.json`（全部有默认值）：

```json
{
  "folder": "日记",
  "timeZone": "Asia/Shanghai",
  "imaSkillDir": "/path/to/ima-skill"
}
```

| 配置          | 环境变量           | 默认值                         |
| ------------- | ------------------ | ------------------------------ |
| `folder`      | `IMA_DIARY_FOLDER` | `日记`；只在这个笔记本内读写，找不到会报错。可改成 `diary` 等，名称需与 IMA 完全一致 |
| `timeZone`    | `IMA_DIARY_TZ`     | 系统时区                       |
| `imaSkillDir` | `IMA_SKILL_DIR`    | 同级 `../ima-skill` 或常见目录 |
| 配置文件      | `IMA_DIARY_CONFIG` | `~/.config/ima/diary.json`（Windows：`%USERPROFILE%\.config\ima\diary.json`） |

`--folder` / `--tz` 可对单次命令覆盖。

## 与 ima-skill 的边界

- 写日记 → 本技能；写普通笔记、备忘录、搜知识库 → `ima-skill`。
- 不要把日记写成普通笔记后再说"这是日记"；本技能的查找、去重、回顾依赖纯日期标题。
- 日记要插图时，按 `ima-skill` 的 notes 图片流程处理（`notes/scripts/note-images.cjs`），不要走 knowledge-base。
