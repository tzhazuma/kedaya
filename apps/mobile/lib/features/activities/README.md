# feature: `activities`（校园活动）

独立 `activities` 域（敏感级：**中**，**无同意门**）。活动**不**塞进课程
`deadlines`：课程 DDL 是学业基础设施，活动有「来源 → 候选 → 用户确认 → 提醒」
自己的生命周期。

---

## 1. 硬约束（共同契约）

| 约束 | 落地 |
| --- | --- |
| 来源只有 `campus-mail` / `wechat-mp` / `manual` | `ActivitySource` 白名单；未知值 `fromJson` 直接抛 `FormatException` |
| 状态只有 `candidate` / `confirmed` / `dismissed` / `archived` | `ActivityStatus` 白名单 |
| 候选必须用户确认后才进日程或触发提醒 | `ActivityItem.canScheduleReminders` 仅 `confirmed`；mock 对候选创建提醒返回 `CONFLICT` |
| 只存活动字段与 ≤200 字证据片段 | `activityEvidenceMaxChars = 200`；模型**没有**正文/附件/HTML 字段；解析与写回双侧截断 |
| 时间存 UTC ISO，展示 Asia/Shanghai | `ActivityItem.fromJson` 只接受**带时区**的 ISO-8601 instant（`Z` / `±HH:MM`）；`2026-11-25` 这类 date-only 与无时区墙钟时间一律按“没有可确定时刻”处理，不补午夜；`activity_time.dart` 固定 `UTC+8` |
| 无法确定的时刻保留原文，不补 23:59 | `registrationDeadlineRaw` 原样展示；没有 `registrationDeadlineAt` 就不建截止提醒 |
| 微信只做用户主动单篇链接/粘贴正文 | `WechatImportDraft` 只有 `url` / `text`（二选一）；正文可带全文供服务端抽取，但**不落库**，证据只留 ≤200 字；不做自动发现、批量历史抓取、反检测或绕过验证 |
| 邮箱复用现有 mail 模块 | 本端只调 `POST /imports/mail`；不读 IMAP、不存正文/附件 |
| 提醒 MVP 是站内信 | 默认渠道 `inapp`；`wechat-subscribe` 保留但 UI 标注“未接通”，mock 拒绝创建；详情页可创建/删除自定义站内信提醒 |
| 默认提醒 | 报名截止前 24h、开始前 1h；目标已过（含恰好等于 `now`）不建；计算时刻已过但目标未来 → `min(now + 5min, target)`，兜底不晚于目标；提前量恰好落在 `now` 直接使用（与 shared 一致） |

## 2. 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| domain 模型 | `lib/domain/models/activity.dart` | `ActivityItem` / `ActivityReminderItem` / `ActivityDraft` / `WechatImportDraft` / 筛选与校验纯函数 |
| domain 时间 | `lib/domain/models/activity_time.dart` | UTC ↔ Asia/Shanghai、严格 instant 解析、选择器窗口、默认开始时间 |
| domain 提醒 | `lib/domain/models/activity_reminders.dart` | `defaultActivityReminders(item, now)`（clamp 到目标） |
| domain 端口 | `lib/domain/ports/activities_port.dart` | `/activities` 全部读/写端点 |
| data（mock） | `lib/data/mock/activity_fixtures.dart` | 相对 `now` 生成的 5 条数据（覆盖 3 来源 + 4 状态） |
| data（mock） | `lib/data/mock/mock_activities_repository.dart` | 确认生成提醒、忽略删提醒、候选禁止排提醒、导入与邮件提升 |
| data（remote） | `lib/data/repositories/remote_activities_repository.dart` | Dio 经 `KedayaApiPort`；写操作带 `Idempotency-Key`；`PATCH` 用 merge-patch |
| application | `lib/features/activities/application/activities_providers.dart` | 列表 / 客户端筛选 / 详情 / 提醒 / actions；列表与提醒都跟随 `nextCursor` 翻页 |
| presentation | `.../pages/activities_page.dart` | 来源 + 状态叠加筛选、三态、空态、加载更多、刷新失败保留旧数据、320px 安全布局 |
| presentation | `.../pages/activity_detail_page.dart` | 字段、原文截止、证据、来源、复制链接（失败提示）、确认/忽略、站内信提醒创建/删除与翻页 |
| presentation | `.../pages/activity_compose_page.dart` | 手动创建（提交时才阻断，错误文本 + `liveRegion`） |
| presentation | `.../pages/activity_import_page.dart` | 公众号单篇链接/摘录导入 |
| presentation | `.../components/activity_cards.dart` | 卡片、来源/状态徽章 |
| presentation | `.../components/activity_date_time_picker.dart` | 北京时间选择器 → UTC instant |

