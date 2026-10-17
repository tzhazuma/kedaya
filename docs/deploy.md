# 部署手册 · 微信云托管（CloudBase Run）

本文件是**上线操作的唯一依据**：按顺序执行即可从零部署到微信云托管，并完成小程序发布。
所有命令都在仓库根目录执行（`/path/to/kedaya`）。

> 目标读者：负责发布的同学。前提是你能登录**微信公众平台**（小程序管理后台）与
> **腾讯云控制台**（云托管 / 数据库）。本地还需要 Docker。

---

## 0. 交付形态与架构

```
微信小程序（apps/miniapp，构建产物 dist/）
        │  HTTPS（合法的 request 合法域名）
        ▼
微信云托管 · 服务 kedaya-api（本仓库 services/api 的 Docker 镜像，容器端口 80）
        │  内网 / SSL
        ▼
腾讯云 PostgreSQL 托管实例（业务数据唯一持久化位置）
```

三条必须记住的事实（它们决定了下文的所有取舍）：

| 事实 | 后果 |
| --- | --- |
| 云托管**不支持 docker-compose** | 本地用的 `services/api/docker-compose.yml` **只能本地开发用**，线上必须拆成「云托管服务 + 外部数据库实例」 |
| 云托管容器**没有持久化存储** | 任何写进容器文件系统的数据都会在下次发布时消失。**数据库必须是外部托管实例**；将来做图片上传要接 **COS**，不能落在容器里 |
| 云托管内置的是 **MySQL**，不是 PostgreSQL | 本项目的 Prisma schema 用 PostgreSQL（`@@index`、数组/JSON 用法、`C` locale 排序）。**必须自建腾讯云 PostgreSQL**，不能用内置数据库 |

另外两条容易踩的：

- 云托管容器**默认时区是 UTC**。本项目课表/校园卡流水都是中国时区语义，
  镜像里已通过 `TZ=Asia/Shanghai` + tzdata 固定（见 `services/api/Dockerfile`），
  **不要**在控制台把它改回来。
- 云托管的**构建时限是 10 分钟**。Dockerfile 已经只安装 `@kedaya/api` 的依赖
  （不装 Taro / Next 的依赖）来换时间，改动时请保持这个策略。

---

## 1. 前置准备

| 项 | 说明 |
| --- | --- |
| 微信小程序 AppID | 云托管与小程序需要在**同一个微信主体**下 |
| 云托管环境 | 控制台 → 云托管 → 新建环境（建议与数据库同地域，例如上海） |
| 腾讯云 PostgreSQL 16+ | 见第 2 节 |
| 容器镜像仓库 | 云托管使用腾讯云容器镜像服务（TCR）；开通后在控制台可看到推送地址与登录命令 |
| 本地 Docker | 用于构建镜像。**注意：交付时本机没有 Docker，镜像未在本地验证过**（见第 9 节） |

---

## 2. 数据库（必须先于服务部署）

1. 购买**腾讯云 PostgreSQL**（版本 16 及以上），与云托管环境**同地域**。
2. 创建库与账号（示例值，请换成自己的强密码）：

   ```sql
   CREATE DATABASE kedaya ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
   CREATE ROLE kedaya LOGIN PASSWORD '<强密码>';
   GRANT ALL PRIVILEGES ON DATABASE kedaya TO kedaya;
   ```

   `LC_COLLATE 'C'` 是刻意的：本地 compose 与 CI 都用 C 排序，
   若线上用别的 locale，中文数据的索引顺序/唯一性判定可能不一致
   （表现为「本地能搜到、线上搜不到」）。

3. **网络连通**：优先使用**内网**（云托管与 PG 同 VPC）。若必须走公网，
   则开启 SSL，并把云托管环境的出口 IP 加入 PG 白名单。
4. 记下完整连接串，后面要作为 `DATABASE_URL`：

   ```
   postgresql://kedaya:<密码>@<内网地址>:5432/kedaya?schema=public&sslmode=require
   ```

> ⚠️ 连接串里含密码，**只**放在云托管的环境变量里。不要写进仓库、不要打进镜像
> （`.dockerignore` 已排除 `.env*`）。

---

## 3. 构建镜像

在**仓库根目录**执行（构建上下文必须整个 monorepo，原因见 Dockerfile 顶部注释）：

