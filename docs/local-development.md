# 本机开发与启动

所有命令在仓库根目录执行，除非特别说明。客户端默认使用 Mock 数据，
无需数据库或校园账号即可跑通全部页面；需要「真实落库」时按下方第 3 节起后端。

## 1. Node 与 npm

本地开发使用 Node 22.23.3 与 npm 10.9.9，Prisma 不支持 Node 21。
仓库配置使用 npm 官方源，并将锁文件中的旧镜像下载地址映射至官方源。

```bash
nvm install
nvm use
./scripts/with-npm-lock.sh npm ci
```

若终端已经打开很久，执行 `nvm use`；也可以用下方启动脚本自动选择版本。
不要同时执行多个 `npm install` / `npm ci`，也不要在安装期间运行开发编译。

## 2. 微信小程序

```bash
./scripts/dev.sh weapp
```

等待编译成功后，在微信开发者工具的「小程序」分类导入仓库根目录。
配置会自动读取 `apps/miniapp/dist/`。游客 AppID 适用于本地体验，真机与发布需要自己的 AppID。
终端保持运行，修改代码后会自动重新编译；按 Ctrl+C 停止。

预览相关的两个已知坑（都已修，别改回去）：

- **图标字体不再走网络**：Taroify 自带样式里的 `@font-face` 指向 `//at.alicdn.com/...`，
  真机需要配置「下载合法域名」、部分基础库还不解析协议相对地址，图标会变空白方框。
  现在由 `src/presentation/theme/icon-font.scss`（base64 内联）+ `config/index.ts` 的 alias
  （`@taroify/icons/style/index.js` → `src/presentation/theme/taroify-icon-style.ts`）接管。
- **WXSS 编译期错误会连坐所有页面**：`.a > :first-child`、`> *`、裸 `*` 这类选择器
  微信编译器不支持，一旦写进任何一个 `.scss`，`common.wxss` 编译失败、全部页面白屏
  （报错形如 `[ WXSS 文件编译错误] ./common.wxss(1:xxxxx): error at token ':'`）。
  单测 `src/presentation/theme/__tests__/wxss-safety.test.ts` 会扫描全部 scss 拦截。

小程序默认 Mock，**账号也是 Mock**：登录页会提示演示账号

| 账号 | 密码 |
| --- | --- |
| `demo@kedaya.dev` | `Kedaya2026` |

Mock 账号复刻了真实后端的规则（验证码一次性、密码错误文案统一、改密后旧令牌失效），
因此「Mock 下点得通、接后端就崩」这类问题不会出现。

## 3. 数据库与后端

### 3.1 准备 PostgreSQL

后端需要 PostgreSQL 16+。两种方式任选：

```bash
# 方式 A：Docker（注意 compose 里映射的是 5432）
docker compose -f services/api/docker-compose.yml up -d postgres

# 方式 B：本机 PostgreSQL.app / Homebrew，手动建库建角色以匹配默认连接串
createuser -s kedaya
createdb -O kedaya kedaya
```

默认连接串 `postgresql://kedaya:kedaya@localhost:5432/kedaya`。
若本机 5432 已被占用（例如同时开着 Postgres.app），不要两者一起起，改其一端口即可。

### 3.2 迁移与启动

```bash
npm run prisma:migrate -w @kedaya/api      # 应用迁移
npm run prisma:seed    -w @kedaya/api      # 灌演示数据（幂等，可重复执行）
npm run dev -w @kedaya/api                 # 终端 A：tsc 监听编译
npm run dev:serve -w @kedaya/api           # 终端 B：node --watch 跑编译产物
# 或一次性：npm run build -w @kedaya/api && npm run start -w @kedaya/api
```

`prisma:seed` 覆盖 6 个演示账号与十余类业务数据（课表 / 校园卡流水 / 拼单 /
跳蚤 / 跑腿 / 搭子 / 失物招领 / 论坛帖与回复 / 食堂菜品 / 野生动植物 / TechPie /
FAQ / 外卖被拿报备 / 站内信），让每个列表页打开就有中文数据可看。
密码统一为 `Kedaya2026`，账号：`demo@kedaya.dev`、`zhang.yf@kedaya.dev`、
`chen.mx@kedaya.dev`、`liu.zy@kedaya.dev`、`wang.h@kedaya.dev`、`zhou.qr@kedaya.dev`。
生产环境**默认拒绝执行**（需要 `SEED_FORCE=1` 才会跑）。

