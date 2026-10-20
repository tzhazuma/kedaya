#!/usr/bin/env bash
# deploy-web.sh —— 把 @kedaya/web（Next.js）部署到实验室服务器，并开一个 cloudflared quick tunnel。
#
# 为什么需要这个脚本？
#   服务器上没有 TypeScript / 没有仓库源码，Next.js 的 server 运行时又必须依赖
#   node_modules。所以约定：**本地构建，只上传构建产物 + 一份极小的运行时
#   package.json/package-lock.json，服务器上执行 npm ci --omit=dev**。
#   这样服务器不需要编译，也不会把整个 monorepo（含 API、小程序）搬上去。
#
# 用法（密码只从环境变量读，绝不落盘）：
#   DEPLOY_HOST=tangzh@10.19.138.148 \
#   DEPLOY_PASS='<密码>' \
#   ./scripts/deploy-web.sh
#
# 可用环境变量：
#   DEPLOY_HOST      必填。`user@host` 或 `host`（host 时用 DEPLOY_USER，默认 tangzh）
#   DEPLOY_PASS      可选。给了就用 sshpass；不给则走 SSH key / ssh-agent
#   DEPLOY_USER      可选。DEPLOY_HOST 不含 @ 时使用，默认 tangzh
#   WEB_PORT         可选。远端监听端口，默认 3200（刻意避开 API 的 3100）
#   REMOTE_ROOT      可选。远端目录名，默认 kedaya-web（相对 $HOME，禁止绝对路径）
#   CLOUDFLARED_BIN  可选。远端 cloudflared 路径，默认 $HOME/cloudflared
#   NEXT_BUILD_ENGINE 可选。webpack（默认）或 turbopack
#   SKIP_BUILD       可选。=1 时复用现有 apps/web/.next（调试脚本用）
#
# 铁律：脚本只会写远端 $HOME/$REMOTE_ROOT；不会碰 ~/kedaya-api 或其他同学目录。
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_ROOT="${REMOTE_ROOT:-kedaya-web}"
WEB_PORT="${WEB_PORT:-3200}"
DEPLOY_USER="${DEPLOY_USER:-tangzh}"
NEXT_BUILD_ENGINE="${NEXT_BUILD_ENGINE:-webpack}"
SKIP_BUILD="${SKIP_BUILD:-0}"

die() { echo "[deploy-web] 错误: $*" >&2; exit 1; }
log() { echo "[deploy-web] $*"; }

# ---------- 0. 参数与本地检查 ----------
[ -n "${DEPLOY_HOST:-}" ] || die "必须设置 DEPLOY_HOST，例如 DEPLOY_HOST=tangzh@10.19.138.148"
[ -n "${DEPLOY_PASS:-}" ] || log "未设置 DEPLOY_PASS，将使用 SSH key / ssh-agent 认证"

# REMOTE_ROOT 必须是 $HOME 下的简单目录名，避免手滑写到别处
case "$REMOTE_ROOT" in
  .|..|/*|*/*|*' '*) die "REMOTE_ROOT 只能是 \$HOME 下的单层目录名，当前: $REMOTE_ROOT" ;;
esac
case "$WEB_PORT" in
  ''|*[!0-9]*) die "WEB_PORT 必须是数字，当前: $WEB_PORT" ;;
esac
[ "$WEB_PORT" != "3100" ] || die "3100 是 API 端口，Web 不允许占用"

if [[ "$DEPLOY_HOST" == *"@"* ]]; then
  TARGET="$DEPLOY_HOST"
else
  TARGET="$DEPLOY_USER@$DEPLOY_HOST"
fi

command -v node >/dev/null 2>&1 || die "找不到 node；请先把 Node（>=20.9，推荐 22/24）加入 PATH"
command -v npm >/dev/null 2>&1 || die "找不到 npm"
command -v curl >/dev/null 2>&1 || die "找不到 curl"
command -v tar >/dev/null 2>&1 || die "找不到 tar"
command -v rsync >/dev/null 2>&1 || die "找不到 rsync（macOS 自带；Linux 用 apt install rsync）"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "本地 Node 太旧（$(node -v)），Next.js 16 需要 >=20.9"