```bash
# 1) 登录云托管的镜像仓库（地址与命令以控制台「镜像仓库」页为准）
docker login <registry-host>

# 2) 构建（amd64：云托管是 x86，Apple Silicon 上不要漏 --platform）
docker build --platform linux/amd64 -f services/api/Dockerfile -t kedaya-api:v1 .

# 3) 打标签并推送
docker tag kedaya-api:v1 <registry-host>/<namespace>/kedaya-api:v1
docker push <registry-host>/<namespace>/kedaya-api:v1
```

几个「构建成功但服务不通」的常见原因，先自查：

- **构建上下文不是仓库根** → `npm ci -w @kedaya/api` 找不到 workspace，镜像里没有
  `node_modules/@kedaya/contracts` 符号链接，启动即 `Cannot find module '@kedaya/contracts'`。
- **基础镜像 Node < 22.18** → 运行时要在 Node 的类型剥离下直接加载
  `packages/contracts` 的 **TS 源码**，低版本会解析失败。请沿用 Dockerfile 里的 `node:22.23-alpine`。
- **在 Dockerfile 里写多条 `CMD`** → 只有最后一条生效。

---

## 4. 创建云托管服务

控制台 → 云托管 → 选择环境 → 新建服务，关键配置：

| 配置项 | 值 | 为什么 |
| --- | --- | --- |
| 服务名称 | `kedaya-api` | 同环境其它服务可用服务名做 DNS 直连 |
| 镜像 | 第 3 节推上去的 `kedaya-api:v1` | |
| **容器端口** | `80` | 镜像里 `PORT=80`（云托管的端口探测按此配置） |
| **健康检查路径** | `/health` | 见下文 |
| 最小/最大实例数 | 先 `1/1`，验证后再调 | 迁移期间多实例会并发抢锁 |
| CPU / 内存 | 0.5 核 / 1 GB 起 | NestJS + Prisma 单实例足够 |
| 环境变量 | 见第 5 节 | |

### 关于健康检查 `/health`

`services/api/src/main.ts` 注册了 `GET /health`（**不带** `/api/v1` 前缀、**不走**统一响应信封），
返回 `200 {"ok":true,"uptimeSec":N}`。

它是**存活探针，刻意不查数据库**。原因：数据库是外部实例，容器重启并不能让它恢复；
如果探针依赖数据库，数据库抖动会让平台把容器反复重启，把小故障放大成重启风暴。
数据库的连通性由业务请求自己暴露（5xx + 日志），恢复后无需重启即可继续服务。

### 关于「开放接口服务」

**不要**开启云托管的「开放接口服务」。开启后平台会接管 `access_token` 的获取，
本项目自己管理（`WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET` 自管），
两者并存会让自管的 `access_token` 超时失效，表现为小程序登录偶发失败。

---

## 5. 环境变量

在「云托管 → 服务 → 环境变量」里配置。**至少**要配前四项，否则服务起来也不能用。

### 5.1 必须配置

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 生产模式。缺 `DATABASE_URL` 时会**启动失败并明确报错**（见下） |
| `DATABASE_URL` | `postgresql://...` | 第 2 节的连接串 |
| `JWT_SECRET` | 32 字节以上随机串 | 签发自有 JWT。**换掉默认值**，生成方式：`openssl rand -base64 48` |
| `CAMPUS_SESSION_ENC_KEY` | 64 位 hex | 校园系统 session 的 AES-256-GCM 密钥。生成：`openssl rand -hex 32` |
| `PORT` | `80` | 与容器端口一致 |

`JWT_SECRET` 与 `CAMPUS_SESSION_ENC_KEY` 一旦更换，已签发的 token 与已加密的
校园 session 会全部失效（用户需要重新登录 / 重新绑定）。请妥善保存并在首次部署前定好。

### 5.2 校园数据来源

| 变量 | 上线建议值 | 说明 |
| --- | --- | --- |
| `CAMPUS_DATA_MODE` | `mock` → 拿到校方授权后改 `live` | `mock` 是**确定性模拟数据**，所有校园数据响应带 `simulated: true`，UI 会如实标注「演示数据」 |
| `CAMPUS_EGATE_DATA_URL` / `CAMPUS_JWC_DATA_URL` / `CAMPUS_CARD_DATA_URL` | `live` 时必填 | 未配置时 `live` 模式对该平台的请求**明确报错**（宁可报错，也不返回空数据让用户以为「我这学期没课」） |
| `CAMPUS_CAS_URL` / `CAMPUS_SSO_CLIENT_ID` / `CAMPUS_SSO_CLIENT_SECRET` | 校方提供后填写 | 今天是开发用 Mock 适配器，真实对接点见 `services/api/src/modules/auth/data/mock-campus-auth.provider.ts` 顶部注释 |

