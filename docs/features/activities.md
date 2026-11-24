# 校园活动 `activities`

> 状态：MVP 已实现（2026-11-23 核对）。契约模块第 **25** 个，`core` / `medium` /
> **不需要二次同意**。活动是独立域，不并进课程 DDL，也不写入课程课表。

代码入口：

| 层 | 位置 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 契约 | `packages/contracts/src/activities.ts`、`packages/contracts/src/modules.ts` |
| 共享纯函数 | `packages/shared/src/activities-extract.ts` / `activities-ics.ts` / `activities-reminders.ts` / `activities-time.ts` |
| API | `services/api/src/modules/activities/`；校园邮箱在 `services/api/src/modules/mail/` |
| 小程序 | `apps/miniapp/src/presentation/pages/activities/`、`application/activities/` |
| Web | `apps/web/src/features/activity-import/`（`/import#campus-activities`） |
| Flutter | `apps/mobile/lib/features/activities/` |

---

## 1. 边界

活动回答「什么时候去哪参加什么」，课程 DDL 回答「什么时候交作业」，课表回答
「什么时候上课」。三者都出现在日程里，但生命周期不同：

| | 课程课表 `schedule` | DDL `deadlines` | 活动 `activities` |
| ------------ | ------------------- | ------------------------------------------ | ---------------------------------------- |
| 来源 | 教务 | Blackboard / Gradescope / Piazza / e云平台 | 校园邮箱 / 单篇公众号 / 手动 |
| 创建后 | 直接生效 | 直接生效 | 先落 `candidate`，**用户确认后**才进日程 |
| 提醒 | 课程安排 | 截止时间 | 报名截止前 24h、开始前 1h（站内信） |
| 写入课程课表 | — | 否 | **否** |

活动不做私有会话抓取、反检测或绕过微信验证；自动同步只走认证服务号的官方授权接口。
公众号全文、邮件正文或附件均不落库。

---

## 2. 三种来源

来源枚举是冻结的：`campus-mail` / `wechat-mp` / `manual`。

### 2.1 校园邮箱 `campus-mail`

- 只接上海科技大学校园邮箱（`@shanghaitech.edu.cn` / `@stu.shanghaitech.edu.cn`），
  IMAP 主机必须在校内域名下（防 SSRF）。
- 用户填写的是邮箱设置里生成的**客户端专用密码**，不是校园日常密码。
- 服务端**只读** IMAP：`mailboxOpen('INBOX', { readOnly: true })`，代码里没有
  `send` / `append` / 删除 / 改已读标志的路径。
- 绑定前先真连一次 IMAP 验证；密码只在一次局部作用域里以明文存在，落库前用
  **AES-256-GCM** 加密（`passwordCipher`），响应与日志里都不出现密码或密文。
- 同步只落**归一后的活动**与 UID / 时间等元数据，不存邮件正文与附件；
  同步失败保留上次结果并标 `stale`，不清空。
- 小程序端调用 `POST /mail/account`、`POST /mail/sync`、`GET /mail/events`，
  再把用户勾选的事件通过 `POST /activities/imports/mail`（`{ eventIds: [...] }`）
  提升为候选活动；不做全箱扫描。

### 2.2 微信公众号 `wechat-mp`

- 只接受**用户主动**给的**单篇**文章：`POST /activities/imports/wechat`，
  `url` 与 `text` 二选一（`.strict()`）。
- 链接只认 `https://mp.weixin.qq.com/...` 的文章路径；不打开 `web-view`
  （需业务域名备案），只提供「复制链接」。
- 微信**没有**公开的「读取关注列表 / 批量历史文章」接口（「发布能力」只对运营者
  自己的号有效）；内部接口需要几小时就失效的 Cookie，批量采集也违反微信条款。
  因此活动不做自动发现、不做批量历史抓取。
- 公开的 `POST /wechat/article` 支持一次解析用户主动给出的多篇链接（最多 20 篇），
  但那是「用户已经打开的文章」，不是抓历史；活动导入本身仍是单篇。
- 正文只用于本次抽取，抽取后只保留活动字段与 ≤200 字证据片段。

认证公众号自动同步走微信官方 `POST /cgi-bin/freepublish/batchget`（每页最多 20 条），
支持 `authorizer_access_token`，仅用于学校/学院已授权的认证服务号。账号配置在服务端
`WECHAT_OFFICIAL_ACCOUNTS` JSON 数组中（`key/name` 及 `authorizerAccessToken` 或
`appId/appSecret`）；公开账号列表只返回 `key/name/subscribed`。用户通过
`POST /activities/official/subscriptions` 订阅，`POST /activities/official/sync` 立即同步；
`article_id` 去重，非活动文章记 skipped，候选仍须用户确认。管理员可调用
`POST /activities/official/sync-all`，设置 `OFFICIAL_SYNC_ENABLED=true` 后 worker 按
`OFFICIAL_SYNC_INTERVAL_MS` 周期同步（默认 15 分钟，最小 1 分钟）。正文仅在内存抽取，
不把全文写入 Activity。微信内部历史页的私有 Cookie/appmsg_token 不作为实现路径。

