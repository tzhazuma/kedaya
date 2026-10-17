#!/usr/bin/env bash
# with-npm-lock.sh —— 串行化 npm 操作，避免多个并行工作流同时改 node_modules 而互相破坏。
#
# 用法:
#   ./scripts/with-npm-lock.sh npm install
#   ./scripts/with-npm-lock.sh npm run build -w @kedaya/web
#
# 原理: 用 mkdir 的原子性做 advisory mutex。最多等待 LOCK_WAIT 秒。
set -euo pipefail

LOCK_DIR="${TMPDIR:-/tmp}/kedaya-npm.lock"
LOCK_WAIT="${LOCK_WAIT:-900}"
LOCK_STALE="${LOCK_STALE:-1200}"

waited=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  # 陈旧锁回收：锁目录存在超过 LOCK_STALE 秒则认为持有者已死
  if [ -d "$LOCK_DIR" ]; then
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +$((LOCK_STALE / 60)) 2>/dev/null)" ]; then
      echo "[with-npm-lock] 回收陈旧锁 (超过 ${LOCK_STALE}s)" >&2
      rm -rf "$LOCK_DIR"
      continue
    fi
  fi
  if [ "$waited" -ge "$LOCK_WAIT" ]; then
    echo "[with-npm-lock] 等待锁超时 (${LOCK_WAIT}s): $LOCK_DIR" >&2
    exit 75
  fi
  sleep 3
  waited=$((waited + 3))
done

cleanup() { rm -rf "$LOCK_DIR"; }
trap cleanup EXIT INT TERM

echo "[with-npm-lock] 已获取锁，执行: $*" >&2
"$@"
