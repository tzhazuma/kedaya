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
| 邮件发信 `SMTP_*` | 见 §5.7 | **没配就起不来**（刻意的，见 §5.7）。校园 CAS 未接通前，邮箱注册是用户唯一能自助走通的登录路径 |
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
> 唯一做了强校验的 `DATABASE_URL`：生产环境下缺失会**直接启动失败并打印明确错误**
> （而不是静默用空连接串启动、之后每个请求 500）。
> **`MEDIA_STORAGE=s3` 同样做了强校验**：缺哪一个变量就在启动时报哪一个，不会带病启动。
> **邮件发信也做了强校验**：生产环境没有 `SMTP_HOST`（且没有 `MAIL_TRANSPORT=smtp`）时
> 服务**拒绝启动**，理由见 §5.7 —— 一个「接口说已发送、用户永远收不到」的假功能，
> 比启动失败危险得多。

### 5.4 媒体存储（图片上传）

图片走**服务端中转**：客户端把压缩后的图（JPG/PNG，base64 JSON）发给后端，
后端**剥离元数据**（含 EXIF GPS）后写入对象存储，再把可访问地址回给客户端。
顺序不可调换 —— 之所以不做「预签名直传」，就是因为直传无法保证剥离
（客户端可以绕过小程序代码直接 PUT），而契约 A2.5 明确要求「上传带 GPS 的照片后下载检查，GPS 必须消失」。

| `MEDIA_STORAGE` | 行为 | 适用 |
| --- | --- | --- |
| `disabled`（默认） | 关闭图片功能；`GET /media/config` 返回 `enabled:false`，**客户端整块隐藏选图入口**并说明原因 | 没有对象存储时 |
| `local` | 写本地磁盘 `MEDIA_LOCAL_DIR`（默认 `<cwd>/.media`），通过 `GET /media/files/:key` 回图 | **仅本地开发/自测**。云托管容器无持久化存储，重启即丢图（生产环境用它会打警告日志） |
| `s3` | S3 兼容对象存储 | 生产 |

#### `s3` 模式怎么填（三个云厂商示例）

同一份实现（零依赖手写 SigV4），换 endpoint / region / bucket 即可：

```bash
# 腾讯云 COS（虚拟主机风格）
MEDIA_STORAGE="s3"
MEDIA_S3_ENDPOINT="https://cos.ap-shanghai.myqcloud.com"
MEDIA_S3_REGION="ap-shanghai"
MEDIA_S3_BUCKET="kedaya-media-1250000000"

# 阿里云 OSS
MEDIA_S3_ENDPOINT="https://oss-cn-shanghai.aliyuncs.com"
MEDIA_S3_REGION="cn-shanghai"
MEDIA_S3_BUCKET="kedaya-media"

# Cloudflare R2 / MinIO（R2 与自建 MinIO 通常需要路径风格）
MEDIA_S3_FORCE_PATH_STYLE="true"
```

**Bucket 权限**：对外**可读**（图片要能被 `<Image>` 直接加载），
写入只走服务端的 AK/SK。生产建议再挂一层 CDN 并配 `MEDIA_PUBLIC_BASE_URL`
（配了它就不再从请求头推导 origin，返回的地址稳定，也不会受反向代理的 Host 影响）。

同环境内网互通时可以直接用内网 endpoint（省流量费），只要 `MEDIA_PUBLIC_BASE_URL` 指向公网 CDN。

#### 上线前必做的图片验收（一次真实 PUT 才是最终验证）

单元测试覆盖了 SigV4 签名（AWS 官方文档示例逐字节比对）与元数据剥离，
但**真实对象存储的第一次 PUT 只能在配好凭据后验证**：

