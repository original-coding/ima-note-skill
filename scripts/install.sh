#!/usr/bin/env bash
# 跨平台安装脚本的 POSIX 包装：等价于 node scripts/install.cjs "$@"
#
# 用法：
#   ./scripts/install.sh                  # 默认 ~/.agents/skills
#   ./scripts/install.sh /path/to/skills  # 指定目录
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/install.cjs" "$@"