### 2.3 手动 `manual`

- `POST /activities/items`。客户端不能指定 `source` / `status` / `confidence`：
  服务端固定 `source=manual`、`status=candidate`，置信度按字段完整度计算。
- 时间必须带时区（`Z` 或 `±HH:MM`）；不接受 `YYYY-MM-DD`，避免在上海时区漂成前一天。
- 小程序目前没有独立的手动创建页；Web 的导入工作台有「手动新增活动」；
  Flutter 有 `/activities/new`。

---

## 3. 候选必须确认

状态只有 `candidate` / `confirmed` / `dismissed` / `archived`。

- 抽取、导入、手动创建都先落 `candidate`，**不建提醒、不进日程**。
- `POST /activities/items/:id/confirm` 才把状态改成 `confirmed`，并由**服务端**
  创建默认提醒；客户端只读取，不重复创建。
- `PATCH /activities/items/:id` 只能改事实字段，**不能借 PATCH 改 status**。
- `dismiss` / `archive` 会取消待发提醒，保留已发送历史；`restore` 只把
  `archived` 还原成 `candidate`，**不自动重建提醒**，需要重新确认。
- 只有 `confirmed` 会出现在「今天 / 本周」列表、ICS 导出和提醒派发里。
- 结束时间必须晚于开始；报名截止不得晚于开始。无法确定的时刻保留原文
  （`registrationDeadlineRaw`），绝对时刻为 `null`，**不补 23:59**，也不猜时长。

---

## 4. 数据最小化

- 证据片段上限 **200 字**（`ACTIVITY_EVIDENCE_MAX_CHARS`），不是邮件正文、
  不是公众号全文；附件、图片正文、完整 HTML 都不进库。
- `registrationUrl` / `sourceUrl` / 证据里的链接统一走 `sanitizeSourceUrl`，
  去掉 `utm_*`、`scene` 等会话/分享参数；公众号 `/s/<id>` 形式连查询串一起丢掉。
- 时间传输与存储一律 UTC ISO-8601；展示与解析显式按 `Asia/Shanghai`，
  不依赖浏览器或设备本地时区。
- 敏感级 `medium`、不设二次同意：条目能反推出「谁可能对什么活动感兴趣」，
  但不含成绩、健康、心理等数据。将来若接通讯录/画像推荐，必须重新评估敏感级。

---

## 5. 提醒

- `ActivityReminder` 仍先写 `inapp` 站内信，保证主提醒可追溯；直接创建
  `channel=wechat-subscribe` 的提醒仍会被 422 拒绝。站内信成功后按用户登记目标写入 PushDelivery 发件箱。
- 微信订阅消息走 `requestSubscribeMessage` + `templateId` 回传，openid 只从服务端微信绑定读取，
  一次性授权成功后耗尽；APNs / FCM / HMS 由原生通道取得真实设备 token 后登记。
  服务端供应商分别为微信 `subscribe/send`、APNs HTTP/2 + ES256 JWT、FCM v1 OAuth、HMS Push OAuth。
- 推送失败不回滚站内信；发件箱原子抢占、最多三次尝试，未配置厂商不伪报 sent。
  `PUSH_WORKER_ENABLED=true` 可开启 worker，生产默认开启（显式 false 关闭），也可由管理员调用
  `POST /notifications/push/dispatch`。真实发送仍需各自证书/模板/应用配置与真机验证。
- 默认提醒：报名截止前 24 小时、活动开始前 1 小时；目标已过不建；
  计算时刻已过但目标还在未来 → `now + 5 分钟`（且不晚于目标）。
- 派发由外部 cron 调 `POST /activities/reminders/dispatch`（`AdminGuard`，
  `x-admin-key` 或管理员 JWT）。`claimDue` 用 `FOR UPDATE SKIP LOCKED` 原子抢占，
  多副本不重复；单条失败回退 `pending` 重试，达到上限标 `failed`，**绝不标 `sent`**。