服务地址 <http://localhost:3000/api/v1>（统一前缀 `/api/v1`，响应统一信封）。
存活探针在 `GET /health`（**不带** `/api/v1` 前缀、**不走**信封）。

> 上线部署（微信云托管、数据库、小程序提审）见 [`deploy.md`](./deploy.md)。

> 本机 3000 常被其他项目占用（占用时 `curl` 会打到别人的服务上，症状是返回
> 非信封格式的 JSON）。用 `PORT=3999 npm run start -w @kedaya/api` 换端口，
> 小程序联调时把 `TARO_APP_API_BASE_URL` 一起改掉即可。

自检：

```bash
curl -s -i "http://127.0.0.1:3000/api/v1/errand/items?limit=abc"   # 期望 400 VALIDATION_FAILED
curl -s -i "http://127.0.0.1:3000/api/v1/nope"                     # 期望 404 NOT_FOUND
```

两条都不碰数据库，但足以证明「进程起来了 + 全局管道/拦截器/过滤器都装配好了」。
`services/api/test/app-assembly.spec.ts` 就是这两条的自动化版本。

### 3.3 环境变量（`services/api/.env`，已在 .gitignore 中）

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 数据库连接串 |
| `JWT_SECRET` | 签发/校验 JWT（缺失会直接报错，不会静默降级） |
| `AUTH_DEV_EXPOSE_CODES` | `"true"` 时**仅开发环境**在发送验证码的响应里回显 `devCode` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 邮件发信。本机**不用配**：开发环境默认走日志实现（验证码打控制台）；生产环境不配会让服务起不来（详见 `docs/deploy.md` §5.7） |
| `MAIL_TRANSPORT` | 不配即可。`console` 强制日志实现（生产环境设了会拒绝启动）；`smtp` 强制真发信 |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | 访问/刷新令牌有效期（秒） |
| `CAMPUS_DATA_MODE` | `mock`（默认，模拟校园数据，响应标 `simulated: true`）/ `live`（真实上游，需配 `CAMPUS_*_DATA_URL`） |
| `CAMPUS_CAS_MOCK_ALLOWED` | 本机不用配：开发环境下 Mock 校园登录本来就可用（`ticket` 传 `mock-<8 位学号>`）。它在**生产环境**是关闭的，要演示整条链路才临时打开 —— 理由见 `docs/deploy.md` §5.2 |
| `CAMPUS_EGATE_DATA_URL` / `CAMPUS_JWC_DATA_URL` / `CAMPUS_CARD_DATA_URL` | 各校园系统上游地址，仅 `live` 模式使用；未配置则明确报错 |
| `CAMPUS_UPSTREAM_TIMEOUT_MS` | 校园上游请求超时（毫秒，默认 6000） |
| `AGENT_LLM_BASE_URL` / `AGENT_LLM_API_KEY` / `AGENT_LLM_MODEL` | 可达鸭的 OpenAI 兼容模型；**全部留空即走规则回答**，功能完整 |
| `AGENT_LLM_TIMEOUT_MS` | 模型调用超时（毫秒，默认 8000），超时即降级为规则回答 |

`AUTH_DEV_EXPOSE_CODES` 只是为了真机联调方便；生产必须关闭，
否则任何人都能拿到别人的注册验证码。关闭时验证码会打印到 API 控制台（`ConsoleMailAdapter`）。

想在本机验证**真实发信链路**（邮件组装、SMTP 对话、错误分支），不用去注册邮箱服务商：
`SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_ALLOW_INSECURE=true SMTP_FROM=... node <一个假 SMTP 服务器>`，
然后照样 `POST /auth/account/register/code`，看假服务器收到了什么。
`services/api/src/modules/auth/data/smtp-mail.adapter.spec.ts` 里就有一台内存假服务器，
把它的断言读一遍比看文档更快。

### 3.4 自建账号（邮箱 + 密码）

端点挂在 `/api/v1/auth/account/*`，与 CAS 登录并行，签发出来的 JWT 完全同构：

| 动作 | 端点 |
| --- | --- |
| 注册验证码 | `POST /auth/account/register/code` |
| 注册（直接登录） | `POST /auth/account/register` |
| 登录 | `POST /auth/account/login` |
| 找回密码验证码 | `POST /auth/account/password/forgot` |
| 重置密码 | `POST /auth/account/password/reset` |
| 修改密码（需登录） | `POST /auth/account/password/change` |
| 是否已设置密码 | `GET /auth/account/password/status` |
| 登出（撤销刷新令牌） | `POST /auth/account/logout` |