> 校园数据 `mock` 模式下，小程序在课表 / 校园卡页面会显示「演示数据」标记。
> **上线前如果还没拿到校方授权，请与审核说明保持一致**：不要宣称已对接真实教务/一卡通。

### 5.3 其它（可选）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AGENT_LLM_BASE_URL` / `AGENT_LLM_API_KEY` / `AGENT_LLM_MODEL` | 空 | **全部留空也能用**：可达鸭走确定性规则回答（响应 `degraded: true`），功能完整。配置后走 OpenAI 兼容的 `/chat/completions` |
| `AGENT_LLM_TIMEOUT_MS` | `8000` | 超时即降级为规则回答，不让用户干等 |
| `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET` | 空 | 小程序快捷登录。留空时非生产环境接受 `dev:<设备标识>` 模拟凭证；**生产环境必须配置真实值** |
| `CORS_ORIGINS` | 空（=允许所有来源） | 小程序不走 CORS，可留空；若将来有 Web 前端，务必收紧为白名单 |
| `WELLBEING_CRISIS_HOTLINE` / `..._ALT` | 已内置 | 心理模块的危机干预热线（契约 §9：不可被埋进二级菜单） |

完整的变量清单与默认值见 `services/api/.env.example`。

> **配置缺失时的行为**：`services/api/src/app.module.ts` 使用 `ConfigModule.forRoot`，
> 没有 schema 校验。因此「少配一个变量」不一定在启动时暴露。
> 唯一做了强校验的是 `DATABASE_URL`：生产环境下缺失会**直接启动失败并打印明确错误**
> （而不是静默用空连接串启动、之后每个请求 500）。

---

## 6. 数据库迁移（独立的发布步骤）

**不要**把 `prisma migrate deploy` 写进容器启动命令：多实例并发启动会让迁移互相打架。
迁移应当是**发布流程里的一次性动作**，在服务部署前完成。

### 方式 A（推荐）：用同一个镜像跑一次性迁移

云托管支持用同一镜像、覆盖启动命令发起一次性执行（控制台里通常叫「任务」或
「临时实例/一次性执行」，以你使用的版本提供的入口为准）。配置成：

```bash
# 容器内的工作目录是 /repo；npm 会把 cwd 切到 services/api
npm run prisma:migrate:deploy -w @kedaya/api
```

环境变量与第 5 节保持一致（**就是同一套 `DATABASE_URL`**）。

### 方式 B：从能访问数据库的机器执行

在任意能连通 PG 的机器（同 VPC 的 CVM，或公网 + SSL + 白名单）上：

```bash
cd services/api
DATABASE_URL='postgresql://...' npx prisma migrate deploy
```

### 迁移前后要确认的事

```bash
# 校验 schema（不需要数据库连接）
npm run prisma:validate -w @kedaya/api

# 看有哪些迁移会应用（本地/CI 可跑）
npm run prisma:migrate:deploy -w @kedaya/api
```

- 迁移是**只进不退**的：Prisma 不做自动回滚。改结构前请先确认可加不可删的兼容策略
  （先加字段并允许空 → 发布新代码 → 再清理旧字段）。
- 演示数据（`prisma/seed.ts`）**只在需要时手动执行**：
  `npm run prisma:seed -w @kedaya/api`。
  seed 是幂等的，并且**生产环境默认拒绝执行**（需要显式 `SEED_FORCE=1` 才会跑）。
  线上一般**不要**灌演示数据。

---

## 7. 部署与验收清单

### 7.1 部署

控制台选择服务 → 部署新版本 → 选镜像 `kedaya-api:v1` → 确认端口 `80` / 健康检查 `/health` → 部署。

### 7.2 验收（逐条实测，不要只看控制台绿灯）