# ssh / scp 封装：有密码用 sshpass -e（密码只通过环境变量传递）
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15)
if [ -n "${DEPLOY_PASS:-}" ]; then
  command -v sshpass >/dev/null 2>&1 || die "设置了 DEPLOY_PASS 但本机没有 sshpass（brew install sshpass / apt install sshpass）"
  export SSHPASS="$DEPLOY_PASS"
  # 明确只走密码认证：避免 ssh 在密码失败时再去尝试 publickey/askpass，把一次瞬时失败放大成 3 次重试。
  SSH_OPTS+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1)
  SSH=(sshpass -e ssh "${SSH_OPTS[@]}")
  SCP=(sshpass -e scp "${SSH_OPTS[@]}")
else
  SSH=(ssh "${SSH_OPTS[@]}")
  SCP=(scp "${SSH_OPTS[@]}")
fi

# ---------- 1. 本地构建 ----------
if [ "$SKIP_BUILD" = "1" ]; then
  log "跳过构建（SKIP_BUILD=1），复用 apps/web/.next"
else
  case "$NEXT_BUILD_ENGINE" in
    webpack) BUILD_ARGS=(--webpack) ;;
    turbopack) BUILD_ARGS=(--turbopack) ;;
    *) die "NEXT_BUILD_ENGINE 只能是 webpack 或 turbopack" ;;
  esac

  log "本地构建 @kedaya/web（engine=$NEXT_BUILD_ENGINE）…"
  # 为什么默认 webpack：Turbopack 的 CSS/Node transform pool 会加载
  # lightningcss 的平台二进制；在「用 Rosetta x64 Node 装过依赖、又用 arm64
  # Node 构建」的机器上会找不到 lightningcss-darwin-arm64，构建直接失败。
  # webpack 构建走进程内 postcss，不受这个可选依赖影响，产物完全等价。
  npm run build -w @kedaya/web -- "${BUILD_ARGS[@]}"
fi
[ -f apps/web/.next/BUILD_ID ] || die "构建产物缺失：apps/web/.next/BUILD_ID 不存在"

# ---------- 2. 组装「可移植运行包」 ----------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kedaya-web-deploy.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE/.next"

log "打包构建产物（排除 .next/cache，约 10MB）…"
# .next/cache 是本地增量缓存（240MB），服务器用不到；排除后包体从 250MB 降到 ~11MB。
rsync -a --exclude '/cache' apps/web/.next/ "$STAGE/.next/"
cp -R apps/web/public "$STAGE/public"

# 运行时 package.json：只保留 Next server 真正 require 的包。
# @kedaya/* 共享包在 build 时已被 transpilePackages 打进 .next/server，
# 客户端依赖（react-query/leaflet/...）也已经是浏览器 bundle，运行时都不需要。
cat > "$STAGE/package.json" <<'JSON'
{
  "name": "kedaya-web-runtime",
  "version": "0.1.0",
  "private": true,
  "description": "可达鸭 Web 门户的服务器运行包（由 scripts/deploy-web.sh 生成）",
  "scripts": {
    "start": "next start -H 127.0.0.1"
  },
  "dependencies": {
    "next": "16.4.2",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  }
}
JSON

log "生成运行时 package-lock.json…"
( cd "$STAGE" && npm install --package-lock-only --omit=dev --no-audit --no-fund >/dev/null )
[ -f "$STAGE/package-lock.json" ] || die "未能生成运行时 package-lock.json"

BUNDLE="$WORK/web-bundle.tgz"
# macOS 的 bsdtar 会把扩展属性写成 LIBARCHIVE.xattr.*，还会带 ._ AppleDouble 文件：
# GNU tar 解包时会刷几百行 "Ignoring unknown extended header keyword" 警告，
# 而且会在 release 里留下无用的 ._ 文件。能关就关（GNU tar 也支持这两个开关）。
TAR_FLAGS=""
if tar --no-xattrs -cf /dev/null -T /dev/null 2>/dev/null; then
  TAR_FLAGS="$TAR_FLAGS --no-xattrs"
