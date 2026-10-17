# 项目开发约定

当前交付范围为微信小程序、Web 和 NestJS API。保留工作区中已有修改，不回退其他人的工作。

微信小程序的 UI 固定使用 **Taroify** 与可达鸭黄色设计体系；修改该端前必须阅读
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
另有三个模块（校园技术服务目录 `techpie`、心理支持 `wellbeing`、AI 校园画像 `ai-portrait`）
也已落地，**20 个契约模块里的 19 个在小程序端与后端都有真实页面与端点**；
唯一例外是第 20 个模块 `facility`（场馆预约）—— 后端已挂 `/api/v1/facility/items`
脚手架接口（含时段冲突检测与发起人取消），但**小程序端还没有页面**，首页会如实标成
「开发中」而不是假的可用入口：
- `techpie` 是**同学共建的服务目录 + 人工核对**（`POST /items/:id/sync` 只是把 status 写成 `synced`，
  没有上游同步 —— 页面写「已核对」而不是「已同步」）。外链**不做 web-view**（需业务域名备案），
  只提供「复制服务地址」；
- `wellbeing` 是**倾听与预约入口**，文案固定「心理支持」，**不做诊断、不做治疗**；
  `GET /wellbeing/crisis-line` **公开**（无登录/无同意），返回 `prominence: primary`，
  前端必须**首屏**渲染，接口失败也有 `CRISIS_FALLBACK` 兜底；上线前必须逐个拨通热线核实；
- `ai-portrait` 的**每个标签都要能说出来源**，页面**明示**心理支持与宿舍矛盾**不参与**画像；
  后端尚无画像生成逻辑，`GET /me` 返回 `null` 是常态，页面给空态而**不在客户端编造标签**。
两个高敏模块都保留二次同意门（同意门在**加载数据之前**），且不接分享与举报。
**首页不再是模块目录**：一级入口「凑凑」聚合拼单 + 找搭子（聚合关系只在
`apps/miniapp/src/domain/models/homeEntries.ts` 声明，契约里 `groupbuy` / `buddy` 仍是
两个独立模块），「我的常用」宫格由用户偏好驱动（`application/homeLayout/`，本机、按账号分片、
默认 9 个 / 上限 12 个），全部服务收进按场景分组 + 可搜索的**服务大厅**；
「我的 → 首页管理」增删排序，`wellbeing` 是固定入口（可排序、不可移除 —— 安全出口不能被误触藏掉），
首页底部另有常驻热线横幅。未实现的 `facility` 仍如实标「开发中」。
四个核心模块（身份 `auth`、课表 `schedule`、校园卡 `campus-card`、我的 `profile` 的
隐私与数据页）与内置全局助手「可达鸭」（`agent`，含 `KdyAgentFab` 悬浮入口）已实现，
校园数据默认走 `CAMPUS_DATA_MODE=mock`（确定性模拟数据，响应标 `simulated: true`，
真实对接点见 `services/api/src/modules/auth/data/http-campus-data.adapter.ts`；
CAS 侧见 `mock-campus-auth.provider.ts` 顶部注释），拿到校方授权后切 `live` 即可，
权限逻辑（`CampusSessionPort` / 加密落库 / 审计）在两种模式下完全相同。
可达鸭 **facts-first**：受 `userId` 约束的实时工具取事实 → 检索白名单公共知识 → 模型只组织语言；
未配置 `AGENT_LLM_*` 时用规则回答（`degraded: true`），功能完整。
Web 门户目前只交付拼单垂直切片与管理后台占位。
Web 的模块交付状态以 `apps/web/src/domain/models/delivery.ts` 为**唯一真相**
（宫格角标与模块说明页都由它驱动，别在组件里另写一份判断）。本地启动、数据库与真实联调方式见 `docs/local-development.md`。

提交前请确保以下命令全绿：

```bash
npm run typecheck -w @kedaya/api && npm run test -w @kedaya/api && npm run lint -w @kedaya/api
npm run typecheck -w @kedaya/miniapp && npm run test -w @kedaya/miniapp && npm run lint -w @kedaya/miniapp
npm run build:weapp && npm run verify:weapp -w @kedaya/miniapp
npm run typecheck -w @kedaya/web && npm run test -w @kedaya/web && npm run lint -w @kedaya/web
```