```bash
BASE='https://<你的云托管默认域名>'

# 1) 存活探针
curl -sS -i "$BASE/health" | head -1        # 期望 HTTP/1.1 200

# 2) 统一信封 + 数据库连通（能返回数据说明 DATABASE_URL 与迁移都对了）
curl -sS "$BASE/api/v1/groupbuy/items?limit=1" | head -c 200

# 3) Swagger 可访问
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/docs"   # 期望 200

# 4) 未登录写接口必须是 UNAUTHENTICATED（而不是 500）
curl -sS -X POST "$BASE/api/v1/groupbuy/items" \
  -H 'content-type: application/json' -d '{"title":"x"}'

# 5) 登录链路
curl -sS -X POST "$BASE/api/v1/auth/account/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@kedaya.dev","password":"Kedaya2026"}'

# 6) 站内信链路（把上一步的 accessToken 填进来）
curl -sS "$BASE/api/v1/notifications/unread-count" -H "authorization: Bearer <token>"
```

| 检查项 | 期望 | 不通过的常见原因 |
| --- | --- | --- |
| `/health` | 200 | 容器端口配错（应为 80） |
| 列表接口 | `{"ok":true,...}` | `DATABASE_URL` 错 / 迁移没跑 / PG 白名单没放行 |
| 时间字段 | 与北京时间一致 | 容器时区被改成 UTC |
| 未登录写接口 | `{"ok":false,"error":{"code":"UNAUTHENTICATED"}}` | 说明鉴权链路正常；返回 500 则要看日志 |
| 日志里的 traceId | 与响应头 `X-KedaYa-Trace` 一致 | 便于把用户报错精确对到一条请求 |

---

## 8. 回滚

云托管支持回滚到上一个版本：

1. 控制台 → 服务 → 版本列表 → 选上一个正常版本 → 回滚。
2. **代码回滚 ≠ 数据回滚**：数据库迁移是只进的。若新版本引入了不兼容的 schema 变更，
   回滚代码后旧代码会读不懂新结构。
   → 因此上线前请采用「先兼容后清理」的两步变更法：新字段先允许空、旧字段延后删除。

镜像请**保留最近 3 个 tag**（例如 `v1`、`v2`、`v3`），回滚时才有东西可退。

---

## 9. 尚未验证的部分（诚实清单）

以下是环境限制导致的**未验证项**，上线前请在真实环境各自验证一次：

| 项 | 状态 | 需要做什么 |
| --- | --- | --- |
| Docker 镜像本地构建 | **未验证**（交付本机没有 Docker） | 在有 Docker 的机器上执行第 3 节，确认构建成功、`docker run` 后 `/health` 返回 200 |
| 云托管实际部署 | **未验证** | 按第 4–7 节走一遍 |
| 真实校园系统对接（`live`） | **未验证**（无校方凭据） | 拿到授权后：填 `CAMPUS_*` 三个上游地址 → 切 `CAMPUS_DATA_MODE=live` → 逐系统验证课表/校园卡/身份 |
| 微信小程序登录（真实 `code2session`） | **未验证**（无 AppSecret） | 填 `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET` 后真机验证登录 |
| 可达鸭 LLM | 未配置时功能完整（规则回答） | 需要更好的语言组织时再配 `AGENT_LLM_*` |
| 图片上传 | **未实现** | 容器无持久化存储，必须接 **COS**；当前各模块只支持文本 + 头像 data URL |

---

## 10. 小程序端发布

后端跑通之后，小程序本身还有这些事（都需要企业主体与微信后台操作，**不是本仓库能替你完成的**）：

### 10.1 构建生产包

小程序的运行配置来自**构建期环境变量**（`process.env.TARO_APP_*`）：

| 变量 | 生产值 | 说明 |
| --- | --- | --- |
| `TARO_APP_USE_MOCK` | `false` | **必须显式设为 `false`**，默认是 mock（`container.ts` 的 `readEnv()`） |
| `TARO_APP_API_BASE_URL` | 你的云托管域名 | 默认是占位域名 `https://api.kedaya.example`，不换就什么都请求不到 |
| `TARO_APP_REQUEST_TIMEOUT_MS` | `15000`（默认） | |

做法：在 `apps/miniapp/` 下建 `.env.production`（**不要提交真实域名到公开仓库**时可改用 CI 变量）：

```
TARO_APP_USE_MOCK=false
TARO_APP_API_BASE_URL=https://<你的云托管默认域名>
```

然后构建：

```bash
npm run build:weapp
# 产物：apps/miniapp/dist
```

自检（避免「打出来还是 mock」这类静默问题）：

```bash
grep -r "api.kedaya.example" apps/miniapp/dist | head    # 应该没有输出
grep -r "TARO_APP_USE_MOCK" apps/miniapp/dist | head     # 应该没有输出
```

