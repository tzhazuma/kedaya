import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'presentation/pages/lost_found_compose_page.dart';
import 'presentation/pages/lost_found_detail_page.dart';
import 'presentation/pages/lost_found_page.dart';

/// 失物招领路由（供 `app/app_router.dart` 直接展开）。
abstract final class LostFoundRoutes {
  static const String list = '/lost-found';
  static const String compose = '/lost-found/new';
  static const String detailPattern = '/lost-found/:id';

  static String detail(String itemId) => '/lost-found/$itemId';
}

/// 路由树：`/lost-found`、`/lost-found/new`、`/lost-found/:id`。
///
/// 静态段 `new` 必须声明在 `:id` 之前（go_router 同级按声明顺序匹配）。
final List<RouteBase> lostFoundRoutes = <RouteBase>[
  GoRoute(
    path: LostFoundRoutes.list,
    name: 'lost-found',
    builder: (BuildContext context, GoRouterState state) =>
        const LostFoundPage(),
    routes: <RouteBase>[
      GoRoute(
        path: 'new',
        name: 'lost-found-new',
        builder: (BuildContext context, GoRouterState state) =>
            const LostFoundComposePage(),
      ),
      GoRoute(
        path: ':id',
        name: 'lost-found-detail',
        builder: (BuildContext context, GoRouterState state) =>
            LostFoundDetailPage(itemId: state.pathParameters['id'] ?? ''),
      ),
    ],
  ),
];