fi
if tar --no-mac-metadata -cf /dev/null -T /dev/null 2>/dev/null; then
  TAR_FLAGS="$TAR_FLAGS --no-mac-metadata"
fi
# shellcheck disable=SC2086  # 这里就是要把 TAR_FLAGS 按空格拆成多个参数
tar $TAR_FLAGS -czf "$BUNDLE" -C "$STAGE" .next public package.json package-lock.json
log "运行包大小: $(du -h "$BUNDLE" | awk '{print $1}')"

# ---------- 3. 上传 ----------
TS="$(date +%Y%m%d-%H%M%S)"
RELEASE="$REMOTE_ROOT/releases/$TS"
log "上传到 $TARGET:$RELEASE …"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' RELEASE_TS='$TS' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME"
mkdir -p "$REMOTE_ROOT/releases/$RELEASE_TS" "$REMOTE_ROOT/app" "$REMOTE_ROOT/logs" "$REMOTE_ROOT/run"
REMOTE
"${SCP[@]}" "$BUNDLE" "$TARGET:$RELEASE/bundle.tgz"

# ---------- 4. 远端解包 + 安装运行时依赖 ----------
log "远端解包并准备运行时…"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' RELEASE_TS='$TS' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT"
release="releases/$RELEASE_TS"
[ -f "$release/bundle.tgz" ] || { echo "上传包不存在: $release/bundle.tgz" >&2; exit 1; }
tar -xzf "$release/bundle.tgz" -C "$release"
rm -f "$release/bundle.tgz"

# app/ 是固定运行目录；.next/public 用相对软链指向具体 release，
# 这样一次 npm ci 的 node_modules 可以被所有 release 复用（服务器磁盘只剩 25G）。
cd app
ln -sfn "../releases/$RELEASE_TS/.next" .next
ln -sfn "../releases/$RELEASE_TS/public" public
# 关键：.next 是软链，Node 解析 .next/server/app/*.js 时会以「真实路径」
# （releases/TS/...）为起点向上找 node_modules。所以每个 release 里必须有一个
# 指回 app/node_modules 的软链，否则会报 Cannot find module 'next/dist/compiled/...'。
ln -sfn ../../app/node_modules "../releases/$RELEASE_TS/node_modules"
cp "../releases/$RELEASE_TS/package.json" package.json
cp "../releases/$RELEASE_TS/package-lock.json" package-lock.json
REMOTE

# 依赖没变就跳过 npm ci；变了则先停旧进程再装，避免正在运行的进程看到被清空的 node_modules
if command -v shasum >/dev/null 2>&1; then
  LOCK_SHA="$(shasum -a 256 "$STAGE/package-lock.json" | awk '{print $1}')"
else
  LOCK_SHA="$(sha256sum "$STAGE/package-lock.json" | awk '{print $1}')"
fi
log "运行时依赖指纹: ${LOCK_SHA:0:12}"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' LOCK_SHA='$LOCK_SHA' WEB_PORT='$WEB_PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT/app"
if [ -f .deps-sha ] && [ "$(cat .deps-sha)" = "$LOCK_SHA" ] && [ -d node_modules/next ]; then
  echo "依赖未变化，复用 app/node_modules"
  exit 0
fi

stop_old() {
  if [ -f ../run/web.pid ]; then
    pid="$(cat ../run/web.pid)"
    if kill -0 "$pid" 2>/dev/null; then
      cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      if [ "$cwd" = "$HOME/$REMOTE_ROOT/app" ]; then
        echo "停止旧 Web 进程 pid=$pid"
        kill "$pid"
      else
        echo "pid=$pid 不属于 $REMOTE_ROOT/app，拒绝 kill" >&2
      fi
    fi
    rm -f ../run/web.pid
  fi
  # 等端口释放；如果是别人的进程占着，直接报错，绝不 kill
  for _ in $(seq 1 30); do
    ss -ltn 2>/dev/null | grep -q ":$WEB_PORT " || return 0
    sleep 0.5
  done
  echo "端口 $WEB_PORT 仍被占用（不是本脚本的进程），中止" >&2
  exit 3
}
stop_old

