# 上游 ima-skills

`ima-skill/` 是**上游 ima-skills 的原样副本**，用于审计、对照与测试；请不要在本地修改它。

| 项目         | 值                                                                 |
| ------------ | ------------------------------------------------------------------ |
| 版本         | 1.1.10                                                             |
| 来源         | <https://app-dl.ima.qq.com/skills/ima-skills-1.1.10.zip>           |
| 首页         | <https://ima.qq.com>                                               |
| 压缩包 SHA-256 | `7e0d07cae0f98145dc5147e84b77bcc557e2fc4b256b08907922637952c20a7b` |
| 同步日期     | 2026-10-28                                                         |

同步时只保留 zip 内 `ima-skill/` 的以下内容，忽略 `.DS_Store`、`.history/`、`__MACOSX/`：

```
ima-skill/
├── SKILL.md
├── ima_api.cjs
├── meta.json
├── notes/
└── knowledge-base/
```

## 为什么跟踪

- `ima-diary` 依赖 `ima-skill/ima_api.cjs`；同仓库携带后，克隆即可跑测试，也不怕上游链接失效。
- `ima_api.cjs` 会读取 `meta.json` 的 `version` 与线上 `latest_version` 比较，**版本号必须与上游一致**（当前 `1.1.10`），否则每天首次请求会收到 `-200` 并被阻止。
- 保留原样副本便于 `diff` 上游改动，也方便以后写合并说明。

## 同步步骤

1. 下载新版本 zip，并记录 SHA-256：

   ```bash
   curl -sSLo /tmp/ima-skills-new.zip https://app-dl.ima.qq.com/skills/ima-skills-<version>.zip
   sha256sum /tmp/ima-skills-new.zip
   ```

2. 解压到临时目录，用其中的 `ima-skill/` 整体替换本仓库的 `ima-skill/`（排除 `.DS_Store`、`.history/`、`__MACOSX/`）。
3. 更新本文档的版本、来源链接、SHA-256 与同步日期。
4. 跑 `npm test`。上游若调整了 notes 接口字段，按失败用例修改 `ima-diary/scripts/lib/service.cjs`。
5. 若新版本引入 `-200` 更新逻辑变化，同时检查 `ima-diary/scripts/lib/ima.cjs` 的错误透传。

> 只升级 `ima-skill/` 时，`ima-diary/` 通常不需要改动。
