# 在 10.19.138.148（"5090" 机器）上部署 API

> 记录时间：2026-11-24。目标机是组内共享的 Ubuntu 24.04（112 核 / 503 GB 内存），
> **当前账号没有 sudo**，所以整套方案都在用户态完成。

## 1. 服务器现状（实测）

| 项 | 值 |
| --- | --- |
| 主机 | `10.19.138.148`，用户 `tangzh`（SSH 密钥；WSL 里另有 `~/ssh5090.sh` 的密码方式） |
| 系统 | Ubuntu 24.04.4 LTS，内核 6.14 |
| Node / npm | v24.15.0 / 11.12.1 |
| PostgreSQL | 16.15，监听 `127.0.0.1:5432`，`tangzh` 走 **peer 认证**可直连 |
| 已占用端口 | 80（nginx）、4000、6379（redis）、5432 |
| sudo | **无** |
| GitHub 直连 | 被重置；`npm registry` 正常；本机 `127.0.0.1:7897` 有 HTTP 代理 |

## 2. 代码上传（绕过 GitHub 克隆）

服务器 `git clone` GitHub 会 `Connection reset`，所以从开发机用管道传：

```bash
cd kedaya
tar -czf - --exclude=node_modules --exclude=.git --exclude=build \
  --exclude=.dart_tool --exclude=dist-artifacts --exclude='apps/miniapp/dist' . \
  | ssh 5090 'mkdir -p ~/kedaya && tar -xzf - -C ~/kedaya'
```

后续小改动直接 `scp` 单文件即可。

## 3. 数据库

```bash
createdb kedaya          # tangzh 是 owner
```

连接串走 **Unix socket**（免密码、免改 pg_hba）：

```env
DATABASE_URL=postgresql://tangzh@localhost/kedaya?host=/var/run/postgresql&schema=public
```

## 4. 环境变量（`services/api/.env`，chmod 600）

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://tangzh@localhost/kedaya?host=/var/run/postgresql&schema=public
JWT_SECRET=<openssl rand -hex 24>
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
WILDLIFE_FUZZ_SECRET=<openssl rand -hex 24>
CONTACT_EXCHANGE_ENC_KEY=<openssl rand -hex 32>   # 必须 32 字节
```

两个 `*_SECRET/ENC_KEY` **缺失会拒绝启动**（fail-closed，故意如此）。

`NODE_ENV=development` 的原因：`NODE_ENV=production` 时 `MAIL_TRANSPORT=console`
被禁止，而这里没有 SMTP。要转生产，先配 `SMTP_HOST/PORT/USER/PASS/FROM`，
再把 `NODE_ENV` 改回 `production`。

## 5. 构建与迁移

```bash
cd ~/kedaya && npm ci
npm run build -w @kedaya/api
cd services/api && npx prisma migrate deploy
```

## 6. 常驻（systemd --user，linger 已开启）

`~/.config/systemd/user/kedaya-api.service`：

```ini
[Unit]
Description=KedaYa API (NestJS)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/kedaya/services/api
EnvironmentFile=%h/kedaya/services/api/.env
ExecStart=/usr/bin/node -r ./register-workspace-modules.cjs dist/services/api/src/main.js
Restart=on-failure
RestartSec=3
StandardOutput=append:%h/api.log
StandardError=append:%h/api.log

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now kedaya-api.service
systemctl --user status kedaya-api.service
```

`loginctl show-user tangzh` 已是 `Linger=yes`，所以退出 SSH 后服务仍在。

**注意**：不要用 `pkill -f "node -r ./register-workspace-modules.cjs"` 清理进程 ——
它会连当前 SSH 会话一起匹配掉，也会杀掉 systemd 拉起的实例。用
`systemctl --user restart kedaya-api.service`。

## 7. 访问方式

| 方式 | 地址 | 说明 |
| --- | --- | --- |
| 校内网 | `http://10.19.138.148:3000` | 已从开发机 Windows 实测可达，`/health` 返回 `{"ok":true}` |
| 公网（临时） | `https://<random>.trycloudflare.com` | `cloudflared tunnel --url http://127.0.0.1:3000`，**URL 每次重启都变** |

公网稳定地址需要：自有域名 + Cloudflare 账号 + `cloudflared tunnel login`（命名隧道），
或把域名 CNAME 到命名隧道。服务器到 localhost.run / serveo 的 22 端口被拦，
所以只能走 Cloudflare（QUIC/HTTP2 出网正常）。

## 8. 已知限制

- 无 sudo：不能改 nginx `/etc/nginx`、不能开 ufw，因此直接暴露 3000；正式上线应在
  nginx 上做 TLS 与限流（需要管理员配合）。
- `NODE_ENV=development`（无 SMTP），注册验证码只会写服务端日志。
- 演示密钥是本机随机生成，未纳入任何密钥管理；迁移到生产必须重新生成并托管。
- 数据库与仓库在同一台机器，未做备份策略。