```bash
BASE='https://<你的云托管默认域名>'
TOKEN='<登录后的 accessToken>'

# 1) 能力对上了吗（enabled 必须为 true，kind 为 s3）
curl -sS "$BASE/api/v1/media/config"

# 2) 传一张带 GPS 的真实照片（手机拍的原图即可）
B64=$(base64 -i gps-photo.jpg | tr -d '\n')
curl -sS -X POST "$BASE/api/v1/media/images" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"dataUrl\":\"data:image/jpeg;base64,$B64\"}"
# → 记下返回的 url 与 bytes

# 3) 把返回的 url 下载回来，检查 GPS 是否消失（契约 A2.5 的验收方式）
curl -sS -o served.jpg "<上一步的 url>"
grep -c Exif served.jpg || echo 'Exif 已消失'
# macOS 上也可以直接看：mdls -name kMDItemLatitude -name kMDItemLongitude served.jpg

# 4) 发带图的帖子，确认字段真的落库了
curl -sS -X POST "$BASE/api/v1/forum/posts" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"board\":\"campus\",\"title\":\"带图测试\",\"body\":\"见图片\",\"imageUrls\":[\"<上一步的 url>\"]}"

# 5) 外链必须被拒（防止帖子变成外站导流 / 追踪载体）
curl -sS -X POST "$BASE/api/v1/forum/posts" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"board":"campus","title":"x","body":"y","imageUrls":["https://evil.example/a.jpg"]}'
# → 期望 400 VALIDATION_FAILED


### 5.5 客户端遥测（无需配置，但要配保留策略）

小程序把四类**客户端故障**上报到 `POST /api/v1/telemetry/client-events`：

| 触发 | 什么时候会发生 | 为什么必须上报 |
| --- | --- | --- |
| `error` | 未捕获的 JS 异常（`wx.onError`） | 这类错误在组件树之外，**不会**经过 React 错误边界 |
| `unhandled-rejection` | 未处理的 Promise 拒绝 | 同上；`await` 忘了 catch 就会走到这里 |
| `render-error` | 页面渲染期抛错（`KdyErrorBoundary` 捕获） | 用户看到的是兜底页，我们需要知道是哪一页、什么错 |
| `page-not-found` | 进入不存在的页面 | 升级后旧分享链接失效是最常见的入口问题 |
| `api-failure` | 后端返回 5xx 或信封不合规 | **不是**「断网」——用户没信号是环境问题，报了只会淹没真故障 |

设计要点（改这块代码前请读）：

- **匿名可调用**：崩溃常发生在登录之前（冷启动、token 过期、登录页本身报错）。
  要求登录＝在最需要日志的场景静默丢包。有登录态时会顺手记 `userId`。
- **不提供读取接口**：本仓库还没有后台管理员鉴权（`User` 上没有角色位），
  一个「任何登录用户都能读全站崩溃日志」的接口是明确的信息泄露。排查走下面的方式。
- **落库失败不影响响应**：遥测是旁路。数据库抖动时它只记 `WARN` 并仍然返回 200 ——
  否则客户端会因为一次失败的上报**再产生一条遥测**，自激振荡。
- **服务端强制脱敏**：`Authorization: Bearer …`、裸 JWT、`accessToken`/`refreshToken`/`password`、
  邮箱、手机号在**入库前**被替换成 `<redacted>`。
  客户端只负责省流量（截断到 400/3000 字符），安全边界在服务端。
- **按来源限流 30 条/分钟/IP**：单实例内存实现。多实例部署时实际阈值 = 实例数 × 30，
  对「防止写爆库」这个目标够用；要精确限流得上 Redis。

#### 怎么看这些日志

```bash
# 云托管控制台 → 服务 → 日志检索，关键字（每条上报都会打一行 WARN）：
#   [client:error] / [client:api-failure] / [client:render-error] ...
# 一行里同时包含页面路径与客户端 traceId，可直接和后端同一次请求的日志对齐。

# 或者按条件查库（ClientEvent 表）
psql "$DATABASE_URL" -c \
  "select created_at, kind, route, message from \"ClientEvent\" order by created_at desc limit 50;"

# 只看「我们的后端坏了」这一个信号（api-failure），它是服务端故障的最直接指标
psql "$DATABASE_URL" -c \
  "select created_at, message, context from \"ClientEvent\"
    where kind = 'api-failure' and created_at > now() - interval '1 day'
    order by created_at desc;"