### 10.2 微信后台配置

1. **request 合法域名**：`https://<你的云托管默认域名>`（必须 HTTPS）。
   云托管默认域名形如 `https://xxx.ap-shanghai.run.tcloudbase.com`；
   正式对外建议绑定**自有域名**（云托管支持自定义域名 + 证书）。
2. **服务类目**：按实际功能选择（工具 / 教育 / 生活服务等）。
   涉及「校园互助」「二手交易」时微信会要求相应的资质说明。
3. **《小程序用户隐私保护指引》**：在「设置 → 服务内容声明 → 用户隐私保护指引」
   里如实填写收集的信息（邮箱、昵称头像、微信 openid、可选的位置/相册）。
   **必须与本仓库 `apps/miniapp/src/presentation/content/legal.ts` 的隐私政策口径一致** ——
   用户能看到的和后台登记的不一致是常见的驳回原因。
4. **用户协议 / 隐私政策**：小程序内已提供两个页面（我的 → 关于 → 用户协议 / 隐私政策）。
   提交审核时在「功能页面」里指明这两个路径：

   ```
   /presentation/pages/legal/terms/index     用户协议
   /presentation/pages/legal/privacy/index   隐私政策
   ```

   > ⚠️ `content/legal.ts` 里带 `TODO(上线)` 的段落**必须补完**
   > （真实的客服邮箱/投诉电话、数据保存期限、注销流程与时限、未成年人监护人同意流程）。

### 10.3 上传与提审

用微信开发者工具导入 `apps/miniapp`（工具会读 `project.config.json`，产物在 `dist/`），
或用 CI：

```bash
# 需要先在开发者工具里开启「安全设置 → 服务端口」，并用 tools 目录下的 cli
<微信开发者工具>/cli upload \
  --project apps/miniapp \
  --version 1.0.0 \
  --desc '可达鸭 v1.0.0'
```

提审前请自查（这几条是最常见的驳回点）：

- [ ] 首页没有任何「测试数据 / 演示账号 / Mock」字样外露给普通用户
      （Mock 操作都在折叠的「演示与调试工具」里）
- [ ] `TARO_APP_USE_MOCK=false`，且 `DEFAULT_API_BASE_URL` 没有被打进产物
- [ ] 未获得审批的敏感模块（心理支持 / AI 画面）**入口是关闭的**，且页面明确标注
      「待合规审批」—— 不要给一个点进去就报错的入口
- [ ] 非官方声明可见：可达鸭是第三方非官方平台，与学校官方系统无关
- [ ] 所有列表页都能看到 loading / empty / error / 重试 四态
      （审核会走弱网/断网路径）
- [ ] 隐私政策与后台登记的《用户隐私保护指引》一致

---

## 11. 常见故障排查

| 症状 | 先查什么 |
| --- | --- |
| 部署后「健康检查失败」 | 容器端口是不是 `80`；健康检查路径是不是 `/health`；容器日志有没有启动异常（例如 `DATABASE_URL 未配置`） |
| 启动日志 `Cannot find module '@kedaya/contracts'` | 构建上下文不是仓库根，`node_modules` 里的 workspace 符号链接没打进去 |
| 启动日志 `Cannot find module '@kedaya/shared/src/index.ts'` 之类 | 基础镜像 Node < 22.18，类型剥离不可用 |
| 接口全 500，日志 `数据库连接失败` | `DATABASE_URL` 错、PG 白名单没放行、迁移没跑 |
| 时间差 8 小时 | 容器时区被改成 UTC（应为 `Asia/Shanghai`） |
| 小程序登录偶发失败 | 是否开启了「开放接口服务」（会让自管 `access_token` 超时） |
| 小程序请求报「不在以下 request 合法域名列表」 | 微信后台没加域名，或域名不是 HTTPS |
| 小程序打开是 mock 数据 | `TARO_APP_USE_MOCK` 没设成 `false`，或构建时没加载 `.env.production` |
| 本地 `npm run build:weapp` 后页面白屏 | `common.wxss` 编译失败 —— 检查是否写了 WXSS 不支持的选择器（`src/presentation/theme/__tests__/wxss-safety.test.ts` 会守） |

---

## 12. 本地开发

本地怎么起数据库、怎么跑迁移与种子数据、怎么接真后端，见
[`docs/local-development.md`](./local-development.md)。
