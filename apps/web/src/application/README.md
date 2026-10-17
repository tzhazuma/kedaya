# application —— 用例层

契约 §7：编排逻辑，**不含 IO**。仓储由调用方（`app/` 或 presentation 的 hook）注入。

## 拼单（groupbuy）

| 用例 | 输入 | 输出 |
| --- | --- | --- |
| `loadGroupBuyList` | `GroupBuyRepository` + `GroupBuyListQuery` | `Result<GroupBuyListVM, ApiError>` |
| `loadGroupBuyDetail` | `GroupBuyRepository` + `id` | `Result<GroupBuyDetailVM, ApiError>` |
| `joinGroupBuy` | `GroupBuyRepository` + `id` + `quantity` | `Result<GroupBuyDetailVM, ApiError>` |

**视图模型约定**：金额在这里转成 `¥12.34` 文案、时间转成「还有 3 小时」，
UI 组件只负责渲染，不再做任何业务计算（便于单测，无需 jsdom）。

## 管理后台（admin）

| 用例 | 说明 |
| --- | --- |
| `loadAdminDashboard` | 并发拉取模块开关 + 审计日志，产出 `AdminDashboardVM` |

审计 VM 保留 `traceId` 与脱敏后的主体 id，满足契约 §9 的「谁、何时、对哪条记录、什么动作」。
