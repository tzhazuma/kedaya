import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'presentation/pages/dorm_compose_page.dart';
import 'presentation/pages/dorm_harmony_page.dart';
import 'presentation/pages/dorm_post_detail_page.dart';

/// 宿舍矛盾路由（供 `app/app_router.dart` 直接展开）。
abstract final class DormHarmonyRoutes {
  static const String list = '/dorm-harmony';
  static const String compose = '/dorm-harmony/new';
  static const String detailPattern = '/dorm-harmony/:id';

  static String detail(String postId) => '/dorm-harmony/$postId';
}

/// 路由树：`/dorm-harmony`、`/dorm-harmony/new`、`/dorm-harmony/:id`。
final List<RouteBase> dormHarmonyRoutes = <RouteBase>[
  GoRoute(
    path: DormHarmonyRoutes.list,
    name: 'dorm-harmony',
    builder: (BuildContext context, GoRouterState state) =>
        const DormHarmonyPage(),
    routes: <RouteBase>[
      GoRoute(
        path: 'new',
        name: 'dorm-harmony-new',
        builder: (BuildContext context, GoRouterState state) =>
            const DormComposePage(),
      ),
      GoRoute(
        path: ':id',
        name: 'dorm-harmony-detail',
        builder: (BuildContext context, GoRouterState state) =>
            DormPostDetailPage(postId: state.pathParameters['id'] ?? ''),
      ),
    ],
  ),
];
