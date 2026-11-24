# feature: `campus-map`（校园地点）

契约 §4 的第 22 个核心模块（`campus-map`，敏感级：**低**，**无同意门**）。

一句话：一个可筛选的**校园地点目录** —— 按分类和关键词找到楼栋、楼层、开放时间，
并复制位置或坐标。**它不是地图**：没有底图、没有定位、没有路线规划。

## 1. 为什么是「目录」而不是「地图」

App 没有地图 SDK 依赖，也没有校方授权的地图底图。与其画一张假地图，不如把
「去哪儿、几层、几点开、走几分钟到校门」这些**文字信息**做扎实：

| 约束 | 落地 |
| --- | --- |
| 不引入地图 / `url_launcher` 依赖 | 页面内不打开任何外部 App；两个按钮都只写剪贴板 |
| 坐标只是演示值 | 列表页顶部与详情页都写明「未接入腾讯/高德 SDK，当前是地点目录；坐标仅演示」，并注明开放时间与步行分钟数同样是演示值 |
| 用户要知道「点了会发生什么」 | 「在地图中打开」的提示固定为「已复制坐标，可粘贴到地图 App」，按钮下方另有一句说明 |
| 搜索不能越界 | 只匹配名称、别名、楼栋；简介与开放时间不参与，避免搜「打印」把整篇简介都捞出来 |

## 2. 分层与文件

| 层 | 文件 | 说明 |
| --- | --- | --- |
| domain 模型 | `lib/domain/models/campus_place.dart` | `CampusPlaceCategory` / `CampusPlace`；纯函数 `filterCampusPlaces` / `campusPlaceById` / `normalizeCampusPlaceQuery`；复制文案 `locationCopyText` / `coordinatesCopyText` |
| 种子数据 | `lib/features/campus_map/data/campus_place_seed.dart` | 17 个地点（教学 / 餐饮 / 运动 / 服务 / 宿舍），坐标为演示值 |
| application | `lib/features/campus_map/application/campus_map_providers.dart` | `CampusMapFilter` + 筛选 notifier，以及目录 / 筛选结果 / 按 id 查询三个读取 provider |
| presentation | `.../presentation/pages/campus_map_page.dart` | `CampusMapPage`：说明卡 + 搜索 + 分类 chip + 列表 + 空态 |
| presentation | `.../presentation/pages/campus_place_detail_page.dart` | `CampusPlaceDetailPage`：完整信息 + 简介 + 演示坐标 + 两个复制按钮 |
| presentation | `.../presentation/components/campus_place_widgets.dart` | 说明卡 / 分类标签 / 信息行 / 列表卡片 |
| 路由常量 | `lib/features/campus_map/campus_map_routes.dart` | `CampusMapRoutes.list` / `detail(id)` |

**没有模块自己的 port，也没有 `data/` 适配器**：本模块只有编译期种子数据，不发网络请求。
`campusPlacesProvider` 是同步 `Provider`，页面因此不需要 loading / error 三态。
将来接真实数据时把它换成 `FutureProvider` 即可，筛选逻辑与页面不变。
复制能力复用 `lib/app/app_providers.dart` 的 `shareProvider`（装配为
`ClipboardSharePort`），没有为本模块新增平台代码。

## 3. providers

| provider | 类型 | 用途 |
| --- | --- | --- |
| `campusMapFilterProvider` | `NotifierProvider<CampusMapFilterNotifier, CampusMapFilter>` | 分类（`null` = 全部）+ 关键词；`selectCategory` / `setQuery` / `clear` |
| `campusPlacesProvider` | `Provider<List<CampusPlace>>` | 编译期种子目录 |
| `filteredCampusPlacesProvider` | `Provider<List<CampusPlace>>` | 分类与关键词**叠加**后的列表 |
| `campusPlaceByIdProvider` | `Provider.family<CampusPlace?, String>` | 详情页按 id 读取；找不到返回 `null` |

## 4. 路由（需要 `app/` 接线）

页面类已就绪，但路由注册在 `lib/app/app_router.dart`（不在本 feature 的修改范围）。
先加 import（`app_router.dart` 用的是相对路径）：

```dart
import '../features/campus_map/campus_map_routes.dart';
import '../features/campus_map/presentation/pages/campus_map_page.dart';
import '../features/campus_map/presentation/pages/campus_place_detail_page.dart';
```

再把下面两段加到 `createAppRouter` 的 `routes` 里：

```dart
GoRoute(
  path: CampusMapRoutes.list,
  name: CampusMapRoutes.listName,
  builder: (BuildContext context, GoRouterState state) =>
      const CampusMapPage(),
  routes: <RouteBase>[
    GoRoute(
      path: ':id',
      name: CampusMapRoutes.detailName,
      builder: (BuildContext context, GoRouterState state) =>
          CampusPlaceDetailPage(
        placeId: state.pathParameters['id'] ?? '',
      ),
    ),
  ],
),
```

同时把模块落地页的入口登记上（`lib/presentation/pages/module_detail_page.dart`，
import `../../features/campus_map/campus_map_routes.dart`）：

```dart
const Map<String, String> implementedModuleRoutes = <String, String>{
  // ...
  CampusMapRoutes.moduleId: CampusMapRoutes.list,
};
```

在此之前，`/module/campus-map` 仍会显示「尚未实现」—— 这是**如实状态**，
不是本 feature 的 bug。

## 5. 演示数据

`campusPlaceSeed` 有 17 条，覆盖图书馆、信息 / 物质 / 生命学院、教学中心、
创业与管理学院、餐饮中心、西餐厅、咖啡厅、体育馆、田径场、行政中心、
一站式服务大厅、快递站、校医院、东西区宿舍。

名字与楼栋按校园常见叫法写，**坐标、步行分钟数、开放时间都是演示值**。
`test/campus_map_test.dart` 会校验条目数在 12–18、id 唯一、每个分类都有数据、
坐标落在张江校区的演示范围。

## 6. 测试

`apps/mobile/test/campus_map_test.dart`（纯单测，不依赖 widget / AppRuntime）：

- 分类筛选：全部 / 每个分类 / 分类与关键词叠加；
- 关键词：名称、别名（大小写不敏感）、楼栋号（`1号楼` ≡ `1 号楼`）、简介不参与；
- 空结果：无匹配、分类与关键词互斥、provider 组合与 `clear()`；
- 复制文案：位置描述 = 名称（楼栋 · 楼层）、坐标固定 6 位小数、地点之间不重复；
- 种子数据完整性。

## 7. 本模块**不做**的事

- 不接腾讯 / 高德 / OSM SDK，不显示底图，不做定位与路线规划；
- 不引入 `url_launcher`，「在地图中打开」只是复制坐标；
- 不做「实时拥挤度」「座位数」「菜单」——种子数据里没有可靠来源；
- 不做收藏 / 上报 / 编辑：没有后端端点，也没有本机持久化需求。
