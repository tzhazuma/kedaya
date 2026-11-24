# `wellbeing`（心理支持）

契约模块 id：`wellbeing`；敏感级 **critical**；`requiresConsent: true`。
本目录只实现「倾听与预约」，**不做诊断、不做治疗、不做量表评分**，也不做分享与举报。

## 页面与路由

| 页面 | 类 | 建议路由 |
| --- | --- | --- |
| 心理支持首页 | `WellbeingPage` | `/wellbeing` |
| 预约一次谈话 | `WellbeingBookingPage` | `/wellbeing/booking` |

路由定义在 `presentation/wellbeing_routes.dart` 的 `buildWellbeingRoutes()`。
当前任务边界不允许修改 `lib/app/app_router.dart`，装配时需要：

```dart
import '../features/wellbeing/presentation/wellbeing_routes.dart';

// createAppRouter(...) 的 routes 里：
...buildWellbeingRoutes(),
```

同时需要在 `presentation/pages/module_detail_page.dart` 的
`implementedModuleRoutes` 增加 `'wellbeing': '/wellbeing'`（该文件不在本模块可改范围内）。

## 红线落点

1. **首屏热线卡**：`WellbeingPage` 的第一个 child 是 `WellbeingCrisisCard`；
   卡片只使用 `domain/wellbeing_crisis.dart` 的编译期常量，不读 provider、不发请求，
   所以数据失败、本机记录损坏、同意门未通过时都照样显示。
   号码是占位 `021-XXXXXXXX`，并注明「上线前必须逐个拨通核实」。
2. **只做倾听与预约**：页面没有量表、评分、风险等级、诊断或治疗字段；
   预约状态只有 `WellbeingBookingStatus.submittedDemo`（「已提交（演示）」）。
3. **二次同意门**：`WellbeingConsentGate` 在 `build` 里先 `await` 同意状态，
   未同意时用 `builder` 延迟构建内容，`wellbeingBookingsProvider` 也不会读仓库。
   同意门文案明确「数据只存本机、随时可删」。
4. **本机数据**：`LocalWellbeingBookingsRepository` 只经 `LocalCachePort`
   读写 `wellbeing.bookings.v1`；不保存手机号/微信号/QQ 号，联系方式只有
   `contactAllowed` 布尔值。
5. **清空**：`清空我的记录` + `撤回同意并清空`；删除永远可行，不要求当前仍同意。
6. **不分享、不举报**：本目录没有 `SharePort` / 举报入口 / 外链。

## 文件

```
application/wellbeing_providers.dart      # 同意门 + 本机预约控制器
data/wellbeing_bookings_repository.dart   # 本机仓库（LocalCachePort）
domain/wellbeing_crisis.dart              # 热线兜底常量
presentation/components/                  # 热线卡 / 同意门 / 预约卡
presentation/pages/                       # WellbeingPage / WellbeingBookingPage
presentation/wellbeing_routes.dart        # GoRoute 工厂
```

领域模型：`lib/domain/models/wellbeing_booking.dart`。
测试：`test/wellbeing_test.dart`。

## 两个实现说明

- **为什么另建 `WellbeingBooking`**：现有 `WellbeingAppointment` 是远端排班模型
  （`requested` / `confirmed` / `completed`），本机演示不能伪造这些状态；
  本模块只写本机缓存，不调用 `WellbeingPort` 的远端预约，因此不会把演示记录
  写成真实预约。
- **为什么 feature 内有 `data/`**：顶层 `lib/data/` 不在本次可改范围；
  这里的 repository 只经 `LocalCachePort` 读写本机，不发任何网络请求。
- 顶层 `lib/features/README.md` 与 `apps/mobile/README.md` 的模块状态表
  仍把本模块列为未实现；它们不在本次可改范围，需要在集成时更新。