echo "安装运行时依赖（npm ci --omit=dev）…"
npm ci --omit=dev --no-audit --no-fund
echo "$LOCK_SHA" > .deps-sha
REMOTE

# ---------- 5. 切换 release + 重启 Web ----------
log "切换 current release 并重启 Web（127.0.0.1:$WEB_PORT）…"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' RELEASE_TS='$TS' WEB_PORT='$WEB_PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT"

# 停掉旧的 Web（只认 pid 文件 + /proc/<pid>/cwd，避免误杀别人的 node）
if [ -f run/web.pid ]; then
  pid="$(cat run/web.pid)"
  if kill -0 "$pid" 2>/dev/null; then
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$HOME/$REMOTE_ROOT/app" ]; then
      kill "$pid"
    else
      echo "pid=$pid 不属于 $REMOTE_ROOT/app，拒绝 kill" >&2
    fi
  fi
  rm -f run/web.pid
fi
for _ in $(seq 1 30); do
  ss -ltn 2>/dev/null | grep -q ":$WEB_PORT " || break
  sleep 0.5
done
if ss -ltn 2>/dev/null | grep -q ":$WEB_PORT "; then
  echo "端口 $WEB_PORT 被占用（不是本脚本的进程），中止" >&2
  exit 3
fi

cd app
NEXT_TELEMETRY_DISABLED=1 nohup node node_modules/next/dist/bin/next start \
  -H 127.0.0.1 -p "$WEB_PORT" >> ../logs/web.log 2>&1 < /dev/null &
echo $! > ../run/web.pid

# health check：最多等 60s
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)"
  [ "$code" = "200" ] && { echo "Web 已就绪 pid=$(cat ../run/web.pid)"; exit 0; }
  sleep 1
done
echo "Web 启动失败，最近日志：" >&2
tail -n 60 ../logs/web.log >&2
exit 1
REMOTE

# ---------- 6. cloudflared quick tunnel ----------
log "确保 cloudflared quick tunnel 指向 127.0.0.1:$WEB_PORT …"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' WEB_PORT='$WEB_PORT' CLOUDFLARED_BIN='${CLOUDFLARED_BIN:-}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT"
mkdir -p logs run
[ -n "${CLOUDFLARED_BIN:-}" ] || CLOUDFLARED_BIN="$HOME/cloudflared"
[ -x "$CLOUDFLARED_BIN" ] || { echo "找不到可执行的 cloudflared: $CLOUDFLARED_BIN" >&2; exit 1; }

reuse=""
if [ -f run/cloudflared.pid ]; then
  pid="$(cat run/cloudflared.pid)"
  if kill -0 "$pid" 2>/dev/null; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *"cloudflared"*"127.0.0.1:$WEB_PORT"*) reuse="$pid" ;;
    esac
  fi
  [ -n "$reuse" ] || rm -f run/cloudflared.pid
fi

if [ -n "$reuse" ]; then
  echo "复用已在运行的 tunnel pid=$reuse"
else
  echo "启动新的 quick tunnel…"
  : > logs/cloudflared.log
  nohup "$CLOUDFLARED_BIN" tunnel --url "http://127.0.0.1:$WEB_PORT" \
    --protocol http2 --no-autoupdate >> logs/cloudflared.log 2>&1 < /dev/null &
  echo $! > run/cloudflared.pid
fi

for _ in $(seq 1 40); do
  url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' logs/cloudflared.log | tail -n 1 || true)"
  if [ -n "$url" ]; then
    echo "$url" > run/public-url.txt
    echo "PUBLIC_URL=$url"
    exit 0
  fi
  sleep 1
done
echo "未能从 cloudflared 日志中解析出 URL，最近日志：" >&2
tail -n 40 logs/cloudflared.log >&2
exit 1
REMOTE

PUBLIC_URL="$("${SSH[@]}" "$TARGET" "cat '$REMOTE_ROOT/run/public-url.txt'")"
[ -n "$PUBLIC_URL" ] || die "无法读取公网 URL"

