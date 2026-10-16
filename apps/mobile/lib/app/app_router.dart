import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/faq/presentation/pages/faq_home_page.dart';
import '../features/faq/presentation/pages/faq_tickets_page.dart';
import '../features/forum/presentation/pages/forum_board_page.dart';
import '../features/forum/presentation/pages/forum_compose_page.dart';
import '../features/forum/presentation/pages/forum_post_detail_page.dart';
import '../features/groupbuy/presentation/pages/groupbuy_detail_page.dart';
import '../features/groupbuy/presentation/pages/groupbuy_list_page.dart';
import '../presentation/components/kedaya_shell.dart';
import '../presentation/pages/home_page.dart';
import '../presentation/pages/module_detail_page.dart';
import '../presentation/pages/modules_page.dart';
import '../presentation/pages/not_found_page.dart';
import '../presentation/pages/profile_page.dart';

/// 根导航器 key（顶层路由——例如拼单详情——会盖住底部导航）。
final GlobalKey<NavigatorState> kedaYaRootNavigatorKey = GlobalKey<NavigatorState>(
  debugLabel: 'kedaya-root',
);

/// 应用路由（契约 §7：`app/` 负责路由注册；每个 feature 有独立路由段）。
///
/// 结构：
///   - `StatefulShellRoute` 承载底部导航三个分支：`/home` `/modules` `/profile`
///   - `/groupbuy` 与 `/groupbuy/:id`：拼单垂直切片（全屏，盖住底部导航）
///   - `/forum`、`/forum/compose`、`/forum/:id`：论坛（列表 / 发帖 / 主题详情）
///   - `/faq`、`/faq/tickets`：常见问题（分类+搜索+手风琴 / 我的工单）
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
      path: '/forum',
      name: 'forum',
      builder: (BuildContext context, GoRouterState state) => const ForumBoardPage(),
      routes: <RouteBase>[
        // ⚠️ `compose` 必须声明在 `:id` **之前**，否则 `/forum/compose`
        // 会被 `:id` 吃掉（go_router 同级路由按声明顺序匹配）。
        GoRoute(
          path: 'compose',
          name: 'forum-compose',
          builder: (BuildContext context, GoRouterState state) => const ForumComposePage(),
        ),
        GoRoute(
          path: ':id',
          name: 'forum-post',
          builder: (BuildContext context, GoRouterState state) =>
              ForumPostDetailPage(postId: state.pathParameters['id'] ?? ''),
        ),
      ],
    ),
    GoRoute(
      path: '/faq',
      name: 'faq',
      builder: (BuildContext context, GoRouterState state) => const FaqHomePage(),
      routes: <RouteBase>[
        GoRoute(
          path: 'tickets',
          name: 'faq-tickets',
          builder: (BuildContext context, GoRouterState state) => const FaqTicketsPage(),
        ),
      ],
    ),
    GoRoute(
      path: '/module/:moduleId',
      name: 'module-detail',
      builder: (BuildContext context, GoRouterState state) =>
          ModuleDetailPage(moduleId: state.pathParameters['moduleId'] ?? ''),
    ),
  ],
  errorBuilder: (BuildContext context, GoRouterState state) =>
      NotFoundPage(location: state.uri.toString()),
);
