import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'presentation/pages/takeout_compose_page.dart';
import 'presentation/pages/takeout_guard_page.dart';

/// 偷外卖报备路由（供 `app/app_router.dart` 直接展开）。
abstract final class TakeoutGuardRoutes {
  static const String list = '/takeout-guard';
  static const String compose = '/takeout-guard/new';
}

/// 路由树：`/takeout-guard`、`/takeout-guard/new`。
final List<RouteBase> takeoutGuardRoutes = <RouteBase>[
  GoRoute(
    path: TakeoutGuardRoutes.list,
    name: 'takeout-guard',
    builder: (BuildContext context, GoRouterState state) =>
        const TakeoutGuardPage(),
    routes: <RouteBase>[
      GoRoute(
        path: 'new',
        name: 'takeout-guard-new',
        builder: (BuildContext context, GoRouterState state) =>
            const TakeoutComposePage(),
      ),
    ],
  ),
];
