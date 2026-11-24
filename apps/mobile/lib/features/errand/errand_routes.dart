import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'presentation/pages/errand_compose_page.dart';
import 'presentation/pages/errand_detail_page.dart';
import 'presentation/pages/errand_page.dart';

/// 跑腿路由（供 `app/app_router.dart` 直接展开）。
abstract final class ErrandRoutes {
  static const String list = '/errand';
  static const String compose = '/errand/new';
  static const String detailPattern = '/errand/:id';

  static String detail(String taskId) => '/errand/$taskId';
}

/// 路由树：`/errand`、`/errand/new`、`/errand/:id`。
///
/// 静态段 `new` 必须声明在 `:id` 之前（go_router 同级按声明顺序匹配）。
final List<RouteBase> errandRoutes = <RouteBase>[
  GoRoute(
    path: ErrandRoutes.list,
    name: 'errand',
    builder: (BuildContext context, GoRouterState state) => const ErrandPage(),
    routes: <RouteBase>[
      GoRoute(
        path: 'new',
        name: 'errand-new',
        builder: (BuildContext context, GoRouterState state) =>
            const ErrandComposePage(),
      ),
      GoRoute(
        path: ':id',
        name: 'errand-detail',
        builder: (BuildContext context, GoRouterState state) =>
            ErrandDetailPage(taskId: state.pathParameters['id'] ?? ''),
      ),
    ],
  ),
];
