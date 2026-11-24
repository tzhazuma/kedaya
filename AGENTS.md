# 项目开发约定

当前**已验证**的交付范围为微信小程序、Web 和 NestJS API；`apps/mobile` 的 Flutter 客户端已有入口，
但能力与验证状态不同（见 `docs/features/activities.md` §8 与 `apps/mobile/README.md`）。
保留工作区中已有修改，不回退其他人的工作。

微信小程序的 UI 固定使用 **Taroify** 与「**校园贴纸簿**」视觉体系（真白底 + 墨蓝黑字 +
鸭黄主操作 + 淡粉/淡绿功能卡 + 手绘胶囊导航，来自 `feature/pingdan` 分支的设计稿）；
修改该端前必须阅读
`apps/miniapp/AGENTS.md` 和 `docs/miniapp-ui.md`。后续新增页面与控件沿用该规范。
Web 与小程序是独立客户端，避免为单端视觉调整改变另一个端的主题。

账号体系已在小程序端与后端实现，共三条并列的登录入口：**校园 CAS**（后端已接线，
当前为开发用 Mock 适配器，真实对接点见 `mock-campus-auth.provider.ts` 顶部注释）、
**邮箱 + 密码**（注册/登录/改密/找回）、**微信小程序快捷登录**（首次自动建号，可后补邮箱密码）；
账号自助包括改昵称/头像、绑定/解绑微信（至少保留一种登录方式）。
六个业务模块（跳蚤、宿舍矛盾、跑腿、找搭子、失物招领、论坛）小程序端与后端已实现；
另有四个「共建型」模块（食堂营养 `canteen`、常见问题 `faq`、野生动物 `wildlife`、
偷外卖 `takeout-guard`）也是真实可用的垂直切片（后端筛选/归属安全 + 小程序三页 + 测试），
其中偷外卖是**本人可见的报备记录**而非公开举报墙（归属只从 JWT 取）；
`canteen` 已升级为**「营养管家」**（模块 id 不变，取舍见 `docs/adr/0006-nutrition-butler.md`）：
菜品库检索（**食堂分类筛选**：白名单是 `@kedaya/shared` 的 `CANTEEN_NAMES`，
三端唯一真相，小程序侧别名 `CANTEEN_OPTIONS` 保留；筛选与菜名是叠加条件）
→ 拍照/点选记当餐（营养从菜品库**快照**，请求不带营养值）→ 六项营养汇总与趋势 →
每日需求（用户自提，估算器只预填）→ 缺口推荐（`sodiumMg` 是上限值，超标不推加钠的菜）；
识别走 **mock 适配器 + Port seam**，响应 `mode: 'mock'` 且界面必须明示「演示期识别」；
计算核心在 `packages/shared/src/nutrition.ts` 一份、三端共用；**菜品写操作收在 `AdminGuard`**
（`x-admin-key` / `ADMIN_USER_IDS`，两者都没配则一律拒绝），Web 后台 `/admin/dishes` 是维护入口；
小程序端营养管家的 `/nutrition/dishes` 是**菜品库浏览**（食堂分类 chip + 菜名/品类叠加筛选 +
每行标明食堂与数据来源），补录表单折叠在「演示工具」里、文案已写明写入需管理员；
营养管家首页也有「按食堂看菜品」入口（7 个食堂 + 全部菜品）。
旧的「共建菜品库」三页仍保留
（浏览可用），但首页宫格指向营养管家主界面。**注意**：新录入菜品的 `allergens` 尚无服务端推断
（ADR 0006 C8），忌口硬过滤目前对种子菜品之外的新菜不生效；
另有三个模块（校园技术服务目录 `techpie`、心理支持 `wellbeing`、AI 校园画像 `ai-portrait`）
也已落地；场馆预约 `facility` 的小程序三页（列表 / 发起 / 详情）也已补齐，
**26 个契约模块已登记（9 个核心 + 17 个业务）；其中 21 个有后端端点**（`deadlines` / `campus-map` 目前只有
小程序端本机数据，`petition` / `teabreak` 只有契约与规则层）。`facility` 取消走
`POST /items/:id/cancel`，时段冲突由服务端判定；小程序侧暂无单测，api 侧有 spec：

- `techpie` 是**同学共建的服务目录 + 人工核对**（`POST /items/:id/sync` 只是把 status 写成 `synced`，
  没有上游同步 —— 页面写「已核对」而不是「已同步」）。外链**不做 web-view**（需业务域名备案），
  只提供「复制服务地址」；
- `wellbeing` 是**倾听与预约入口**，文案固定「心理支持」，**不做诊断、不做治疗**；
  `GET /wellbeing/crisis-line` **公开**（无登录/无同意），返回 `prominence: primary`，
  前端必须**首屏**渲染，接口失败也有 `CRISIS_FALLBACK` 兜底；上线前必须逐个拨通热线核实；
- `ai-portrait` 的**每个标签都要能说出来源**，页面**明示**心理支持与宿舍矛盾**不参与**画像；
  后端尚无画像生成逻辑，`GET /me` 返回 `null` 是常态，页面给空态而**不在客户端编造标签**。