- 服务端配置：`WECHAT_ACTIVITY_TEMPLATE_ID`、`WECHAT_ACTIVITY_TITLE_KEY`、`WECHAT_ACTIVITY_BODY_KEY`；
  `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY`；`HMS_APP_ID` / `HMS_CLIENT_ID` /
  `HMS_CLIENT_SECRET`；`APNS_TEAM_ID` / `APNS_KEY_ID` / `APNS_PRIVATE_KEY` / `APNS_TOPIC` /
  `APNS_SANDBOX`。私钥可用 `\n` 转义，绝不进入客户端或仓库。
- Android 分别放置 `google-services.json`（FCM）与 `agconnect-services.json`（HMS），构建 HMS 时传
  `--dart-define=HMS_APP_ID=...`；iOS 使用 `Runner.entitlements` / `RunnerRelease.entitlements` 与真机签名。
- 小程序有独立的提醒页；Flutter 在详情页创建/删除站内信提醒，并有「通知与推送」设置页；Web 不创建提醒。

---

## 6. 日程、ICS 与手机日历

- 活动日程与课程课表**分开**：确认活动不会写入 `schedule` 或 `deadlines`。
- ICS 由 `@kedaya/shared` 的 `buildActivityIcs` 生成；只有 `confirmed` 会进日历，
  没有开始时间就不编一个，也不编时长。服务端**不托管**日历订阅地址。
- Web：确认只存在当前页面内存里，逐条确认后下载 **ICS / JSON**；刷新即清空，
  不写 localStorage、不调日程/提醒接口。
- 小程序：详情页「加入手机日历」优先调 `wx.addPhoneCalendar`；调用失败或非微信端
  则复制 ICS 文本，让用户到日历 App 导入。这不是微信订阅消息，不产生微信推送。
- Flutter：当前只有列表 / 详情 / 新建 / 导入，**没有 ICS 导出或手机日历写入**。

---

## 7. 客户端能力矩阵

| 能力 | 小程序 | Web | Flutter | API |
| -------------------------- | ------------------------ | -------------------------------------------- | ------------------- | ------------------ |
| 活动列表 / 详情 | ✅ | ❌（仅导入工作台） | ✅ | ✅ |
| 手动创建 | ❌（无独立表单） | ✅（导入页内） | ✅ | ✅ |
| 单篇公众号导入 | ✅ | ✅（链接走 `/wechat/article`，正文本地抽取） | ✅ | ✅ |
| 校园邮箱绑定 / 同步 / 提升 | ✅ | ❌ | ❌（无邮件列表 UI） | ✅ |
| 候选确认门 | ✅ | ✅（内存内） | ✅ | ✅ |
| 站内信提醒 | ✅ | ❌ | ✅（详情页） | ✅ |
| ICS 导出 | ✅（复制降级） | ✅（下载） | ❌ | 共享纯函数，无端点 |
| 手机系统日历 | ✅ `wx.addPhoneCalendar` | ❌ | ❌ | — |
| 登录 / 持久化 | 登录 | 无登录、不持久化 | mock 或远端 | 登录 |

---

## 8. 跨平台状态

| 平台 | 状态 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 微信小程序 | 当前交付范围；活动五页已接，测试实跑通过 |
| Web | 当前交付范围；`/import#campus-activities` 无状态导入，测试实跑通过 |
| API | 当前交付范围；活动端点与邮件模块已接，测试实跑通过 |
| Android / Windows x64 / Linux x64 / macOS / iOS | **有 CI 配置**（`.github/workflows/mobile-build.yml`），GitHub runner **未实跑**；本机也未在真机/模拟器启动 |
| Windows ARM64 | **实验**：`mobile-windows-arm64.yml` 仅手动触发，不进入 Release，未实跑 |
| Linux ARM64 | **未实现**：官方没有 Linux ARM64 Flutter SDK，3.35.1 拒绝 x64→arm64 交叉编译 |
| HarmonyOS | 只有自托管 `self-hosted, linux, ohos` 流水线，**未验证**；GitHub 托管 runner 不可用 |

「代码存在」不等于「已交付」：移动端构建配置与产物签名状态见
`docs/build/README.md`，不要把它写成已发布。

---

## 9. 已知基线红灯（不属于活动功能）

在 Windows 上跑全量门禁时，以下失败是既有问题，**不要算到 activities 头上**：