# ---------- 7. 验证 ----------
log "验证远端本地端口…"
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' WEB_PORT='$WEB_PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT"
check_file="run/.local-check.html"
for path in / /import; do
  out="$(curl -sS -o "$check_file" -w '%{http_code} %{size_download}' "http://127.0.0.1:$WEB_PORT$path")"
  grep -qi '<!DOCTYPE html>' "$check_file" || { echo "$path 不是 HTML" >&2; exit 1; }
  echo "  本地 $path -> $out"
done
rm -f "$check_file"
REMOTE

log "验证公网 URL（可能需要等 DNS/边缘生效）…"
PUBLIC_CHECK_OK=0
for attempt in $(seq 1 12); do
  for path in / /import; do
    body="$WORK/public-check.html"
    resp="$(curl -sS -L --max-time 25 -o "$body" -w '%{http_code} %{size_download}' "$PUBLIC_URL$path" 2>/dev/null || true)"
    code="${resp%% *}"; size="${resp##* }"
    [ -n "$code" ] || code=000
    [ -n "$size" ] || size=0
    if [ "$code" = "200" ] && grep -qi '<!DOCTYPE html>' "$body"; then
      echo "  公网 $path -> $code ${size}B"
      [ "$path" = "/import" ] && PUBLIC_CHECK_OK=1
    else
      echo "  公网 $path -> $code（第 $attempt 次，稍后重试）"
      sleep 5
      break
    fi
  done
  [ "$PUBLIC_CHECK_OK" = "1" ] && break
done
[ "$PUBLIC_CHECK_OK" = "1" ] || die "公网验证失败；URL=$PUBLIC_URL（tunnel 可能需要更久，稍后手动 curl 重试）"

# ---------- 8. 输出摘要 ----------
cat <<EOF

============================================================
✅ Web 部署完成
  公网 URL : $PUBLIC_URL
  首页     : $PUBLIC_URL/
  子路由   : $PUBLIC_URL/import
  远端目录 : ~/$REMOTE_ROOT
  监听端口 : 127.0.0.1:$WEB_PORT（只监听回环，公网只走 cloudflared）
  当前版本 : ~/$REMOTE_ROOT/releases/$TS
  重启命令 : ssh $TARGET '~/$REMOTE_ROOT/restart-web.sh'
  回滚     : 见 docs/deploy-web.md 第 6 节
============================================================
EOF

# 生成可重复使用的重启脚本（放在远端 ~/kedaya-web 下，不写系统目录）
"${SSH[@]}" "$TARGET" "REMOTE_ROOT='$REMOTE_ROOT' WEB_PORT='$WEB_PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$REMOTE_ROOT"
cat > restart-web.sh <<'SH'
#!/usr/bin/env bash
# 只重启 Web（不动 cloudflared 隧道，URL 不变）。由 deploy-web.sh 生成。
set -euo pipefail
cd "$(dirname "$0")"
PORT="${WEB_PORT:-__WEB_PORT__}"
if [ -f run/web.pid ]; then
  pid="$(cat run/web.pid)"
  if kill -0 "$pid" 2>/dev/null; then
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$PWD/app" ]; then kill "$pid"; fi
  fi
  rm -f run/web.pid
fi
for _ in $(seq 1 30); do ss -ltn 2>/dev/null | grep -q ":$PORT " || break; sleep 0.5; done
cd app
NEXT_TELEMETRY_DISABLED=1 nohup node node_modules/next/dist/bin/next start \
  -H 127.0.0.1 -p "$PORT" >> ../logs/web.log 2>&1 < /dev/null &
echo $! > ../run/web.pid
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  [ "$code" = "200" ] && { echo "Web 已重启 pid=$(cat ../run/web.pid) port=$PORT"; exit 0; }
  sleep 1
done
echo "重启失败，查看 logs/web.log" >&2
exit 1
SH
chmod +x restart-web.sh
sed -i "s/__WEB_PORT__/$WEB_PORT/" restart-web.sh
REMOTE

log "完成。"