两个高敏模块都保留二次同意门（同意门在**加载数据之前**），且不接分享与举报。
第 25 个模块是独立域 `activities`（校园活动，`core` / `medium` / 不设二次同意）：
抽取/导入只产生 `candidate`，**必须用户确认**后才进入活动日程（「今天 / 本周」列表、
ICS / 手机日历）并生成提醒，**不写入课程课表**；来源包括校园邮箱、用户主动提交的单篇公众号、
手动，以及学校/学院认证公众号授权后的 `freepublish/batchget` 订阅同步。微信没有读取个人关注列表或
任意公众号历史文章的官方接口，因此不做私有会话抓取、反检测或绕过验证；公众号链接只复制、不开
`web-view`。校园邮箱复用服务端**只读 IMAP**（客户端专用密码、AES-256-GCM 落库，不存正文/附件）。
提醒支持站内信，微信订阅消息 / APNs / FCM / HMS 已有服务端发件箱与原生登记代码，但真实发送仍需
各自模板、证书、厂商配置与真机验证。只存活动字段与 ≤200 字证据片段，链接清洗会话参数。详见
`docs/features/activities.md`。
三端入口能力不同：小程序有列表 / 详情 / 导入 / 校园邮箱 / 提醒五页，另有历史消息页批量导入
（`activities/history`，解析用户自己保存的页面，不抓取）；Web 是
`/import#campus-activities` 无状态导入（不登录、不持久化，确认后导出 ICS / JSON）；
Flutter 有列表 / 详情 / 新建 / 导入 / 历史页导入 / 校园邮箱（绑定·同步·提升）/ 详情页 ICS 导出。
第 26 个模块是 `zhishu`（知枢工作台，`core` / `medium`）：日报、JARVIS 本地引用检索、资料库、
知乎条目与 QQ 文本导入五页在小程序与 Flutter 均已落地，共用本机持久化工作区。JARVIS 当前是
带引用的本地检索而非大模型；QQ 不读取/结束其他应用进程；在线知乎与 QQ 同步仍需授权，演示条目标注「演示」。
**首页不再是模块目录**：一级入口「凑凑」聚合拼单 + 找搭子（聚合关系只在
`apps/miniapp/src/domain/models/homeEntries.ts` 声明，契约里 `groupbuy` / `buddy` 仍是
两个独立模块），「我的常用」宫格由用户偏好驱动（`application/homeLayout/`，本机、按账号分片、
默认 9 个 / 上限 12 个），全部服务收进按场景分组 + 可搜索的**服务大厅**；
「我的 → 首页管理」增删排序，`wellbeing` 是固定入口（可排序、不可移除 —— 安全出口不能被误触藏掉），
首页底部另有常驻热线横幅。26 个契约模块都已登记，已有真实页面的模块不再使用「开发中」占位。
小程序的第一屏是**入口页**（`PAGE_PATHS.welcome`，`app.config.ts` 的 `pages[0]`）：
贴纸簿大标题 + 可达鸭立绘 + 「进入主页」，首页左上角保留「返回入口」，两边可互跳；
底部导航是**自绘的手绘胶囊 dock**（`tabBar.custom: true` + `src/custom-tab-bar/` → `KdyDock`：
首页 / 地图 / ＋（发起拼单）/ 发现 / 我的），四个 tab 页**不要**再自己写 `<KdyDock/>`；
「消息」不占 dock 格子，但仍是 tabBar 页（入口在「我的」，`switchTab` 与红点下标不变）。
核心模块（身份 `auth`、课表 `schedule`、校园卡 `campus-card`、我的 `profile` 的
隐私与数据页，以及 DDL 聚合 `deadlines`、校园地点 `campus-map`、校园活动 `activities`、
站内信 `notifications`）与内置全局助手「可达鸭」（`agent`，含 `KdyAgentFab` 悬浮入口）已实现，
校园数据默认走 `CAMPUS_DATA_MODE=mock`（确定性模拟数据，响应标 `simulated: true`，
真实对接点见 `services/api/src/modules/auth/data/http-campus-data.adapter.ts`；
CAS 侧见 `mock-campus-auth.provider.ts` 顶部注释），拿到校方授权后切 `live` 即可，
权限逻辑（`CampusSessionPort` / 加密落库 / 审计）在两种模式下完全相同。
可达鸭 **facts-first**：受 `userId` 约束的实时工具取事实 → 检索白名单公共知识 → 模型只组织语言；
未配置 `AGENT_LLM_*` 时用规则回答（`degraded: true`），功能完整。
小程序的校园地图**不再用原生 `<map>`（腾讯/高德街道图）**：`/wildlife` 三页改用校方校园 GIS 的
**真实栅格底图**（`KdyCampusMap` + `@kedaya/contracts` 的 `campus-map` 投影模块，底图在 wildlife 分包内），
叠加层坐标系仍是 GCJ-02（页面继续走 `buildMapOverlays()`），「在腾讯地图中打开」作为导航出口保留；
来源/署名/授权状态见 `docs/features/miniapp-campus-map.md`（校方授权**未确认**，上线前需确认）。
Web 门户目前交付拼单垂直切片、管理后台占位与校园活动无状态导入
（`/import#campus-activities`）。
Web 的模块交付状态以 `apps/web/src/domain/models/delivery.ts` 为**唯一真相**
（宫格角标与模块说明页都由它驱动，别在组件里另写一份判断）。本地启动、数据库与真实联调方式见 `docs/local-development.md`。

提交前请跑以下命令；除 `docs/features/activities.md` §9 记录的既有 Windows 基线红灯外，
不应新增失败（API techpie 3 项、Web buddy-tokens 1 项、API lint 5 项，均不属于活动功能）：

```bash
npm run typecheck -w @kedaya/api && npm run test -w @kedaya/api && npm run lint -w @kedaya/api
npm run typecheck -w @kedaya/miniapp && npm run test -w @kedaya/miniapp && npm run lint -w @kedaya/miniapp
npm run build:weapp && npm run verify:weapp -w @kedaya/miniapp
npm run typecheck -w @kedaya/web && npm run test -w @kedaya/web && npm run lint -w @kedaya/web
```