```

#### 保留策略（**必须做**）

`ClientEvent` 是纯写入的表，不清理会一路涨成库里最大的表。上线后加一条定时任务
（云托管「定时任务」或任意机器的 cron，每天跑一次）：

```sql
delete from "ClientEvent" where "createdAt" < now() - interval '30 days';
```

30 天是刻意选的：够排查「上周开始有用户反馈」这类问题，又不至于无限膨胀。

> 想关掉上报？目前**没有开关**，这是刻意的：客户端崩溃可观测性是「能让人真正使用」的前提，
> 而落库内容已脱敏、只保留页面路径与错误文本。若确有合规要求，最小改动是在
> `apps/miniapp/src/app.tsx` 里不调用 `container.telemetry.installGlobalHandlers()`
> （错误边界仍会兜住白屏，只是不再上报）。

### 5.6 内容举报与治理（**上线前必读**）

只要小程序里有用户发布的内容（跳蚤 / 跑腿 / 搭子 / 失物 / 论坛），微信就要求平台
提供举报入口并处理举报。代码已就位，**运维侧还需要有人定期看队列**。

举报 → 落 `ContentReport` 表 → 打一条 `WARN` 日志（前缀 `[moderation]`）。
六个可举报对象：`flea-item` / `errand-task` / `buddy-group` / `lost-found-item` /
`forum-post` / `forum-reply`；七个原因：诈骗 / 违法违规 / 色情低俗 / 侮辱谩骂 /
泄露隐私 / 垃圾广告 / 其它。

设计上**刻意不自动下架**：自动下架等于给任何人一个「凑三个人就能删掉你的帖子」的按钮，
而本仓库还没有申诉流程。所以阈值（3 个**不同的人**）只做两件事：
把该对象的全部举报记录标成 `escalated`，并打一条带 ⚠️ 的 WARN 日志。
**下架是人工复核后的动作**（见下面的 SQL）。

#### 每天看一次队列（约 1 分钟）

```bash
# 1) 日志里直接搜关键字（云托管控制台 → 日志检索）
#    [moderation]            —— 全部举报
#    [moderation] ⚠️          —— 只看到达阈值、需要优先处理的

# 2) 或者查库：待处理队列（已升级的排前面，再按时间）
psql "$DATABASE_URL" -c "
  select created_at, escalated, target_type, left(target_title, 24) as title,
         reason, left(coalesce(detail, ''), 40) as detail, target_id
  from \"ContentReport\"
  order by escalated desc, created_at desc
  limit 50;"