安全语义（都有单测覆盖）：密码 scrypt 哈希、强度 8–64 位且含字母与数字、
验证码 6 位数字且 10 分钟有效 / 一次性 / 最多 5 次尝试 / 60 秒冷却、
连续 5 次密码错误锁定 15 分钟、账号不存在与密码错误返回同一文案、
找回密码对不存在的邮箱同样返回 `sent: true`、刷新令牌可撤销并在换发时轮换
（重放已轮换的令牌会撤销该账号全部会话）。

给「只有微信登录方式」的账号补后路（都是需要登录的端点）：

| 动作 | 端点 |
| --- | --- |
| 绑定邮箱验证码 | `POST /auth/account/bind-email/code` |
| 绑定邮箱（挂到同一个 userId） | `POST /auth/account/bind-email` |
| 改昵称 / 头像 | `PATCH /auth/me` |

### 3.5 微信小程序快捷注册 / 登录

微信是**第一级身份层的第三条入口**，与 CAS、邮箱密码并列：它只产出 KedaYa 自有 JWT，
**不会**触碰任何校园 session（`AuthIdentity.provider = 'WECHAT_MINIPROGRAM'`，
`externalId = openid`；`session_key` 在适配器里直接丢弃，不落库）。

| 动作 | 端点 |
| --- | --- |
| 服务端是否配了真实密钥（匿名） | `GET /auth/wechat/config` |
| 一键登录 / 首次注册 | `POST /auth/wechat/login` |
| 绑定状态（需登录） | `GET /auth/wechat/binding` |
| 绑定微信（需登录） | `POST /auth/wechat/binding` |
| 解绑微信（需登录） | `DELETE /auth/wechat/binding` |

配置与本地演示：

- 生产/真机：在 `.env` 填 `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET`
  （微信公众平台 → 开发管理 → 开发设置）。此时 `GET /auth/wechat/config` 返回
  `configured: true`，小程序端会走 `Taro.login()` 拿真实 code。
- **本地/未配密钥**：保持留空即可。客户端会先问 `/auth/wechat/config`，
  发现未配置就自动改用 `dev:<设备标识>` 这种模拟凭证 —— 页面不用改任何开关。
  服务端在**非生产环境**把它映射成稳定的 `dev_openid_<设备标识>`，
  于是「同一台设备反复登录 = 同一个账号」，可以完整演示
  「首次注册 → 完善资料 → 再次登录 → 绑定邮箱 → 解绑微信」。
  生产环境一律拒绝 `dev:` 前缀（返回 `UNAUTHENTICATED`），不可能伪造 openid。

行为细节：首次登录自动建号（响应里 `isNewUser: true`，小程序随即跳到「完善资料」页），
昵称取不到时兜底为 `微信用户<四位>`；头像用微信 `chooseAvatar` 得到的临时图，
压缩到 64 KB 以内的 data URL 后存 `User.avatarUrl`（⚠️ 接对象存储后应改为上传返回 URL）；
绑定冲突（该微信已属于另一个账号）返回 `CONFLICT`，**不做静默账号合并**；
账号只剩微信一种登录方式时拒绝解绑（`FORBIDDEN`），避免把自己锁在门外。

### 3.6 校园数据（身份 / 课表 / 校园卡）与可达鸭

这两块都**默认不需要任何凭据**就能跑通全链路，只在拿到校方授权后才需要配置。

**校园数据来源**由 `CAMPUS_DATA_MODE` 决定：

| 模式 | 行为 |
| --- | --- |
| `mock`（默认） | 确定性的本地模拟数据（同一个账号永远拿到同一份课表/流水），所有校园数据在响应里带 `simulated: true`，UI 会显著标注「演示数据」 |
| `live` | 请求真实上游，必须配置对应 `CAMPUS_*_DATA_URL`，否则**明确报错**（宁可报错，也不返回空数据让用户以为"我这学期没课/卡里没钱"） |

真实对接的接入点集中在两处，拿到授权后只改这两处：

- `services/api/src/modules/auth/domain/campus-data.domain.ts`（端口契约）
- `services/api/src/modules/auth/data/http-campus-data.adapter.ts`（上游 JSON 解析）
- CAS 侧另见 `services/api/src/modules/auth/data/mock-campus-auth.provider.ts`

