# feature: `canteen`（营养管家）

契约 §4 的 `canteen`（敏感级：**低**，**无同意门**）。本端把模块做成
「营养管家」：看今日汇总 → 按食堂/品类找菜 → 记一餐 → 回到汇总。
**不接后端**，记录只写本机缓存。

> 营养值全部是**演示估算，非实验室数据**；四个页面都会显示这句话。
> 文案只使用「估算 / 参考」，不写「营养师建议」「医疗建议」。

---

## 1. 页面与路由

| 页面类 | 路由 | 作用 |
| --- | --- | --- |
| `CanteenHomePage` | `/canteen` | 今日汇总（5 项 vs 目标）、钠上限提醒、3 条缺口参考、三个入口 |
| `CanteenDishesPage` | `/canteen/dishes` | 食堂 chips + 品类 chips + 菜名搜索（三者叠加） |
| `MealComposePage` | `/canteen/meal` | 选餐次 → 搜索/筛选 → 加入并调份数 → 底部实时合计 → 保存 |
| `MealRecordsPage` | `/canteen/records` | 按餐次分组；删除单个菜品或整条记录，汇总自动重算 |

路由常量与路由段在 `canteen_routes.dart`。路径只在这一处声明，页面用
`CanteenRoutes.*` 跳转。

## 2. 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 领域模型 | `lib/domain/models/canteen_dish.dart` | 7 食堂 / 6 品类 / 4 类过敏原；`NutritionFacts`（先乘份数再四舍五入）；`CanteenDish` |
| 领域模型 | `lib/domain/models/meal_record.dart` | `MealSlot` / `MealEntry`（每份快照）/ `MealRecord`（合计）/ 空餐次校验 / 本机 JSON |
| 规则 | `features/canteen/domain/canteen_rules.dart` | 叠加筛选、每日目标、今日汇总、缺口建议（纯函数，无 IO） |
| 演示数据 | `features/canteen/domain/canteen_seed.dart` | 25 道菜，7 个食堂与 6 个品类全覆盖；9 道高钠菜覆盖上限场景 |
| 本机存储 | `features/canteen/application/canteen_meal_store.dart` | `LocalCachePort` 实现读写；单条损坏跳过；最多 200 条 |
| 状态 | `features/canteen/application/canteen_providers.dart` | 菜品库、可注入时钟、目标、记录控制器、今日汇总、建议 |
| 组件 | `features/canteen/presentation/components/` | 数据来源提示 / 菜品行 / 搜索与筛选 / 今日汇总卡 |

依赖方向：页面 → provider → 规则 + 模型；provider 只通过 `LocalCachePort`
读写，**不直接访问网络**，也没有新增端口（本模块没有写服务端的需求）。

## 3. 规则（都有单测）

1. **份数合计**：每份营养 × 份数，先放大再 `round()`；条目合计相加得到餐次
   合计，所以页面上的行数字相加一定等于总计。
2. **筛选叠加**：食堂、品类、关键词（空格分隔的多个词全部命中）同时成立。
   关键词只匹配菜名，忽略大小写。
3. **每日目标**：2000 kcal / 60 g 蛋白 / 60 g 脂肪 / 250 g 碳水；
   **钠是上限 2000 mg**，不参与「缺口」。
4. **缺口建议**：最多 3 条；只在有缺口时给。钠已超上限时，
   `sodiumMg >= 600` 的高钠菜品被**硬过滤**（不是排序偏好）。
5. **保存校验**：空餐次、份数 ≤ 0 都拒绝；页面与控制器共用
   `validateMealDraft`，不会出现「按钮禁用但控制器放行」。
6. **删除**：删单个菜品后若该餐为空，整条记录一起消失；首页汇总 provider
   自动重算，不做本地数字拼接。

## 4. 本机存储与文案边界

- 键：`canteen.meal-records.v1`；结构版本变化时升级键名。
- 保存成功提示固定写明「记录保存在本机，未上传」——没有服务端回执就不说
  「已同步」。
- 「今日」由 `canteenClockProvider` 决定；单测注入固定时刻。
- 记录会同时包含历史日期，但「今日记录」页只展示今天；本机保留最近
  200 条，卸载或清理应用数据会丢失。
- ⚠️ `AppRuntime.mock` 使用的是 `InMemoryCacheStore`，记录只在本次运行内保留；
  只有真实运行时（`PreferencesCacheStore`）才会跨重启保留。页面文案只说
  「保存在本机 / 未上传」，不承诺跨重启。

## 5. 父级装配（本次未改，受改动边界限制）

需要在 `lib/app/app_router.dart` 中：

```dart
import '../features/canteen/canteen_routes.dart';
// routes: <RouteBase>[ ... 既有路由, ...canteenRoutes ],
```

并在 `lib/presentation/pages/module_detail_page.dart` 的
`implementedModuleRoutes` 中加：

```dart
'canteen': '/canteen',
```

同一文件的「实现状态」`switch (module.id)` 还需要补一个 `canteen` 分支，
否则按钮能进模块、说明文字却仍是「尚未实现」：

```dart
'canteen' => '本模块已实现：营养管家（今日汇总 / 按食堂看菜品 / 记一餐 / '
    '今日记录），菜品营养值为演示估算；记录只保存在本机，不接后端。',
```

完成后 `/module/canteen` 会进入营养管家首页，不再是「尚未实现」。

## 6. 本模块**不做**的事

- 不做拍照识别、不做菜品写入/管理后台（服务端无端点，本端不伪造）。
- 不做个性化目标设置与历史趋势（目标固定为演示默认值）。
- 不按过敏原硬过滤菜品，只在行内提示「含什么」；严重忌口需现场确认。
- 不提供「营养师建议」「医疗建议」类判断，也不把估算值写成检测值。

## 7. 测试

`apps/mobile/test/canteen_test.dart`：份数四舍五入与合计、三条件叠加筛选、
钠超标时建议不含高钠菜、删除记录后汇总更新、空餐次/非法份数不能保存、
本机缓存重开可读回。
