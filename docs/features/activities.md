# 校园活动 `activities`

> 状态：MVP 已实现（2026-11-23 核对）。契约模块第 **25** 个，`core` / `medium` /
> **不需要二次同意**。活动是独立域，不并进课程 DDL，也不写入课程课表。

代码入口：

| 层 | 位置 |
| --- | --- |
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
| --- | --- | --- | --- |
| 来源 | 教务 | Blackboard / Gradescope / Piazza / e云平台 | 校园邮箱 / 单篇公众号 / 手动 |
| 创建后 | 直接生效 | 直接生效 | 先落 `candidate`，**用户确认后**才进日程 |
| 提醒 | 课程安排 | 截止时间 | 报名截止前 24h、开始前 1h（站内信） |
| 写入课程课表 | — | 否 | **否** |

活动**不做**自动发现、批量历史抓取、反检测或绕过微信验证；也不把公众号全文、
邮件正文或附件落库。

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

- 提醒渠道枚举有 `inapp` 与 `wechat-subscribe`，但 **MVP 只实现 `inapp`（站内信）**。
  `channel=wechat-subscribe` 会被 **422** 拒绝，不会假装已发送。
- **微信订阅消息、APNs、FCM、HMS 均未接通**；当前没有系统推送依赖。
- 默认提醒：报名截止前 24 小时、活动开始前 1 小时；目标已过不建；
  计算时刻已过但目标还在未来 → `now + 5 分钟`（且不晚于目标）。
- 派发由外部 cron 调 `POST /activities/reminders/dispatch`（`AdminGuard`，
  `x-admin-key` 或管理员 JWT）。`claimDue` 用 `FOR UPDATE SKIP LOCKED` 原子抢占，
  多副本不重复；单条失败回退 `pending` 重试，达到上限标 `failed`，**绝不标 `sent`**。
- 小程序有独立的提醒页；Flutter 在详情页创建/删除站内信提醒；Web 不创建提醒。

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
| --- | --- | --- | --- | --- |
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
| --- | --- |
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
| --- | ---: | --- |
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
- 小程序：没有独立的手动创建页；`archive` / `restore` 没有页面入口。
- Web：无登录、无持久化、无提醒；确认只对本次导出有效。
- Flutter：没有校园邮箱勾选 UI、没有 ICS / 手机日历导出；未在真机验证。
- 移动端多平台：CI 配置存在但 GitHub runner 未实跑；Windows ARM64 实验、
  Linux ARM64 未实现、HarmonyOS 仅自托管未验证。