演示凭据 `demo:<platform>:<userId>` 仅在 `mock` + 非生产环境签发，仍走
同一套 `CampusSessionPort` 加密落库与权限判定 —— 也就是说**权限逻辑不是 mock 的**。

相关端点（都需要登录）：

| 动作 | 端点 |
| --- | --- |
| 四个校园系统各自的绑定状态 | `GET /auth/campus/overview` |
| 实名信息（默认脱敏，`reveal=1` 返回明文并写审计） | `GET /auth/campus-identity` |
| 绑定 / 解绑校园系统 | `POST` / `DELETE /auth/campus-bindings` |
| 今日课表（含正在上 / 下一节 / 还有几分钟） | `GET /schedule/today` |
| 本周课表（含冲突与可切换学期） | `GET /schedule/week` |
| 从教务系统整体同步 | `POST /schedule/sync` |
| 手动加课（临时调课兜底） | `POST /schedule/items` |
| 校园卡总览（余额 / 流水 / 低于阈值 / 异常扣款 / 还能撑几天） | `GET /campus-card/overview` |
| 挂失指引（写审计；不谎称已挂失） | `GET /campus-card/lost-report` |
| 隐私开关 / 同意管理 / 数据导出 | `GET`/`PATCH /profile/me`、`/profile/consents`、`/profile/export` |

**可达鸭（内置助手）** 的端点是 `POST /agent/chat`、`GET /agent/suggestions`、
`GET /agent/capabilities`。它**不配置模型也能用**：

- 未配置 `AGENT_LLM_*` → 服务端用确定性规则组织语言（响应 `degraded: true`、`usedModel: null`）；
- 配置了模型但调用失败/超时 → 同样降级为规则回答，不会让用户等不到回应；
- 无论走哪条路，涉及个人数据的部分都由**受 `userId` 约束的实时工具**取数，
  个人信息**永远不会**进入检索索引（白名单只有模块说明 / 内置指南 / FAQ 表）；
- 未绑定校园系统、上游不可用、未登录，都会转成人话 + 一个可执行的动作，不编造数字。

## 4. 小程序联调真实后端


```bash
TARO_APP_USE_MOCK=false TARO_APP_API_BASE_URL=http://localhost:3000 ./scripts/dev.sh weapp
```
API 客户端会为接口路径自动添加 `/api/v1`。开发者工具访问本地 HTTP 服务时，
需在「详情 → 本地设置」关闭合法域名校验；真机联调要使用设备可访问的地址，
发布时配置合法的 HTTPS 域名。

本机 3000 被别的项目占用时（`lsof -nP -iTCP:3000 -sTCP:LISTEN` 有输出），换端口起后端即可：

```bash
PORT=3999 npm run build -w @kedaya/api && PORT=3999 npm run start -w @kedaya/api
TARO_APP_USE_MOCK=false TARO_APP_API_BASE_URL=http://localhost:3999 ./scripts/dev.sh weapp
```

`.env` 里的 `PORT` 不会被 shell 变量覆盖之外的逻辑改写，`PORT=3999` 优先。

### 4.0 本地打通图片上传（`MEDIA_STORAGE=local`）

图片功能默认是**关闭**的（`MEDIA_STORAGE=disabled`）：没有对象存储时，
后端 `GET /media/config` 会返回 `enabled:false`，小程序就**整块隐藏选图入口**并说明原因 ——
这是刻意的，避免给用户一个点了必然失败的按钮。

本地想跑通整条链路（选图 → 压缩 → 上传 → 服务端剥离 EXIF → 回图显示），用本地磁盘模式：

```bash
# services/api/.env
MEDIA_STORAGE="local"
MEDIA_LOCAL_DIR=""        # 留空 = <services/api>/.media（已在 .gitignore 中）
```

```bash
PORT=3999 npm run build -w @kedaya/api && PORT=3999 npm run start -w @kedaya/api
curl -sS localhost:3999/api/v1/media/config
# → {"enabled":true,"kind":"local","maxBytes":2097152,"maxCount":9,"accept":["image/jpeg","image/png"]}
```

`local` 模式回图走 `GET /api/v1/media/files/:key`（不带 `/api/v1` 前缀的是 `/health`），
返回的地址是**绝对地址**（从请求头推导，或由 `MEDIA_PUBLIC_BASE_URL` 指定），
因此小程序 `<Image src>` 可以直接用。

