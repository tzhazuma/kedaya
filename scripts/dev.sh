#!/usr/bin/env bash
# 从任意目录启动本地 Mock 演示，并使用项目指定的 Node 版本。
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-web}"
if [ "$#" -gt 0 ]; then shift; fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use --silent
fi

case "$target" in
  web) exec npm run dev:web -- "$@" ;;
  weapp) exec npm run dev:weapp -- "$@" ;;
  *) echo "用法: ./scripts/dev.sh [web|weapp]" >&2; exit 2 ;;
esac