# 3) 某一个对象被几个人举报过（判断是不是有人在刷）
psql "$DATABASE_URL" -c "
  select count(distinct \"reporterId\") as reporters, count(*) as reports
  from \"ContentReport\" where \"targetType\" = 'flea-item' and \"targetId\" = '<id>';"
```

#### 决定下架时（人工复核之后）

各模块的列表查询都过滤 `status`，所以把状态改成**不在白名单里的值**即可让内容从列表消失：

```sql
update "FleaItem"      set status = 'removed' where id = '<id>';  -- 跳蚤
update "ErrandTask"    set status = 'removed' where id = '<id>';  -- 跑腿
update "BuddyGroup"    set status = 'removed' where id = '<id>';  -- 搭子
update "LostFoundItem" set status = 'removed' where id = '<id>';  -- 失物
update "ForumPost"     set status = 'removed' where id = '<id>';  -- 论坛帖
update "ForumReply"    set status = 'removed' where id = '<id>';  -- 论坛回复
```

> ⚠️ **这条 SQL 的真实效果**：内容会立刻从所有列表消失，但**按 id 直接打开的详情页仍可访问**
> （详情是「按 id 查一条」，没有再校验状态）。彻底阻断请**删除该行**，
> 或按模块补一条状态校验（已记入第 9 节）。
> 说完限制，也要说清为什么先这样：**没有举报入口**是提审层面的硬伤，
> 「下架后直链仍可见」是可以接受的次生问题，而它被写在文档里而不是被藏起来。

#### 保留策略

举报记录是**证据**，不要按月清理（与 `ClientEvent` 相反）。
建议：已处理且超过 12 个月的记录，先导出归档再删除。**不要在无人复核前批量删**。

#### 为什么没有后台管理界面

本仓库还没有管理员鉴权（`User` 上没有角色位）。一个「任何登录用户都能读到全站举报队列
（含举报人 ID 与被举报内容）」的接口是明确的信息泄露 —— 所以举报**只写不读**
（仅 `GET /reports/mine` 供举报人自己查看）。要做管理后台，先做角色与鉴权。

### 5.7 邮件发信（验证码送达，**没配就起不来**）

邮箱注册、找回密码、绑定邮箱都靠**邮件验证码**。在这之前，本仓库只有一个把验证码写进
服务端日志的开发用实现 —— 也就是说：部署上线后，用户点「获取验证码」会看到「已发送」，
但邮箱里**永远收不到**。三条自助功能全部静默失效，而没有任何人会发现。

现在这件事被两道闸门挡住：

1. **生产环境没配邮件 → 服务拒绝启动**（`resolveMailTransport`），错误信息直接指出缺什么；
2. 真发信的实现会把 SMTP 的错误如实抛给接口 → 客户端显示「发送失败」，不再假装成功。

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.exmail.qq.com` | SMTP 服务器。**配了它就会走真发信** |
| `SMTP_PORT` | `465` / `587` | 缺省：`SMTP_SECURE=true` 时 465，否则 587 |
| `SMTP_SECURE` | `true` | `true` = 隐式 TLS（465，推荐）；`false` = 明文 + `STARTTLS`（587） |
| `SMTP_USER` / `SMTP_PASS` | 发信账号 / 授权码 | **不是**登录密码，是服务商给的「授权码 / 应用专用密码」 |
| `SMTP_FROM` | `可达鸭 <no-reply@your-domain.com>` | 同时是 `From` 头与 `MAIL FROM`。必须是服务商允许的发信地址 |
| `SMTP_SERVERNAME` | 默认取 `SMTP_HOST` | 证书 SNI / 校验用的域名，正常不用配 |
| `SMTP_TIMEOUT_MS` | `10000` | 连接、命令、TLS 握手的统一上限 |
| `SMTP_ALLOW_INSECURE` | `false` | 服务器**不提供** STARTTLS 时才需要。开了等于接受凭据明文过网，仅限内网自建 MTA |
| `MAIL_TRANSPORT` | 不配 | `console` = 只写日志（**生产环境设了会拒绝启动**）；`smtp` = 强制真发信 |

#### 选一家 + 配好发信域（决定用户到底收不收得到）

| 服务商 | 备注 |
| --- | --- |
| 腾讯企业邮 / QQ 邮箱 | 与云托管同生态；`SMTP_HOST=smtp.exmail.qq.com`，`SMTP_PASS` 用「客户端专用密码」 |
| 阿里云邮件推送 | 需要先验证发信域名（加 DNS TXT 记录） |
| Resend / SendGrid 等 | 也提供 SMTP；**发信域必须先验证**，否则只能给账号本人发信 |

无论哪家，都要在域名 DNS 里配好 **SPF / DKIM / DMARC**。不配的后果不是「发不出去」，
而是「发出去了、进了对方垃圾箱」—— 用户会认为这个产品坏了，而我们这边一切正常。

> ⚠️ 事务类邮件（验证码）用**子域**发信（例如 `no-reply@mail.your-domain.com`）是通行做法：
> 万一子域信誉受损，不会连累主域的其他邮件。

#### 上线前必做的邮件验收（5 步）

```bash
# 1) 服务能起来（生产没配 SMTP 会直接起不来，这是对的）
curl -sS "$BASE/health"

# 2) 用一个**真实邮箱**请求注册验证码（响应里不应有 devCode）
curl -sS -X POST "$BASE/api/v1/auth/account/register/code" \
  -H 'content-type: application/json' -d '{"email":"你的邮箱@example.com"}'
# → 期望：201 且 sent:true，响应里**没有** devCode 字段

# 3) 去邮箱收信：应在 1 分钟内到达（没到先看垃圾箱！）

# 4) 用邮件里的验证码完成注册
curl -sS -X POST "$BASE/api/v1/auth/account/register" \
  -H 'content-type: application/json' \
  -d '{"email":"你的邮箱@example.com","code":"邮件里的6位","password":"Kedaya2026","nickname":"验收"}'
# → 期望：200 且返回 accessToken

# 5) 收回执：再请一次验证码 → 期望 409 CONFLICT（60 秒冷却），
#    说明限流也在工作，而不是「谁都能拿这个接口刷垃圾邮件」
```

**验证码泄露检查**：生产环境 `AUTH_DEV_EXPOSE_CODES` 必须是 `false`
（代码里 `NODE_ENV=production` 时无条件关闭，见 `local-auth.service.ts`）。

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

# 7) 遥测端点（匿名可调用；返回 {"ok":true,"data":{"accepted":true}}）
curl -sS -X POST "$BASE/api/v1/telemetry/client-events" \
  -H 'content-type: application/json' \
  -d '{"kind":"error","message":"验收自检","platform":"curl","appVersion":"0.0.0"}'
# → 然后在日志里搜 [client:error]，在库里查 ClientEvent 表，两处都应该有这条

# 8) 举报链路（需要用两个账号：不能举报自己）
#    8a. 用 A 的 token 发一条跳蚤，拿到 itemId
#    8b. 用 B 的 token 举报它 → 期望 201
curl -sS -X POST "$BASE/api/v1/reports" \
  -H "authorization: Bearer <B 的 accessToken>" -H 'content-type: application/json' \
  -d '{"targetType":"flea-item","targetId":"<itemId>","reason":"fraud"}'
#    8c. 同一个 B 再举报一次 → 期望 409（去重生效）
#    8d. 日志里应出现 [moderation] 开头的一行
curl -sS "$BASE/api/v1/reports/mine" -H "authorization: Bearer <B 的 accessToken>"
```

| 检查项 | 期望 | 不通过的常见原因 |
| --- | --- | --- |
| `/health` | 200 | 容器端口配错（应为 80） |
| 列表接口 | `{"ok":true,...}` | `DATABASE_URL` 错 / 迁移没跑 / PG 白名单没放行 |
| 时间字段 | 与北京时间一致 | 容器时区被改成 UTC |
| 未登录写接口 | `{"ok":false,"error":{"code":"UNAUTHENTICATED"}}` | 说明鉴权链路正常；返回 500 则要看日志 |
| 日志里的 traceId | 与响应头 `X-KedaYa-Trace` 一致 | 便于把用户报错精确对到一条请求 |
| 遥测写入 | 库里有 `ClientEvent` 行 | 迁移没跑（该表由 `20261017072546_telemetry_client_events` 创建） |
| 举报写入 | 201 且库里有 `ContentReport` 行 | 迁移没跑（该表由 `20261017074007_content_reports` 创建） |
| 重复举报 | 409 `CONFLICT` | 返回 201 说明唯一索引没建上（迁移没跑全） |
| 邮件发信 | 真实邮箱收到验证码，且响应里没有 `devCode` | 服务没起来说明邮件没配（刻意的）；收到了但响应里有 `devCode` = `NODE_ENV` 不是 `production` |

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
| 图片上传（接口与剥离） | **已实现并实测**（`MEDIA_STORAGE=local` 下上传含 GPS 的真实 JPEG：Exif/GPS 段消失、字节数减少、仍是合法 JPEG） | — |
| 图片上传（真实对象存储 COS/OSS） | **未验证**（无可用的云存储凭据） | 按 5.4 节配 `MEDIA_STORAGE=s3` 后跑一遍「上线前必做的图片验收」 |
| 小程序端选图（`chooseMedia` + 压缩） | **未验证**（需在微信开发者工具/真机操作） | 导入 `apps/miniapp/dist` 后，在发布页选一张带定位的照片，确认发布后图片可显示（详见 10.4） |
| 客户端遥测写入 | **已实现并实测**（匿名单条上报 → 库中 `/redacted/` 生效、超长截断、未知 kind 归类、限流 30/分钟/IP 精确命中） | — |
| 客户端遥测的**真实崩溃采集** | **未验证**（本机无法在真机上触发一次崩溃并观察上报） | 真机（或开发者工具 vConsole）里制造一次 `undefined is not a function`，确认 5.5 节的两个入口（日志 / `ClientEvent` 表）都能看到 |
| 错误边界（`KdyErrorBoundary`）的实际兜底效果 | **未验证**（需要真机渲染异常才能看到兜底页） | 临时在某个页面里 `throw new Error()`，确认出现「这个页面没能打开」而不是白屏，且「重试 / 返回首页」都能点 |
| 举报链路（后端） | **已实现并实测**（自举报 400 / 未登录 401 / 未知类型与原因 400 / 不存在的内容 404 / 重复举报 409 / 三个不同的人举报触发 `escalated` + ⚠️ 日志） | — | 
| 举报链路（小程序端） | **未验证**（需要真机/开发者工具里点一遍） | 导入 `apps/miniapp/dist`，在跳蚤详情点「举报这条内容」→ 选原因 → 提交 → 确认出现「已收到你的举报」，并且重进详情页显示「你已举报…处理中」 |
| 下架后的详情直链 | **已知限制**（不阻断） | 见 5.6 的说明：列表会立刻消失，但按 id 直接打开的详情页仍可访问；要彻底阻断需删除该行 |
| R5 的视觉/交互打磨（骨架屏、下拉刷新、图片懒加载、卡片按下反馈） | **未验证**（本机无法在真机或开发者工具里操作） | 导入 `apps/miniapp/dist` 后：列表首屏应看到骨架而不是转圈；下拉应出现刷新转圈并保留筛选；长列表滚动时图片按需加载；点卡片有按下反馈 |
| 邮箱验证码的**真实投递** | **已用本地假 SMTP 走通全链路**（`AUTH_DEV_EXPOSE_CODES=false` 下请求验证码 → 假服务器收到完整 MIME 邮件 → 用邮件里的验证码注册成功）；**真实服务商未验证**（没有凭据） | 见 §5.7 的 5 步验收。需要额外确认的是**送达率**：SPF / DKIM / DMARC 是否配好、是否进垃圾箱、退信怎么处理 |
| 生产环境「没配邮件就拒绝启动」 | **已验证**（本机 `NODE_ENV=production` 且无 `SMTP_HOST` → 启动即失败，错误信息指向 §5.7；配上 `SMTP_HOST` 后正常启动） | — |

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

# 主包体积（微信硬上限 2 MB，超了**整个包不能上传**）
# 主包 = dist 总计 − 各子包目录；体积按**文件字节求和**（`du` 会因 4 KB 块对齐虚高约 45%）
node -e '
  const fs=require("fs"), path=require("path");
  const app=JSON.parse(fs.readFileSync("apps/miniapp/dist/app.json","utf8"));
  const size=(p)=>{let t=0;const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else t+=fs.statSync(f).size;}return t};return walk(p)};
  const sub=app.subPackages.reduce((n,s)=>n+size(path.join("apps/miniapp/dist",s.root)),0);
  const total=size("apps/miniapp/dist");
  const kb=(n)=>(n/1024).toFixed(0);
  console.log("dist 总计 "+kb(total)+" KB / 子包 "+kb(sub)+" KB / 主包 "+kb(total-sub)+" KB（上限 2048 KB）");
'
# 期望：主包 ≈ 1010 KB，余量约 1 MB
```

> 分包配置在 `apps/miniapp/src/app.config.ts`：六个生活模块 + 宿舍矛盾各成一个子包，
> tabBar 页 / 登录页 / 可达鸭 / 我的 / 核心模块刻意留在主包（见该文件注释）。
> 改页面归属后请重跑上面这条命令确认主包仍有余量。

### 10.2 微信后台配置

1. **request 合法域名**：`https://<你的云托管默认域名>`（必须 HTTPS）。
   云托管默认域名形如 `https://xxx.ap-shanghai.run.tcloudbase.com`；
   正式对外建议绑定**自有域名**（云托管支持自定义域名 + 证书）。
2. **服务类目**：按实际功能选择（工具 / 教育 / 生活服务等）。
   涉及「校园互助」「二手交易」时微信会要求相应的资质说明。
3. **《小程序用户隐私保护指引》**：在「设置 → 服务内容声明 → 用户隐私保护指引」
   里如实填写收集的信息（邮箱、昵称头像、微信 openid、**相册（选图发帖）**）。
   **必须与本仓库 `apps/miniapp/src/presentation/content/legal.ts` 的隐私政策口径一致** ——
   用户能看到的和后台登记的不一致是常见的驳回原因。
   > 发帖配图会上传用户相册里的照片，因此必须勾选「相册」这一项，
   > 并说明「图片在服务端会被剥离位置等元数据」（契约 A2.5）。
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
- [ ] 发布页配图能用：选一张带定位的照片 → 发布后图片正常显示；
      同时确认「图片服务未配置」时**不会出现**一个点了必然失败的选图按钮

### 10.4 图片链路真机自测（发布页配图）

`MEDIA_STORAGE=local`（仅自测）或 `s3` 配好之后，按这条路径走一遍 ——
这是唯一能验证「选图 → 压缩 → 上传 → 剥离 → 显示」整条链路的方式：

1. 后端起在真机/开发者工具能访问的地址（**不能用 `localhost`**：真机把它当自己）。
   开发者工具里可勾选「不校验合法域名」，真机预览则必须用 HTTPS 域名。
2. 打开「跳蚤 → 发布闲置」，点「添加图片」→ 从相册选一张**带定位的照片**。
   - 期望：缩略图立刻出现，右上角一度显示「上传中」，随后变成可点击的大图。
   - 期望：点缩略图能进微信原生大图预览。
3. 故意断网再选一张 → 期望显示红色「点我重试」，点它重试；不点的话提交按钮应当被禁用并给出原因。
4. 发布后在列表卡片上应看到缩略图（有图时缩略图取代文字徽标），详情页顶部是图片宫格。
5. 到对象存储控制台确认对象确实写入；把图片下载回来确认 **EXIF GPS 已消失**（契约 A2.5）。
6. 关掉后端再进发布页 → 期望选图入口**禁用 + 说明 + 重试**，而不是静默消失或点了报错。

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
| 发布页没有「添加图片」按钮 | 后端 `MEDIA_STORAGE` 还是 `disabled`（`GET /api/v1/media/config` 返回 `enabled:false`）—— 这是**刻意**的：没配存储就不给必然失败的按钮 |
| 选图后提示「相册选图需要在微信小程序内使用」 | 在 H5/浏览器里点选图。相册能力只在微信小程序内可用（`platform/imagePicker.ts`） |
| 上传报 `MEDIA_S3_*` 相关启动错误 | 缺变量时的**启动即报错**（与 `DATABASE_URL` 同原则），按提示补齐即可 |
| 图片地址是 `http://localhost:3999/...` | `MEDIA_STORAGE=local` 且没配 `MEDIA_PUBLIC_BASE_URL`，地址从请求头推导。生产请用 `s3` + `MEDIA_PUBLIC_BASE_URL` |
| 本地 `npm run build:weapp` 后页面白屏 | `common.wxss` 编译失败 —— 检查是否写了 WXSS 不支持的选择器（`src/presentation/theme/__tests__/wxss-safety.test.ts` 会守） |
| 页面白屏（不是 mock/域名问题） | 看兜底页在不在。若连兜底页都没有，说明错误发生在 `KdyErrorBoundary` 之外（App 启动阶段）—— 查 `app.tsx` 的 `bootstrapSync` 与容器装配 |
| 库里 `ClientEvent` 表长得飞快 | 没配保留策略。按 5.5 节的 SQL 加一条每天执行的清理任务（30 天） |
| 用户报「点进去就崩」但日志里什么都没有 | 先确认构建用的是最新包（错误边界上报要在新包里）；再把用户的 traceId 拿去日志检索。老版本客户端（还没有上报）不会有任何记录 |
| 举报提交报 400「不支持举报这类内容」 | 客户端与服务端的 `targetType` 白名单漂移了 —— 两边各有一份常量，改一处必须改另一处（服务端 `modules/reports/domain`） |
| 举报队列里出现大量同一对象的记录 | 正常现象（这正是升级信号）；若同一人反复刷，靠 `@@unique(reporterId,targetType,targetId)` 已经卡住了，多的那条会 409 |
| 服务起不来，日志说「生产环境必须配置邮件发信」 | 这是**刻意的**：没有 SMTP 时邮箱注册/找回密码会静默失效。按 §5.7 配置，或（仅演示部署）显式承认限制 |
| 用户说「验证码收不到」 | 顺序排查：① 日志里有没有 `[mail] 已投递给 SMTP`（有 = 已交给服务商，问题在投递侧，查垃圾箱 / SPF / DKIM）；② 有没有 `535`（授权码错，注意不是登录密码）；③ 有没有 `550`（发信域不被服务商允许）。**不要**为了「先让用户注册上」在生产打开 `AUTH_DEV_EXPOSE_CODES`，那等于把验证码公开 |
| 用户说「验证码提示错误」 | 验证码 10 分钟过期、连续错 5 次作废、60 秒冷却、每小时 5 条。超出即报「请重新获取」，不是 bug |

---

## 12. 本地开发

本地怎么起数据库、怎么跑迁移与种子数据、怎么接真后端，见
[`docs/local-development.md`](./local-development.md)。
