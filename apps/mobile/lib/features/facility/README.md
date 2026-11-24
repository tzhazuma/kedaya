# `facility`（场馆预约）

演示用的校园场馆预约垂直切片。**数据全部在 feature 内内存里**，不经过
`domain/ports/`、不联网、不落盘；页面固定标注「演示数据：不会真的锁定场馆」。

## 页面

| 页面类 | 建议路由 | 说明 |
| --- | --- | --- |
| `FacilityPage` | `/facility` | 六个场馆 + 位置 / 开放时间 / 今日剩余时段数 |
| `FacilityVenuePage` | `/facility/:id` | 日期（今天 + 6 天）+ 14 个时段 chips；约满/已过置灰 |
| `FacilityBookingPage` | `/facility/:id/book?date=YYYY-MM-DD&slot=8` | 人数 1–10 + 可选备注，提交前复算冲突 |
| `MyFacilityBookingsPage` | `/facility/bookings` | 我的预约（已预约 / 已取消）+ 取消 |

路由表在 `facility_routes.dart`。本次改动边界不含 `lib/app/**` 与
`lib/presentation/**`，因此 **`/module/facility` 的「尚未实现」状态尚未切掉**；
接入时在 `createAppRouter` 的 `routes` 里展开 `...facilityRoutes()`，
并在 `module_detail_page.dart` 的 `implementedModuleRoutes` 增加
`'facility': '/facility'` 与对应的实现状态文案。

## 领域规则

`lib/domain/models/facility_venue.dart`

- 六个场馆（羽毛球馆 / 篮球场 / 健身房 / 自习室 / 讨论室 / 琴房）。
- 每天 `08:00-22:00`，`08:00-09:00` … `21:00-22:00` 共 14 个一小时时段。

`lib/domain/models/facility_booking.dart`

- `isFacilitySlotBooked`：同场馆 + 同日期 + 同时段，有**有效**预约即占用。
- `isFacilitySlotPast`：今天已经开始的时段不可选。
- `isFacilitySlotAvailable` = 未占用 且 未开始。
- `findFacilityBookingConflict`：冲突检测，**包含自己已约的**。
- 取消只把状态写成 `cancelled`，可用性计算忽略它 → 时段自动回到可选。
- `isValidFacilityPartySize` / `validateFacilityBookingDraft`：1–10 人、备注 ≤100 字。

## 数据与 Provider

- `data/facility_mock_repository.dart`：`FacilityMockRepository`，内存列表；
  `book()` 拒绝人数越界、备注过长、时段已过、同场馆同时段冲突；
  `cancel()` 只允许取消自己的预约，幂等。
- `data/facility_fixtures.dart`：六个场馆 + 相对「今天」生成的演示预约
  （含我的有效 / 已取消预约与别人的预约）。
- `application/facility_providers.dart`：
  - `facilityClockProvider`（`DateTime Function()`，可 override）
  - `facilityVenuesProvider`
  - `facilityVenueProvider(String)`
  - `facilityRepositoryProvider`
  - `facilityBookingsProvider`（`FacilityBookingsController`）
  - `facilityMyBookingsProvider`
  - `facilityVenueBookingsProvider(String)`

## 测试

`test/facility_test.dart`：时段数量与边界、可用性计算、同场馆同时段冲突
（含自己的重复预约）、取消后释放、跨日期/跨场馆互不影响、人数 1–10 边界。

## 未做

- 不接真实场馆系统、不锁场馆、不发通知；退出应用数据即清空。
- 无「核销 / 签到」、无候补队列、无跨天连续时段。
- 路由与模块落地页的接线（受本次改动边界限制，见上）。
