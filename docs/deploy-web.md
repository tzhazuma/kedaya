# 部署 Web 门户到实验室服务器

> 目标：把 `apps/web`（Next.js App Router）跑在实验室服务器的 `~/kedaya-web` 下，
> 通过 cloudflared quick tunnel 暴露一个公网 HTTPS URL。
>
> **本文只覆盖 Web 端**。API 服务（`~/kedaya-api`，端口 3100）由服务器上已有的进程在跑，
> 本部署**不读写、不重启、不修改**它的任何文件。

---

## 0. 当前部署结果（2026-10-20）

| 项 | 值 |
| --- | --- |
| 公网 URL | `https://fence-plasma-reservoir-dictionaries.trycloudflare.com` |
| 首页 | `https://fence-plasma-reservoir-dictionaries.trycloudflare.com/` |
| 子路由示例 | `https://fence-plasma-reservoir-dictionaries.trycloudflare.com/import` |
| 服务器路径 | `/home/tangzh/kedaya-web` |
| 监听 | `127.0.0.1:3200`（只监听回环，公网只走隧道） |
| 运行时 | `/usr/bin/node` v24.15.0 + 服务器自带 npm 11.12.1 |
| 当前 release | `~/kedaya-web/releases/20261020-140815` |

实测：

```text
GET /        -> 200  132143 B  text/html; charset=utf-8
GET /import  -> 200   22253 B  text/html; charset=utf-8  <title>导入课程 DDL · 可达鸭</title>
```

> ⚠️ quick tunnel 的域名是**临时的**：cloudflared 进程重启后会换一个新域名。
> 当前域名始终可以从服务器上的 `~/kedaya-web/run/public-url.txt` 读到。

---

## 1. 为什么选方案 B（`.next` + 服务器 `npm ci`）

题目给了两个方案：

### 方案 A：`output: 'standalone'`

Next.js 的 standalone 会把运行时依赖裁成一份 `node_modules`，理论上最省事。
但在这个仓库/这台机器上不适用：

1. **要改 `next.config.ts`**。standalone 只能通过配置 `output: 'standalone'` 打开；
   本次任务明确不允许改 `apps/web` 的源码/配置，所以不能走这条路。
2. **本地是 macOS（arm64），服务器是 Linux（x86_64）**。standalone 的
   `node_modules` 在本地做文件追踪，可能把 Darwin 的原生二进制
   （如 `@next/swc-darwin-arm64`、`lightningcss-darwin-arm64`）带进产物，
   到 Linux 上直接 `Cannot find module ... .node`。
3. 本机 `node_modules` 曾用 Rosetta（x64）Node 安装，Turbopack 构建会去找
   `lightningcss.darwin-x64.node` 而失败；standalone 同样依赖这套可选原生包。

### 方案 B：上传 `.next` + 服务器安装运行时依赖（**采用**）

- 服务器只负责**跑**，不负责编译；不需要 TypeScript / 源码 / monorepo。
- 服务器上 `npm ci --omit=dev` 按 **Linux x86_64** 拉取正确的原生可选依赖，
  从根上避免“macOS 产物跑在 Linux”的架构问题。
- 只上传 `.next`（排除 240MB 的增量缓存）+ `public` + 一个极小的运行时
  `package.json`，压缩后约 **2MB**（实测 1.9MB），上传很快。
- 运行时只需要 3 个直接依赖：`next@16.4.2`、`react@19.3.1`、`react-dom@19.3.1`。
  `@kedaya/*` 共享包在 build 阶段已经被 `transpilePackages` 打进 `.next/server`，
  客户端依赖（react-query / leaflet / lucide …）也已经是浏览器 bundle，运行时都不需要。
- 代价：服务器上有一份约 **352MB** 的 `node_modules`。这是可接受的，
  而且它只存在于 `~/kedaya-web/app/node_modules`，不污染其他目录。

---

## 2. 本地构建

在**仓库根目录**执行（构建产物在 `apps/web/.next`）：

```bash
npm run build -w @kedaya/web -- --webpack
```