| 位置 | 数量 | 原因 |
| ------------------------------------------------- | --------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| API `test/techpie-arch.spec.ts` | 3 项 | 断言用 `/` 比较路径，Windows 下 `path.relative` 产出 `\`，导致 `startsWith('services/api/')` / `includes('webview-session/')` 不匹配 |
| Web `src/presentation/theme/buddy-tokens.test.ts` | 1 项 | 同一类 Windows 路径分隔符问题，扫描到的组件数为 0 |
| API `npm run lint` | 5 项（4 error + 1 warning） | `auth.module.ts`、`tts.service.ts`、`tts.controller.spec.ts`、`wechat.controller.ts`、`test/tts-http.spec.ts` 的既有未使用变量 / 失效 eslint-disable |

实测（2026-11-23）：

```text
API 全量：1817 passed / 3 failed / 15 skipped
Web buddy-tokens：16 passed / 1 failed
API lint：4 errors + 1 warning
```

活动相关测试全绿：API 67（40 单元 + 27 HTTP/DB 集成）、Web 42、小程序 112、
契约 + 共享 117。

复现基线红灯：

```bash
npm run test -w @kedaya/api
npm run lint -w @kedaya/api
(cd apps/web && npx vitest run src/presentation/theme/buddy-tokens.test.ts)
```

---

## 10. 验证命令

```bash
# API 活动
npx vitest run services/api/src/modules/activities

# API 活动 HTTP/DB 集成（必须在 services/api 下跑；setup 才会注入 JWT_SECRET）
(cd services/api && npx vitest run test/activities-http.spec.ts test/activities-db.spec.ts)

# 契约 + 共享
npx vitest run packages/contracts/src/activities.test.ts \
  packages/contracts/src/modules.test.ts \
  packages/shared/src/activities-extract.test.ts \
  packages/shared/src/activities-ics.test.ts \
  packages/shared/src/activities-reminders.test.ts

# Web 活动（必须在 apps/web 下跑，别名来自该 workspace 的 vitest 配置）
(cd apps/web && npx vitest run src/domain/models/activitiesEntry.test.ts src/features/activity-import)

# 小程序活动
npx vitest run apps/miniapp/src/domain/models/__tests__/activity.test.ts \
  apps/miniapp/src/domain/models/__tests__/activityIcs.test.ts \
  apps/miniapp/src/domain/models/__tests__/mailActivity.test.ts \
  apps/miniapp/src/application/activities \
  apps/miniapp/src/data/repositories/__tests__/httpActivityRepository.test.ts \
  apps/miniapp/src/data/repositories/__tests__/mailActivityPromote.test.ts \
  apps/miniapp/src/presentation/pages/activities
```

---

## 11. 已知缺口

- 公众号：没有读取关注列表 / 批量历史文章的官方接口，因此永远不做自动发现与批量历史抓取。
- 提醒：微信订阅消息、APNs、FCM、HMS 未接通；目前只有站内信。
- 小程序：没有独立的手动创建页；`archive` / `restore` **已接**——详情页有「归档」与「恢复为候选活动」，归档会清掉待发提醒。
- Web：无登录、无持久化、无提醒；确认只对本次导出有效。
- Flutter：**已补齐**校园邮箱（绑定 / 同步 / 提升）与 ICS 导出（单条 + 批量）；
  ⚠️ 未在真机验证（本机缺 Visual Studio，Windows 包由 CI 产出后跑过启动 + 截图）。
- 移动端多平台：Windows x64 / Linux x64 / Linux ARM64 / macOS / iOS / Android
  均已由 CI 实跑并发布（`mobile-v0.1.7`）；HarmonyOS HAP 本地构建通过但未签名。

### 11.1 真实抓取与抽取的实测结论（2026-11-25）

用一篇**真实**公众号文章跑通了整条链路（`https://mp.weixin.qq.com/s/fmfXwa…`）：

| 环节 | 结果 |
| --- | --- |
| `fetch` 文章页 | HTTP 200，3.78 MB，无「环境异常」墙 |
| `parseWechatArticle` | 标题、公众号名、`publishedAt`（+08:00）、10 行正文、7 张图 |
| `extractActivityCandidates` | **0 条候选** |

0 条不是崩溃，而是规则的结果：候选锚点要求**同一行**同时含「时间线索」与
「地点/报名线索」（`pickEventCandidateLines`），或「时间行紧邻地点行」。
这篇是活动**回顾**，写着「4月10日，温州大学邀请…开设讲座」，时间与地点分散在
不同句子，因此不产出候选 —— 服务端随后会返回
「没能从粘贴内容里识别出活动」。

**已改善（2026-11-25）**：同一段里「时间一句、地点一句」的写法现在能认出来 ——
逐行锚点失败时按空行切段再判一次；地点也支持「地点设在/位于」这种无冒号写法。
回顾语气（成功举办 / 举办了 / 现场气氛 / 吸引了…参加）仍然拒绝，
且**锚点本身**带回顾语气也不算锚点。

**仍然认不出**：时间与地点被**整段无关内容**隔开（中间还有别的段落），
或通篇没有可解析的时间。这两类需要用户手工新建。
