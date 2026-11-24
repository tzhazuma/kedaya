# feature: `flea-market`（二手跳蚤市场）

校内二手闲置的发布 / 浏览 / 搜索 / 下架，**本机内存演示数据**，不接后端。

一句话：同学把宿舍里用不上的东西挂出来（标题、价格、成色、分类、地点），
其他人按分类或关键词找到它，复制一段联系文案，当面交易。

---

## 1. 产品约束怎么落地

| 约束 | 落地 |
| --- | --- |
| 价格只允许整数或一位小数 | `parseFleaPriceFen`（`^\d+(\.\d)?$`），非法输入不会被四舍五入；内部存**整数分** |
| 价格必须大于 0、标题不能为空 | `validateFleaDraft`；仓库写入前再跑一遍，绕过表单也写不进非法条目 |
| 分类筛选 / 搜索 / 排序规则只能有一份 | `visibleFleaListings`（范围 → 分类 → 关键词 → 排序），页面不复制 |
| 下架后不能出现在「全部」 | `visibleFleaListings` 的 `browse` 范围只取 `active`；`mine` 范围取 `isMine`（含已下架） |
| 不留手机号、不内建聊天 | 模型里没有手机号 / 聊天字段；联系靠 `buildFleaContactText` 生成可粘贴文本 |
| 演示数据必须诚实标注 | 种子由 `buildSeedFleaListings(now)` 生成；列表页底部固定「演示数据 · 仅本机保存」 |

## 2. 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| domain 模型 | `lib/domain/models/flea_listing.dart` | 枚举、`FleaListing`、`FleaDraft`、`parseFleaPriceFen` / `formatFleaPrice` / `validateFleaDraft` / `visibleFleaListings` / `buildFleaContactText` |
| application | `lib/features/flea_market/application/flea_market_repository.dart` | 内存仓库 + 演示种子（时间相对 `now`） |
| application | `lib/features/flea_market/application/flea_market_providers.dart` | `fleaMarketClockProvider` / `fleaMarketRepositoryProvider` / `fleaMarketListingsProvider` |
| presentation | `.../presentation/pages/flea_market_page.dart` | 列表（全部 / 我的、搜索、分类 chips、排序菜单、下架 / 重新上架） |
| presentation | `.../presentation/pages/flea_compose_page.dart` | 发布表单 |
| presentation | `.../presentation/pages/flea_detail_page.dart` | 详情、复制联系文案、下架 / 重新上架 |
| presentation | `.../presentation/components/flea_listing_card.dart` | 列表卡片 |
| presentation | `.../presentation/components/flea_tags.dart` | 文字徽章（分类 / 成色 / 我的 / 已下架） |

## 3. 路由（需要 app 层接线）

本 feature 只提供页面，**路由注册不在本目录**（`lib/app/app_router.dart` 与
`lib/presentation/pages/module_detail_page.dart` 归 app / presentation 层维护）。
需要两处改动：

1. `lib/app/app_router.dart` 增加：

```dart
GoRoute(
  path: '/flea-market',
  name: 'flea-market',
  builder: (BuildContext context, GoRouterState state) =>
      const FleaMarketPage(),
  routes: <RouteBase>[
    // 静态段必须声明在 `:id` 之前（go_router 同级按声明顺序匹配）。
    GoRoute(
      path: 'new',
      name: 'flea-market-new',
      builder: (BuildContext context, GoRouterState state) =>
          const FleaComposePage(),
    ),
    GoRoute(
      path: ':id',
      name: 'flea-market-detail',
      builder: (BuildContext context, GoRouterState state) =>
          FleaDetailPage(listingId: state.pathParameters['id'] ?? ''),
    ),
  ],
)
```

2. `implementedModuleRoutes` 增加 `'flea-market': '/flea-market'`，
   `/module/flea-market` 才会从「尚未实现」跳到真实入口。

## 4. 数据与状态

- `fleaMarketRepositoryProvider` 在 provider 体内直接 new，**不经过 `AppRuntime`**；
  进程退出数据即消失（演示）。
- 「现在」来自 `fleaMarketClockProvider`，种子时间与相对时间都基于它，测试可固定。
- 发布 / 下架后由 `FleaMarketListingsController` 把仓库快照推回 `state`，
  页面不本地拼接状态。

## 5. 测试

`test/flea_market_test.dart`：分类筛选、搜索（标题 / 描述 / 地点 / 大小写）、
价格排序、发布校验（标题空、价格为 0 / 非法 / 两位小数、描述 301 字）、
下架后从「全部」消失且仍在「我的」、Riverpod 状态层联动。

## 6. 未做

- 后端端点、跨设备同步、本机持久化：当前只有内存演示数据。
- 议价 / 站内聊天 / 图片：不在本切片内，模型里也没有对应字段。
- 举报与信用体系：演示版不涉及。