> 为什么显式加 `--webpack`？
> Next 16 默认用 Turbopack。本机 `node_modules` 里的
> `@tailwindcss/node/node_modules/lightningcss` 只有 x64 原生包
> （因为依赖最初是在 Rosetta x64 Node 下装的），用 arm64 Node 构建时
> Turbopack 的 Node transform pool 会报：
> `Cannot find module '../lightningcss.darwin-x64.node'`。
> `--webpack` 走进程内 postcss，不依赖这个可选原生包，产物等价且更稳。
> 如果换一台干净机器、依赖按当前架构重装，也可以直接
> `npm run build -w @kedaya/web` 或 `NEXT_BUILD_ENGINE=turbopack`。

构建时注意：

- `NEXT_PUBLIC_*` 是**构建期内联**的，改了必须重新 build，不是重启就能生效。
- 默认 `NEXT_PUBLIC_KEDAYA_USE_MOCK=true`，即页面用 mock 数据，**不需要 API 也能打开**。
  如果要接真实 API：

  ```bash
  NEXT_PUBLIC_KEDAYA_USE_MOCK=false \
  NEXT_PUBLIC_KEDAYA_API_BASE='https://<API 的公网地址>/api/v1' \
  npm run build -w @kedaya/web -- --webpack
  ```

  注意 `NEXT_PUBLIC_KEDAYA_API_BASE` 是给**浏览器**用的，不能填 `127.0.0.1`。

---

## 3. 上传了什么

`scripts/deploy-web.sh` 在本地临时目录组装一个“运行包”：

| 内容 | 说明 |
| --- | --- |
| `.next/` | 生产构建产物；**排除 `.next/cache`**（本地增量缓存，服务器用不到） |
| `public/` | 静态资源（品牌图、图标等） |
| `package.json` | 只含 `next` / `react` / `react-dom`，由脚本生成 |
| `package-lock.json` | 由脚本在本地生成，固定服务器上 `npm ci` 的解析结果 |

压缩后约 **2MB**（实测 1.9MB）。服务器端解包后再执行：

```bash
cd ~/kedaya-web/app
npm ci --omit=dev --no-audit --no-fund
```

**没有上传**：仓库源码、`apps/web/src`、`apps/web/next.config.ts`、整个 monorepo、
`node_modules`、`.next/cache`。

---

## 4. 服务器目录布局

```text
~/kedaya-web/
├── app/                         # 固定运行目录（cwd）
│   ├── package.json             # 运行时依赖声明（脚本生成）
│   ├── package-lock.json        # 运行时锁文件
│   ├── node_modules/            # npm ci 安装，约 352MB，所有 release 共享
│   ├── .next -> ../releases/<当前版本>/.next
│   └── public -> ../releases/<当前版本>/public
├── releases/
│   └── 20261020-140815/
│       ├── .next/               # 约 12MB
│       ├── public/              # 约 700KB
│       ├── package.json
│       ├── package-lock.json
│       └── node_modules -> ../../app/node_modules
├── logs/
│   ├── web.log                  # Next 的 stdout/stderr
│   └── cloudflared.log          # quick tunnel 日志（含公网 URL）
├── run/
│   ├── web.pid                  # Next 进程 pid
│   ├── cloudflared.pid          # 本 Web 专属 cloudflared pid
│   └── public-url.txt           # 最近一次解析出的公网 URL
└── restart-web.sh               # 只重启 Web，不动隧道
```

两个容易踩的点，都是“路径/软链”导致的：

1. **`.next` 是软链，所以 release 里必须再有 `node_modules` 软链。**
   Node 解析 `.next/server/app/page.js` 时会以**真实路径**
   `releases/<版本>/.next/...` 为起点向上找 `node_modules`。
   如果只在 `app/node_modules` 有依赖，会报：

   ```text
   Cannot find module 'next/dist/compiled/next-server/app-page.runtime.prod.js'
   ```

   因此每个 release 都有一个 `node_modules -> ../../app/node_modules` 的软链。

2. **依赖变了要先停 Web 再 `npm ci`。**
   `npm ci` 会先删掉 `app/node_modules` 再重装；如果此时旧进程还在跑，
   它下次 `require` 可能正好落在空目录上。脚本用 lockfile 的 sha256 判断：
   依赖没变就跳过安装；变了先停进程再装。

---

## 5. 首次部署 / 重复部署

密码**不要写进命令历史或仓库**，用环境变量传：

```bash
cd /path/to/kedaya

DEPLOY_HOST='tangzh@10.19.138.148' \
DEPLOY_PASS='<服务器密码>' \
./scripts/deploy-web.sh
```

