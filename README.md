# ima-note-skill

本仓库一起跟踪两份技能：

- **`ima-skill/`** —— 上游 [ima-skills](https://ima.qq.com) **1.1.10 原样副本**（不做本地修改），来源与校验值见 [UPSTREAM.md](UPSTREAM.md)。
- **`ima-diary/`** —— 新增的个人日记技能，基于 `ima-skill` 的 `ima_api.cjs` 实现，不复制、不修改上游代码。

`ima-diary` 通过子进程调用 `ima-skill/ima_api.cjs`，凭证、请求头、版本检查全部沿用上游。仓库内的同级布局让克隆后无需额外配置即可被自动发现。

> 首次使用请先按下面的「环境准备」完成安装、凭证与自检。

## 让 agent 帮你安装（复制提示词）

把下面整段复制给 Claude Code / Codex / DSH 等 agent。提示词只说清「从哪里下载」和「需要什么凭据」，装到哪里由 agent 按当前环境决定。

```text
请从 GitHub 下载并安装 ima-note-skill 技能：

仓库：https://github.com/original-coding/ima-note-skill.git

1. 用 git clone 或下载 zip 获取仓库。
2. 按仓库 README 的说明把技能装到合适的位置（装到哪里由你根据当前环境决定），不要修改 ima-skill/ 目录。
3. 这个技能需要 IMA 的 Client ID 和 API Key：
   - 获取地址：https://ima.qq.com/agent-interface
   - 如果我还没提供，先提示我去获取；不要编造或猜测凭证。
4. 安装后用仓库里的自检命令确认可用，把结果发给我；通过后告诉我如何用 /ima-diary 写日记。

约束：
- 不要把凭证提交到 git、贴进回复或发送到第三方服务。
- 遇到错误先看 README 的「常见问题」，不要跳过自检直接写日记。
```

## 这个技能解决什么

- **命名约束**：日记笔记的标题固定为 `YYYY-MM-DD`，一天一篇；同一天多写几次会追加 `## HH:mm` 小节，而不是新建第二篇。
- **手动触发**：只在用户显式点名技能时使用，不会被"帮我记一下"这类泛化请求自动选中。
- **日常够用**：写、补记、查看、检索、周/月回顾、导出成本地 `YYYY-MM-DD.md`，一条命令完成。
- **只负责记**：写入成功只回一行确认，不追问、不提醒、不主动清理；`check` 才做环境自检。

## 目录结构

```
.
├── README.md
├── UPSTREAM.md                  # 上游版本、来源、校验值与同步步骤
├── package.json
├── scripts/
│   ├── install.cjs              # 跨平台安装器（默认 ~/.agents/skills）
│   ├── install.sh               # POSIX 包装
│   └── install.cmd              # Windows 包装
├── ima-skill/                   # 上游 ima-skills 1.1.10（原样跟踪，勿改）
│   ├── SKILL.md
│   ├── ima_api.cjs
│   ├── meta.json
│   ├── notes/
│   └── knowledge-base/
└── ima-diary/                   # 新增：个人日记技能
    ├── SKILL.md                 # 手动触发规则、命名约束、用法
    ├── meta.json                # 技能版本与对 ima-skill 的依赖声明
    ├── references/api.md        # 依赖定位、存储约定、用到的 IMA 接口
    ├── scripts/
    │   ├── diary.cjs            # 命令行入口
    │   └── lib/                 # core / service / ima（调用 ima_api.cjs）/ config
    └── tests/                   # node:test + 假 IMA 服务
```

## 环境准备（首次使用按顺序做）

准备完成后即可用 `/ima-diary 写今天的日记`。每一步都给了 macOS/Linux 与 Windows 两种写法。

> 路径约定：文中的 `~/.agents/skills` 在 Windows 上是 `%USERPROFILE%\.agents\skills`；`~/.config/ima` 同理（Node 的 `os.homedir()`）。

### 1. 前置：Node.js ≥ 18

```bash
node -v            # macOS / Linux
```

```powershell
node -v            # Windows PowerShell
```

需要 v18 或更高。没有安装：macOS `brew install node`；Ubuntu/Debian `sudo apt install nodejs npm`；Windows 从 <https://nodejs.org> 下载 LTS，或 `winget install OpenJS.NodeJS.LTS`。

### 2. 安装两个技能（默认 ~/.agents/skills）

macOS / Linux：

```bash
git clone https://github.com/original-coding/ima-note-skill.git
cd ima-note-skill
./scripts/install.sh
```

Windows（PowerShell）：

```powershell
git clone https://github.com/original-coding/ima-note-skill.git
cd ima-note-skill
node scripts\install.cjs
# 或：.\scripts\install.cmd
```

安装器是同一份 Node 脚本：

- macOS/Linux 建软链；
- Windows 先试 symlink，失败则用 junction（通常不需要管理员权限），再不行才复制；
- 目标目录可用参数或 `AGENTS_SKILLS_DIR` 覆盖：`./scripts/install.sh /path/to/skills`、`node scripts\install.cjs D:\skills`；
- 只替换同名链接，不会删除已存在的同名真实目录；重复执行即可更新。

验证：

```bash
ls -l ~/.agents/skills/ima-skill ~/.agents/skills/ima-diary
```

```powershell
Get-ChildItem "$env:USERPROFILE\.agents\skills"
```

如果输出里带 `[copy]`，说明当前文件系统不支持链接，仓库更新后需要重跑安装脚本。

只想装 `ima-diary` 时，用 `IMA_SKILL_DIR` 指向 ima-skill：

```bash
export IMA_SKILL_DIR="$HOME/.agents/skills/ima-skill"
# 或写进 ~/.config/ima/diary.json 的 "imaSkillDir"
```

```powershell
$env:IMA_SKILL_DIR = "$env:USERPROFILE\.agents\skills\ima-skill"
```

### 3. 获取并配置 IMA 凭证（Client ID + API Key）

1. 浏览器打开 <https://ima.qq.com/agent-interface>，按提示登录 IMA 账号（没登录会先跳登录页）。
2. 页面上有「API Key」面板，点生成/新建，得到一对 **Client ID** 和 **API Key**。
   页面里如果出现"发给 OpenClaw/小龙虾完成配置"之类的提示，忽略即可——你只需要这两个值。
3. 先把它们存进密码管理器（API Key 可能只完整显示一次）。
4. 写入本机凭证目录（权限 700/600，且不把密钥留在 shell 历史里）：

macOS / Linux：

```bash
mkdir -p ~/.config/ima
chmod 700 ~/.config/ima

# 每条命令执行后粘贴对应值，再按 Ctrl-D 结束（密钥不会进 shell 历史）
cat > ~/.config/ima/client_id
cat > ~/.config/ima/api_key

chmod 600 ~/.config/ima/client_id ~/.config/ima/api_key
```

Windows（PowerShell，弹记事本粘贴保存）：

```powershell
$ima = Join-Path $env:USERPROFILE '.config\ima'
New-Item -ItemType Directory -Force -Path $ima | Out-Null
notepad (Join-Path $ima 'client_id')   # 粘贴 Client ID，保存
notepad (Join-Path $ima 'api_key')     # 粘贴 API Key，保存
```

验证文件存在：

```bash
test -s ~/.config/ima/client_id && test -s ~/.config/ima/api_key && echo "凭证已就绪"
```

```powershell
Test-Path (Join-Path $env:USERPROFILE '.config\ima\client_id')
Test-Path (Join-Path $env:USERPROFILE '.config\ima\api_key')
```

5. 真正的鉴权验证在第 5 步：`check` 输出 `✅ IMA 凭证可用` 才算成功。

凭证只作为请求头发往 `ima.qq.com`；`ima-diary` 不读取、不打印、不落盘凭证，由 `ima_api.cjs` 处理。也可以用环境变量 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` 临时覆盖（适合 CI/容器；Windows：`$env:IMA_OPENAPI_CLIENTID = '...'`）。

安全提示：

- 不要把凭证提交进 git、发到群聊或贴进 issue；本仓库的 `.gitignore` 也不覆盖 `~/.config/ima/`（它本来就在仓库外）。
- 凭证泄露时，回到同一页面重新生成一对，覆盖这两个文件即可，不需要改任何代码。

### 4. 准备日记笔记本（必须）

在 IMA 客户端里新建一个笔记本，名字与配置里的 `folder` 完全一致（默认 `日记`，你也可以用 `diary`）。技能**只在这个笔记本内读写**：找不到同名笔记本时会报错并拒绝写入，不会落到默认位置。

想换笔记本名或指定时区，写 `~/.config/ima/diary.json`：

```bash
mkdir -p ~/.config/ima
cat > ~/.config/ima/diary.json <<'EOF'
{
  "folder": "日记",
  "timeZone": "Asia/Shanghai"
}
EOF
```

```powershell
$ima = Join-Path $env:USERPROFILE '.config\ima'
New-Item -ItemType Directory -Force -Path $ima | Out-Null
@'
{
  "folder": "日记",
  "timeZone": "Asia/Shanghai"
}
'@ | Set-Content -Path (Join-Path $ima 'diary.json') -Encoding utf8
```

`timeZone` 决定"今天"和条目时间，不配置则用系统时区。服务器/容器通常是 UTC，建议显式设置，避免晚上写的日记落到前一天。

### 5. 自检（必须通过）

```bash
node ~/.agents/skills/ima-diary/scripts/diary.cjs check
```

```powershell
node "$env:USERPROFILE\.agents\skills\ima-diary\scripts\diary.cjs" check
```

期望输出类似：

```
🔗 ima-skill 1.1.10（/home/you/.agents/skills/ima-skill）
✅ IMA 凭证可用
📔 日记笔记本：「日记」
📚 可用笔记本：
  · 日记（N 篇）
```

失败时对照下面的 [常见问题](#常见问题)。

### 6. 跑通第一条日记

```bash
DIARY="$HOME/.agents/skills/ima-diary/scripts/diary.cjs"
node "$DIARY" write --content "环境准备好了。"
node "$DIARY" read
```

```powershell
$DIARY = "$env:USERPROFILE\.agents\skills\ima-diary\scripts\diary.cjs"
node $DIARY write --content "环境准备好了。"
node $DIARY read
```

`read` 应输出今天的标题 `# YYYY-MM-DD` 和 `## HH:mm` 小节。到这里环境就准备好了。

## 常见问题

| 现象                                         | 原因 / 处理                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `node: command not found` / 版本低于 18      | 安装 Node.js ≥ 18，重开终端                                                  |
| `{"code":-100,"msg":"未找到 ima-skills…"}`   | 两个技能没有同级安装；检查 skills 目录，或设置 `IMA_SKILL_DIR`               |
| `{"code":-100,"msg":"未找到 IMA 凭证…"}`     | 第 3 步没做或文件为空；重新写入并验证                                        |
| `未找到名为「…」的笔记本`（-100）           | 第 4 步未做或名字不一致；创建同名笔记本，或修改 `folder` 配置后重试           |
| `{"code":-200,…}`                            | 上游 ima-skills 有新版本；按 [UPSTREAM.md](UPSTREAM.md) 同步 `ima-skill/`    |
| 日记日期差一天                               | 系统时区是 UTC；在 `diary.json` 设置 `timeZone`（如 `Asia/Shanghai`）        |
| 安装输出带 `[copy]`                          | 文件系统不支持链接；更新仓库后重跑 `scripts/install.cjs`                     |
| Windows 上安装后改仓库不生效                 | 同上；确认是否 `[copy]`                                                      |

## 手动触发（技能声明）

`ima-diary` 仍然出现在模型可见的技能目录里；它的 description 把**触发条件**声明为「只能在用户显式调用时使用」。模型看到目录时不会被「帮我记一下」这类泛化请求触发。

- 斜杠调用：`/ima-diary 写今天的日记`
- 明确点名：「用 ima-diary 记一下：今天……」「调用日记技能」
- 只说「帮我记一下」时，模型会交给 `ima-skill` 的 notes，或先问你要不要用日记技能。

这属于**技能声明/触发条件**，不是把技能从模型目录里隐藏。

## 笔记命名约定

| 约束     | 说明                                                              |
| -------- | ----------------------------------------------------------------- |
| 位置     | 只在配置的笔记本（如 `diary`）内读写；其它位置同名笔记不参与       |
| 标题     | 只能是纯日期 `2026-10-28`，不加星期、心情、天气、后缀              |
| 一天一篇 | 同一笔记本内按标题精确查找，存在则追加、不存在才新建              |
| 不要改名 | 改成 `2026-10-28 日记` 后脚本会认不出，从而新建纯日期笔记并告警  |
| 时区     | 按 `IMA_DIARY_TZ` / `timeZone` 计算"今天"，避免 UTC 把日期算错     |
| 补记     | 用 `--date` 追加到指定日期，不改标题                              |

## 快速开始

```bash
DIARY="$HOME/.agents/skills/ima-diary/scripts/diary.cjs"

# 写今天
node "$DIARY" write --content "今天把日记技能接进来了。"

# 同一天再补一条（追加到同一篇）
node "$DIARY" write --content "睡前补一句：明天继续。" --time 22:40

# 补记昨天
node "$DIARY" write --date yesterday --content "昨天的流水账……"

# 查看 / 列出 / 搜索
node "$DIARY" read
node "$DIARY" list --days 7
node "$DIARY" search 跑步 --days 90

# 周回顾：先输出原文，再由 agent 总结
node "$DIARY" review --week

# 导出：每天一个 YYYY-MM-DD.md
node "$DIARY" export --month 2026-10 --out ~/diary
```

> Windows 用户把 `$HOME` 换成 `$env:USERPROFILE`、路径分隔符换成 `\`，参数不变；完整示例见「环境准备」第 6 步。

多行内容建议用临时文件，避免 shell 引号与换行问题：

```bash
TMP="$(mktemp)"
cat > "$TMP" <<'EOF'
今天发生了几件事：
1. 上午改脚本
2. 下午补测试
EOF
node "$DIARY" write --content-file "$TMP"
rm -f "$TMP"
```

## 命令

| 命令     | 作用                                                   |
| -------- | ------------------------------------------------------ |
| `write`  | 写/补记；`--dry-run` 只预览；`--mood/--weather/--tags` |
| `read`   | 读某天日记                                             |
| `list`   | 区间内哪些天写了、哪些天漏了                           |
| `search` | 在日记正文中检索                                       |
| `review` | 汇总区间原文（供 agent 总结）                          |
| `export` | 导出成本地 `YYYY-MM-DD.md`，默认不覆盖                 |
| `check`  | ima-skill、凭证、笔记本自检                            |

通用参数：`--json`、`--folder`、`--tz`、`--config`、`--date`、`--days`、`--month`、`--from/--to`。

## 配置

`~/.config/ima/diary.json`（可选）：

```json
{
  "folder": "日记",
  "timeZone": "Asia/Shanghai",
  "imaSkillDir": "/path/to/ima-skill"
}
```

| 配置          | 环境变量           | 默认值                         |
| ------------- | ------------------ | ------------------------------ |
| `folder`      | `IMA_DIARY_FOLDER` | `日记`；只在此笔记本内读写，找不到会报错。可改成 `diary` 等，名称需与 IMA 完全一致 |
| `timeZone`    | `IMA_DIARY_TZ`     | 系统时区                       |
| `imaSkillDir` | `IMA_SKILL_DIR`    | 同级 `../ima-skill` 或常见目录 |
| 配置文件      | `IMA_DIARY_CONFIG` | `~/.config/ima/diary.json`（Windows：`%USERPROFILE%\.config\ima\diary.json`） |

## 与 ima-skills 的分工

| 场景                       | 用谁        |
| -------------------------- | ----------- |
| 写/查/回顾某天的日记       | `ima-diary` |
| 普通笔记、备忘录、待办     | `ima-skill` |
| 知识库上传、网页收藏、搜索 | `ima-skill` |

`ima-diary` 刻意不接管普通"记一下"请求，避免和 `ima-skill` 的 notes 能力冲突。

## 跟踪与同步上游

`ima-skill/` 必须与上游 zip 内容一致。**不要修改它**，也不要随意提升 `ima-skill/meta.json` 的 `version`：

- `ima_api.cjs` 会拿该版本号与线上 `latest_version` 比较；不一致时每天首次请求会收到 `-200` 并被阻止。
- `ima-diary` 依赖其中的 `ima_api.cjs`，跟踪上游同时也保证克隆后测试可运行。

升级步骤（下载、校验、替换、跑测试）见 [UPSTREAM.md](UPSTREAM.md)。

## 测试

```bash
npm test    # node --test ima-diary/tests/*.test.cjs
```

测试会起本地假 IMA 服务，并通过**仓库跟踪的** `ima-skill/ima_api.cjs` 子进程发请求，覆盖：新建/追加、去重、**搜索索引延迟下的追加**、dry-run、读取、列表、搜索、回顾、导出、**JSON 正文渲染**、找不到笔记本、标题带后缀、后端错误、上游要求更新（-200）、ima-skill 自动发现与缺失提示、CLI 参数与退出码，以及跨平台安装器（链接/重复执行/冲突保护）。**不需要真实凭证，也不访问外网。**

## 安全

- 凭证只发往官方 API `https://ima.qq.com`；`ima-diary` 不读取、不打印、不落盘凭证。
- 导出默认不覆盖已有文件，需要覆盖时显式加 `--force`。
- 日记是隐私内容：群聊中只回报日期与"已记录"，不回显正文。