两点必须知道：

- **`local` 只适合开发**：容器/进程重启即丢图，生产环境用它会打警告日志。
  生产用 `MEDIA_STORAGE=s3`（COS / OSS / MinIO / R2 都行，配置见 `docs/deploy.md` 5.4 节）。
- **小程序相册只能在微信里用**：H5/浏览器点「添加图片」会提示
  「相册选图需要在微信小程序内使用」。想看真机效果，要么用开发者工具（勾选「不校验合法域名」），
  要么用 mock 模式 —— mock 模式下上传返回 data URL 本身，**离线也能看到真图**。

### 4.1 Web 门户（浏览器预览）

Web 是独立的 Next.js 客户端，跟小程序共用后端 API，但界面与主题各自独立：

```bash
npm run dev:web           # Next.js dev server → http://localhost:3001
```

- 首页宫格 20 个模块都可达，角标**如实**标注可用性：
  「Web 已上线 / 小程序已上线 / 接口就绪」。判定逻辑只在
  `apps/web/src/domain/models/delivery.ts` 一处，改交付范围就改它。
  （当前只有 `facility`（场馆预约）还是「接口就绪」：后端已挂脚手架接口，
  小程序页面待做。）
- 目前浏览器里真正能点开使用的是拼单垂直切片（`/groupbuy`），
  以及管理后台占位（`/admin`）；其余模块点进 `/m/<id>` 会看到该模块的交付说明。
- 默认走 mock 数据，不需要后端；要连真实后端时设 `NEXT_PUBLIC_API_BASE_URL`
  （默认 `http://localhost:3000`，本机换端口时对应改成 `http://localhost:3999`）。

## 5. 测试与校验

```bash
nvm use
npm run typecheck -w @kedaya/api && npm run test -w @kedaya/api && npm run lint -w @kedaya/api
npm run typecheck -w @kedaya/miniapp && npm run test -w @kedaya/miniapp && npm run lint -w @kedaya/miniapp
npm run build:weapp
npm run typecheck -w @kedaya/web && npm run test -w @kedaya/web && npm run lint -w @kedaya/web
```

约定与注意事项：

- 后端 `services/api/vitest.config.ts` 显式打开了 **oxc 的 legacy 装饰器**转换；
  Vite 8 的默认转换器不认 `@Controller` / `@Injectable`，关掉它会得到
  `SyntaxError: Invalid or unexpected token`。这是测试能跑起来的前提，不要移除。
- `services/api/test/` 下三个「真东西」测试都连真实服务，需要数据库的会**自动跳过**：
  `local-auth.integration.spec.ts`（账号打真库）、
  `modules.e2e.spec.ts`（六模块主流程走真实 HTTP + 真实 Postgres）、
  `app-assembly.spec.ts`（只证明 19 个模块能装配起来，不碰数据库）。
  数据库不可用时 `npm test` 仍应全绿 —— 基础设施缺失不该让代码被判红。
- 小程序前端测试只跑纯逻辑层（domain / application / data 的非 UI 部分），
  跑在 node 环境，不需要小程序模拟器。

涉及视觉的改动请在微信开发者工具中检查，H5 只作为布局预览。

## 6. 两个容易踩的坑（已修，别改回去）

**共享包的相对导入必须带 `.ts` 扩展名。** `@kedaya/contracts` 与 `@kedaya/shared` 的
`main` 指向 TS 源码，后端 `tsc` 产物在运行时直接 `require` 它们，由 Node 的类型剥离执行源码；
Node 的 ESM 解析器不做扩展名补全，少写扩展名会在**启动时**报 `ERR_MODULE_NOT_FOUND`
（单测发现不了，因为 vitest 会补全）。`tsconfig.base.json` 里用
`rewriteRelativeImportExtensions` 保证编译产物中重写回 `.js`。

**全局提供者必须能被容器无参实例化。** `APP_PIPE` / `APP_INTERCEPTOR` / `APP_FILTER`
以及 `main.ts` 里 `app.get()` 取用的 `TraceMiddleware`，都要么 `@Optional()`，
要么在 `AppModule.providers` 里显式登记 —— 否则单测（自定义模块）全绿，
`main.ts` 一起就抛 `Nest can't resolve dependencies` / `could not find element`。