脚本会依次做：

1. `npm run build -w @kedaya/web -- --webpack`（可用 `NEXT_BUILD_ENGINE=turbopack` 改）
2. 组装运行包并压缩
3. `scp` 到 `~/kedaya-web/releases/<时间戳>/`
4. 远端解包，切换 `app/.next`、`app/public` 软链
5. 依赖变化时 `npm ci --omit=dev`
6. 重启 Next（`127.0.0.1:3200`）
7. 确保 cloudflared quick tunnel 指向 3200
8. 本地 + 公网双重验证（`/` 和 `/import` 必须 200 且是 HTML）
9. 生成/更新 `~/kedaya-web/restart-web.sh`

可用变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | 必填 | `user@host`；不含 `@` 时用 `DEPLOY_USER` |
| `DEPLOY_PASS` | 空 | 不填则走 SSH key / ssh-agent |
| `DEPLOY_USER` | `tangzh` | `DEPLOY_HOST` 不含 `@` 时使用 |
| `WEB_PORT` | `3200` | 远端监听端口，脚本禁止用 3100 |
| `REMOTE_ROOT` | `kedaya-web` | 只能是 `$HOME` 下的单层目录名 |
| `CLOUDFLARED_BIN` | `$HOME/cloudflared` | 远端 cloudflared 路径 |
| `NEXT_BUILD_ENGINE` | `webpack` | `webpack` 或 `turbopack` |
| `SKIP_BUILD` | `0` | `=1` 复用现有 `.next`（调试用，正常别用） |

---

## 6. 启动 / 重启 / 停止

### 启动（脚本已自动做过；手工等价命令）

```bash
cd ~/kedaya-web/app
NEXT_TELEMETRY_DISABLED=1 nohup node node_modules/next/dist/bin/next start \
  -H 127.0.0.1 -p 3200 >> ../logs/web.log 2>&1 &
echo $! > ../run/web.pid
```

只绑 `127.0.0.1` 而不是 `0.0.0.0`：公网入口只有 cloudflared，避免实验室网段
直接扫到 3200。

### 重启（一句话）

```bash
ssh tangzh@10.19.138.148 '~/kedaya-web/restart-web.sh'
```

`restart-web.sh` 只重启 Next，**不重启 cloudflared**，所以公网 URL 不变。
它会校验 pid 对应的进程 cwd 必须是 `~/kedaya-web/app`，不会误杀别人的 node。

### 停止（不删文件）

```bash
# 只停 Web
kill "$(cat ~/kedaya-web/run/web.pid)"

# 如果也要停本 Web 的隧道（只认自己的 pid 文件，别 kill 3100/8888 的 tunnel）
kill "$(cat ~/kedaya-web/run/cloudflared.pid)"
```

### 查看日志

```bash
tail -f ~/kedaya-web/logs/web.log
tail -f ~/kedaya-web/logs/cloudflared.log
```

### 服务器重启后

本部署用 `nohup` 常驻，**没有配置 systemd / 开机自启**（实验室服务器是共用机，
不写系统级服务）。服务器重启后 Web 和隧道都会消失，重新执行一次部署脚本即可：

```bash
DEPLOY_HOST=... DEPLOY_PASS=... ./scripts/deploy-web.sh
```

如果只想手工拉起，按第 6 节的启动命令启动 Next，再按第 7 节启动 cloudflared；
quick tunnel 会换一个新域名，记得重新读 `run/public-url.txt`。

---

## 7. cloudflared quick tunnel

本 Web 用**独立**的 cloudflared 进程，和 API 的隧道互不影响：

```bash
nohup ~/cloudflared tunnel \
  --url http://127.0.0.1:3200 \
  --protocol http2 \
  --no-autoupdate \
  >> ~/kedaya-web/logs/cloudflared.log 2>&1 &
echo $! > ~/kedaya-web/run/cloudflared.pid
```

URL 解析：

```bash
grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' \
  ~/kedaya-web/logs/cloudflared.log | tail -n 1
# 或直接看脚本写好的文件
cat ~/kedaya-web/run/public-url.txt
```

注意：

- quick tunnel **没有 SLA、域名随机、重启即换**；它适合演示/联调，不适合长期生产。
- 如果要固定域名，需要 Cloudflare 账号 + named tunnel + DNS，不在本文范围。
- 不要复用 API 的 tunnel 进程，也不要把 3100 的隧道指向 3200。

