import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/groupbuy/presentation/pages/groupbuy_detail_page.dart';
import '../features/groupbuy/presentation/pages/groupbuy_list_page.dart';
import '../presentation/components/kedaya_shell.dart';
import '../presentation/pages/home_page.dart';
import '../presentation/pages/module_detail_page.dart';
import '../presentation/pages/modules_page.dart';
import '../presentation/pages/not_found_page.dart';
import '../presentation/pages/profile_page.dart';

/// 根导航器 key（顶层路由——例如凑凑详情——会盖住底部导航）。
final GlobalKey<NavigatorState> kedaYaRootNavigatorKey = GlobalKey<NavigatorState>(
  debugLabel: 'kedaya-root',
);

/// 应用路由（契约 §7：`app/` 负责路由注册；每个 feature 有独立路由段）。
///
/// 结构：
///   - `StatefulShellRoute` 承载底部导航三个分支：`/home` `/modules` `/profile`
///   - `/groupbuy` 为凑凑入口，`/groupbuy/:id` 为拼单详情（全屏，盖住底部导航）
///   - `/module/:moduleId`：**注册表驱动**的模块落地页（未实现的模块在此如实说明）
GoRouter createAppRouter({String initialLocation = '/home'}) => GoRouter(
  navigatorKey: kedaYaRootNavigatorKey,
  initialLocation: initialLocation,
  routes: <RouteBase>[
    StatefulShellRoute.indexedStack(
      builder:
          (
            BuildContext context,
            GoRouterState state,
            StatefulNavigationShell navigationShell,
          ) => KedaYaShell(navigationShell: navigationShell),
      branches: <StatefulShellBranch>[
        StatefulShellBranch(
          routes: <RouteBase>[
            GoRoute(
              path: '/home',
              name: 'home',
              builder: (BuildContext context, GoRouterState state) => const HomePage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: <RouteBase>[
            GoRoute(
              path: '/modules',
              name: 'modules',
              builder: (BuildContext context, GoRouterState state) => const ModulesPage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: <RouteBase>[
            GoRoute(
              path: '/profile',
              name: 'profile',
              builder: (BuildContext context, GoRouterState state) => const ProfilePage(),
            ),
          ],
        ),
      ],
    ),
    GoRoute(
      path: '/groupbuy',
      name: 'groupbuy',
      builder: (BuildContext context, GoRouterState state) => const GroupbuyListPage(),
      routes: <RouteBase>[
        GoRoute(
          path: ':id',
          name: 'groupbuy-detail',
          builder: (BuildContext context, GoRouterState state) =>
              GroupbuyDetailPage(orderId: state.pathParameters['id'] ?? ''),
        ),
      ],
    ),
    GoRoute(
      path: '/module/:moduleId',
      name: 'module-detail',
      redirect: (BuildContext context, GoRouterState state) {
        final String? moduleId = state.pathParameters['moduleId'];
        return moduleId == 'groupbuy' || moduleId == 'buddy' ? '/groupbuy' : null;
      },
      builder: (BuildContext context, GoRouterState state) =>
          ModuleDetailPage(moduleId: state.pathParameters['moduleId'] ?? ''),
    ),
  ],
  errorBuilder: (BuildContext context, GoRouterState state) =>
      NotFoundPage(location: state.uri.toString()),
);