路由：`/activities`（列表）、`/activities/new`（手动创建）、
`/activities/import`（公众号单篇导入）、`/activities/:id`（详情）。
模块镜像：`kedaya_module.dart` 的 `coreModules` + `implementedModuleRoutes`。

## 3. 页面承诺

- 候选活动在列表和详情都明说“不会进入日程、不会触发提醒”；
- 详情里提醒区只展示**站内信状态**，并明说本版本不发送系统推送 / APNs / FCM / HMS /
  微信订阅消息；自定义提醒只提供站内信渠道，可创建、可逐条删除（删除需二次确认）；
- 活动列表与提醒列表都按 `nextCursor` 翻页；翻页失败保留已加载内容并给出重试；
  下拉刷新失败同样保留旧数据，只显示“刷新失败，显示的是上次数据”；
- 日期/时刻选择器必须使用注入的 `activitiesClockProvider`（不在组件内读
  `DateTime.now()`），保证默认开始时间与可选范围来自同一时刻；
- 报名截止只有原文时，明说“没有可确定的时刻”，不补 `23:59`；
- 长链接可换行、复制走剪贴板；不在应用内自动打开外链；复制失败时明确提示
  “请长按链接手动复制”，不假装成功；
- 触摸目标 ≥48px，表单错误用文字 + `Semantics(liveRegion: true)`。

## 4. 与 OpenAPI 的对齐 / 客户端形状假设

已按 `packages/contracts/openapi/kedaya.v1.yaml` 对齐：

- `ActivityCreate` 不传 `source` / `status` / `confidence`；`source` 由服务端固定为
  `manual`，状态固定为 `candidate`；
- `kind` 只使用 `lecture` / `meeting` / `info-session` / `sports` / `club` / `other`；
- `ActivityMailImport` 使用 `{ eventIds: [id] }`；
- 公众号导入的 `url` 与 `text` **二选一**；
- 提醒状态使用 `pending` / `sending` / `sent` / `failed` / `cancelled`；
- `GET /activities/reminders` 没有 `activityId` 查询参数，列表端点返回
  `activityId` / `activityTitle`；`GET` 支持 `cursor` / `limit`，客户端按
  `nextCursor` 翻页并据此过滤。

仍保留的客户端容错（不是契约扩展）：

1. 动作端点可能返回裸 `ActivityItem` 或 `{ item: ... }`，两种都接受；
2. 未知提醒状态显示“状态未知”，不让整页失败；
3. 提醒列表若省略 `activityId`，客户端**不会**把它显示在任何活动详情里
   （无法判断归属）；总列表接口本身仍保留该条；
4. 活动时间字段收到 date-only / 无时区 / 非法字符串时按“没有可确定时刻”处理，
   `registrationDeadlineRaw` 保留原文；提醒的必填 `remindAt` 收到 date-only
   则直接解析失败（不会补午夜）。

## 5. 本模块**不做**的事

- 不自动发现公众号文章、不批量抓取历史文章、不做反检测或绕过微信验证；
- 不读取/存储邮件正文与附件。邮件提升的端口/仓储已实现
  （`POST /activities/imports/mail`，`{ eventIds: [id] }`），但移动端目前没有
  mail 模块的邮件列表，因此**不提供“勾选邮件”的 UI**；等 mail 模块落地后
  接一个入口即可，不在活动页伪造邮件数据；
- 不接入系统推送 / APNs / FCM / HMS / 微信订阅消息（只展示站内信状态），
  也没有新增任何推送依赖；提醒不会离开本应用；
- 不把活动写进课程 `deadlines`，也不在客户端编造缺失的时间。
