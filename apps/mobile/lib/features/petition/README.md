# feature: `petition`（建议与诉求 · 本机演示）

契约 §4.1 的 `petition`（敏感级：**低**，**无同意门**）。本端落地的是
「向学校提一条建议 / 诉求，在本机留一份记录」，**不发送、不投递、不附议**。

> ⚠️ 与 `packages/contracts/src/petitions.ts` 的差异：冻结契约描述的是
> 「附议凑门槛 → 生成邮件给部门」。Flutter 端这次按产品要求实现的是更小的
> 本机记录形态，因此模型里没有金额、附议数、部门邮箱、阈值这些字段。
> 两者**不是**同一套状态机，接入后端前需要先对齐契约。

---

## 1. 三条产品约束

| 约束 | 落地 |
| --- | --- |
| 不假装已送达任何部门 | 三个页面都渲染 `PetitionDemoNotice`，固定文案「演示版：提交只保存在本机，不会发送给学校」；仓储只有 `LocalCachePort`，依赖图上没有网络出口 |
| 状态只能由真实处理方推进 | `PetitionTicket` 不存 `status` 字段，只存 `submittedAt` / `processingAt` / `repliedAt`；本机**没有**任何「模拟推进」按钮 |
| 匿名不是 UI 开关 | `PetitionTicket` 工厂在 `anonymous == true` 时直接丢弃 `contact`；即使页面忘了清空输入框，本机缓存里也不会留下联系方式 |

## 2. 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| domain 模型 | `lib/domain/models/petition_ticket.dart` | `PetitionCategory` / `PetitionStatus` / `PetitionTicket` / `PetitionDraft`；纯函数 `validatePetitionDraft` / `sortPetitionTickets` / `petitionTimeline` / `describePetitionProblem` |
| application 存储 | `.../application/petition_store.dart` | `PetitionStore` 接口 + `LocalPetitionStore`（`petition.tickets.v1`，最多 200 条，单条损坏只丢一条） |
| application | `.../application/petition_providers.dart` | `petitionTicketsProvider` / `petitionTicketProvider` / `petitionStoreProvider` / `petitionClockProvider` |
| presentation | `.../presentation/pages/petition_page.dart` | `PetitionPage`：固定提示 + 说明 + 倒序列表 + 空态 |
| presentation | `.../presentation/pages/petition_compose_page.dart` | `PetitionComposePage`：类别 / 标题 / 正文（实时字数）/ 匿名 / 可选联系方式 |
| presentation | `.../presentation/pages/petition_detail_page.dart` | `PetitionDetailPage`：正文 + 时间线 + 回复 + 撤回 |
| presentation | `.../presentation/components/petition_widgets.dart` | 提示条、状态徽章、类别标签、列表卡片、时间线、时间格式化 |
| routing | `.../presentation/petition_paths.dart` | `PetitionRoutes` 路径常量（页面只依赖这里，避免与注册表循环 import） |
| routing | `.../presentation/petition_routes.dart` | `buildPetitionRoutes()`：`lib/app/app_router.dart` 的接线点 |

## 3. Provider 与路由

- `petitionTicketsProvider`（`NotifierProvider<PetitionTicketsController, List<PetitionTicket>>`）：
  同步读本机、按 `submittedAt` 倒序；`submit(draft)` 先写盘再改内存，`withdraw(id)` 仅对
  `canWithdraw == true`（即「已提交」）生效。
- `petitionTicketProvider(String id)`：按 id 取一条，不存在返回 `null`。
- `petitionStoreProvider`：测试可直接 override，不必装配 `AppRuntime`。
- `petitionClockProvider`：提交时间与 id 的注入点。

路由：

| 路径 | 页面 |
| --- | --- |
| `/petition` | `PetitionPage` |
| `/petition/new` | `PetitionComposePage` |
| `/petition/:id` | `PetitionDetailPage` |

`buildPetitionRoutes()` 已把静态段 `new` 放在 `:id` 之前。接线时在
`lib/app/app_router.dart` 的 `routes` 里展开，并在
`lib/presentation/pages/module_detail_page.dart` 的 `implementedModuleRoutes`
加入 `'petition': '/petition'`（这两处不在本 feature 的改动范围内）。

## 4. 本模块**不做**的事

- 不发送邮件、不调用任何部门接口、不生成回执；
- 不模拟「处理中 / 已回复」：这两个状态只能由将来接入的处理方写入；
- 不做附议、阈值、公开列表、举报；
- 不做跨设备同步：换设备或清除数据后记录不存在。
