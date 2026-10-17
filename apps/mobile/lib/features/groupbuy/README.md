# feature: `groupbuy`（拼单）

契约 §4.1 的业务模块 `groupbuy`，也是本端**唯一跑通的垂直切片**：
它验证了 `presentation → application → domain ← data` 这条链路真的能跑通，
而不是只有目录结构。

## 该模块的 ports

| 端口 | 位置 | 说明 |
| --- | --- | --- |
| `GroupbuyPort` | `lib/domain/ports/groupbuy_port.dart` | 拼单的读/写用例入口 |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteGroupbuyRepository` | `lib/data/repositories/remote_groupbuy_repository.dart` | 走 `/api/v1/groupbuy/*` |
| `MockGroupbuyRepository` | `lib/data/mock/mock_groupbuy_repository.dart` | 内存实现，**默认装配**，无后端可跑 |

`GroupbuyPort` 的方法与契约 §6.1 的统一 CRUD 形状一一对应：

| 方法 | HTTP |
| --- | --- |
| `listOrders(GroupbuyQuery)` | `GET groupbuy/items`（游标分页） |
| `getOrder(id)` | `GET groupbuy/items/:id` |
| `createOrder(command)` | `POST groupbuy/items` |
| `joinOrder(id, quantity:)` | `POST groupbuy/items/:id/join` |
| `cancelOrder(id)` | `POST groupbuy/items/:id/cancel` |

## 该模块的用例（application 层）

| 用例 | 位置 |
| --- | --- |
| `groupbuyListControllerProvider` | `application/groupbuy_providers.dart`：首页加载 / 下拉刷新 / 翻页（翻页失败保留列表） |
| `groupbuyDetailProvider` | 同上：按 id 取详情（`FutureProvider.family`） |
| `groupbuyActionsProvider` | 同上：参团 / 取消，写成功后**失效读 provider**（不做本地状态拼接） |

## 该模块的模型

`GroupbuyOrder`、`GroupbuyQuery`、`CreateGroupbuyOrderCommand` 放在**顶层**
`lib/domain/models/groupbuy_order.dart` —— 因为 `GroupbuyPort` 的签名要用它们，
而端口是跨模块共享的（`data/` 与 `application/` 都要 import）。
金额一律整数分（`unitPriceFen`），展示时才用 `Money.fenToYuan`。

## 三态

`presentation/pages/groupbuy_list_page.dart` 用 `AsyncStateView` 统一渲染：

| 态 | 触发方式 |
| --- | --- |
| loading | 首帧 / 下拉刷新 |
| error | 上游故障（mock 下用右上角 🧪 菜单切换 `MockFailureMode.upstreamUnavailable`） |
| empty | 空结果（🧪 菜单切换 `controls.emptyResults = true`） |
| data | 正常 5 条 fixture |

详情页把 `NOT_FOUND` 映射为**空态**（"该拼单不存在或已下架"），其余错误走错误态。

## 已实现 / 未实现

- ✅ 列表（游标分页 + 加载更多）、详情、参团（含 busy 态与错误提示）、取消（port 层已实现，页面未接按钮）
- ✅ mock 与远端两套适配器，`AppRuntime` 按 `AppFlavor` 装配
- ❌ 发起拼单的表单页（`createOrder` 在 port 与 mock 里已实现并有测试，但没有 UI）
- ❌ 图片上传、支付结算、成团通知

## 测试

- `test/domain/groupbuy_order_test.dart` —— 模型解析/序列化、进度与剩余份数收敛
- `test/data/mock_groupbuy_repository_test.dart` —— 分页、参团累加与锁定、冲突/404/校验、故障注入
- `test/application/groupbuy_list_controller_test.dart` —— 三态、翻页失败保留列表、写操作后失效读 provider