---

## 8. 验证

本地（服务器上）：

```bash
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:3200/
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:3200/import
```

公网：

```bash
URL="$(cat ~/kedaya-web/run/public-url.txt)"
curl -sS -L -o /tmp/web-root.html -w '%{http_code} %{size_download}\n' "$URL/"
curl -sS -L -o /tmp/web-import.html -w '%{http_code} %{size_download}\n' "$URL/import"
grep -qi '<!DOCTYPE html>' /tmp/web-root.html && echo HTML_OK
```

本次实测结果（2026-10-20，重启后复测）：

| 路径 | 状态码 | 大小 | Content-Type |
| --- | --- | --- | --- |
| `/` | 200 | 132143 B | `text/html; charset=utf-8` |
| `/import` | 200 | 22253 B | `text/html; charset=utf-8` |

---

## 9. 回滚

每次部署都是一个独立 release，回滚 = 把软链指回旧版本 + 重启。
`node_modules` 是共享的；只要运行时依赖没变，就不需要重装。

```bash
ssh tangzh@10.19.138.148
cd ~/kedaya-web

# 1) 看有哪些版本
ls -1 releases

# 2) 指回旧版本（把 <旧版本> 换成上一步看到的目录名）
ln -sfn ../releases/<旧版本>/.next app/.next
ln -sfn ../releases/<旧版本>/public app/public

# 3) 重启（不动隧道，URL 不变）
./restart-web.sh
```

如果旧版本的 `package-lock.json` 与当前 `app/package-lock.json` 不同，
还要：

```bash
cd ~/kedaya-web/app
cp ../releases/<旧版本>/package.json .
cp ../releases/<旧版本>/package-lock.json .
npm ci --omit=dev --no-audit --no-fund
cd ~/kedaya-web
./restart-web.sh
```

最省事的“回滚”其实是**重新部署上一个 commit**：`git checkout <旧 commit>` 后
重跑 `scripts/deploy-web.sh`，新 release 会按旧代码构建，旧 release 仍保留可切回。

---

## 10. 安全与边界

- **密码不落盘**：`deploy-web.sh` 只从 `DEPLOY_PASS` 读，通过 `sshpass -e`
  （环境变量 `SSHPASS`）传给 ssh/scp。仓库里没有任何明文密码。
- 脚本只写 `$HOME/kedaya-web`；`REMOTE_ROOT` 被限制为单层目录名，禁止绝对路径。
- 脚本**不会**碰 `~/kedaya-api`、`~/cloudflared` 二进制、3100/8888 上的隧道，
  也不会 kill 任何非本脚本启动的进程。停进程前会校验 `/proc/<pid>/cwd`。
- Web 只监听 `127.0.0.1:3200`，不对校园网/公网直接开放端口。
- 服务器上只新增了 `~/kedaya-web`（当前约 390MB：352MB node_modules + 每个 release 约 12MB；保留多个 release 是为了回滚）。

---

## 11. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Cannot find module 'next/dist/compiled/next-server/app-page.runtime.prod.js'` | release 里缺 `node_modules` 软链（Node 从 `.next` 真实路径找依赖） | `ln -sfn ../../app/node_modules ~/kedaya-web/releases/<版本>/node_modules` 后重启 |
| `Cannot find module '../lightningcss.darwin-x64.node'` | 依赖是 x64 装的，构建却跑在 arm64 Node 上 | 用 `--webpack` 构建，或按当前架构重装依赖 |
| `端口 3200 被占用（不是本脚本的进程）` | 别的进程占了 3200 | `ss -ltnp \| grep 3200` 查清楚；不要直接 kill 别人的进程，换 `WEB_PORT` |
| 公网 502 / 1033 | cloudflared 没起来或指向错端口 | `tail ~/kedaya-web/logs/cloudflared.log`，确认 `--url http://127.0.0.1:3200` |
| 页面能开但数据不对 | 构建时 `NEXT_PUBLIC_KEDAYA_USE_MOCK` / API base 不对（构建期内联） | 改环境变量后重新 build + deploy |
| 上传了解包时刷 `Ignoring unknown extended header keyword` | macOS bsdtar 把 xattr 写进了 tar | 脚本已加 `--no-xattrs --no-mac-metadata`；旧包可忽略，不影响运行 |
