import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/buddy/presentation/pages/buddy_board_page.dart';
import '../features/buddy/presentation/pages/buddy_compose_page.dart';
import '../features/buddy/presentation/pages/buddy_post_detail_page.dart';
import '../features/buddy/presentation/pages/buddy_privacy_page.dart';
import '../features/buddy/presentation/pages/buddy_profile_page.dart';
import '../features/buddy/presentation/pages/buddy_recommend_page.dart';
import '../features/faq/presentation/pages/faq_home_page.dart';
import '../features/faq/presentation/pages/faq_tickets_page.dart';
import '../features/forum/presentation/pages/forum_board_page.dart';
import '../features/forum/presentation/pages/forum_compose_page.dart';
import '../features/forum/presentation/pages/forum_post_detail_page.dart';
import '../features/groupbuy/presentation/pages/groupbuy_detail_page.dart';
import '../features/groupbuy/presentation/pages/groupbuy_list_page.dart';
import '../features/techpie/presentation/pages/campus_card_page.dart';
import '../features/techpie/presentation/pages/techpie_bindings_page.dart';
import '../features/techpie/presentation/pages/techpie_capabilities_page.dart';
import '../features/techpie/presentation/pages/techpie_home_page.dart';
import '../features/techpie/presentation/pages/techpie_webview_page.dart';
import '../features/wildlife/presentation/pages/wildlife_map_page.dart';
import '../features/wildlife/presentation/pages/wildlife_report_page.dart';
import '../features/wildlife/presentation/pages/wildlife_sighting_detail_page.dart';
import '../features/wildlife/presentation/pages/wildlife_sightings_page.dart';
import '../features/wildlife/presentation/pages/wildlife_track_detail_page.dart';
import '../features/wildlife/presentation/pages/wildlife_tracks_page.dart';
import '../features/wildlife/presentation/pages/wildlife_zone_detail_page.dart';
import '../features/wildlife/presentation/pages/wildlife_zones_page.dart';
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
///   - `/buddy`（三板块分栏列表）、`/buddy/compose`、`/buddy/recommend`、
///     `/buddy/profile`、`/buddy/privacy`、`/buddy/:id`：找搭子切片
///   - `/forum`、`/forum/compose`、`/forum/:id`：论坛（列表 / 发帖 / 主题详情）
///   - `/faq`、`/faq/tickets`：常见问题（分类+搜索+手风琴 / 我的工单）
///   - `/wildlife`（地图）、`/wildlife/report`（上报）、`/wildlife/sightings[/:id]`、
///     `/wildlife/zones[/:id]`、`/wildlife/tracks[/:id]`：校园动物切片
///   - `/techpie`（入口）、`/techpie/bindings`（绑定管理）、
///     `/techpie/capabilities`（能力清单）、`/techpie/webview`（校园系统直连）：
///     TechPie 整合 Phase 0
///   - `/campus-card`：校园卡（**独立 OPENID 通道**，与校园会话代持解耦）
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
      path: '/buddy',
      name: 'buddy',
      builder: (BuildContext context, GoRouterState state) => const BuddyBoardPage(),
      routes: <RouteBase>[
        // ⚠️ 静态段必须声明在 `:id` **之前**，否则 `/buddy/compose`
        // 会被 `:id` 吃掉（go_router 同级路由按声明顺序匹配）。
        GoRoute(
          path: 'compose',
          name: 'buddy-compose',
          builder: (BuildContext context, GoRouterState state) => const BuddyComposePage(),
        ),
        GoRoute(
          path: 'recommend',
          name: 'buddy-recommend',
          builder: (BuildContext context, GoRouterState state) =>
              const BuddyRecommendPage(),
        ),
        GoRoute(
          path: 'profile',
          name: 'buddy-profile',
          builder: (BuildContext context, GoRouterState state) =>
              const BuddyProfilePage(),
        ),
        GoRoute(
          path: 'privacy',
          name: 'buddy-privacy',
          builder: (BuildContext context, GoRouterState state) =>
              const BuddyPrivacyPage(),
        ),
        GoRoute(
          path: ':id',
          name: 'buddy-post',
          builder: (BuildContext context, GoRouterState state) =>
              BuddyPostDetailPage(postId: state.pathParameters['id'] ?? ''),
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
      path: '/wildlife',
      name: 'wildlife',
      builder: (BuildContext context, GoRouterState state) => const WildlifeMapPage(),
      routes: <RouteBase>[
        // 静态段（report / sightings / zones / tracks）与各自的 `:id` 分开声明，
        // 同级不冲突；这里仍然把**静态段放在前面**，与 `/forum/compose` 的
        // 处理保持一致（go_router 同级按声明顺序匹配）。
        GoRoute(
          path: 'report',
          name: 'wildlife-report',
          builder: (BuildContext context, GoRouterState state) => const WildlifeReportPage(),
        ),
        GoRoute(
          path: 'sightings',
          name: 'wildlife-sightings',
          builder: (BuildContext context, GoRouterState state) =>
              const WildlifeSightingsPage(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'wildlife-sighting',
              builder: (BuildContext context, GoRouterState state) =>
                  WildlifeSightingDetailPage(sightingId: state.pathParameters['id'] ?? ''),
            ),
          ],
        ),
        GoRoute(
          path: 'zones',
          name: 'wildlife-zones',
          builder: (BuildContext context, GoRouterState state) => const WildlifeZonesPage(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'wildlife-zone',
              builder: (BuildContext context, GoRouterState state) =>
                  WildlifeZoneDetailPage(zoneId: state.pathParameters['id'] ?? ''),
            ),
          ],
        ),
        GoRoute(
          path: 'tracks',
          name: 'wildlife-tracks',
          builder: (BuildContext context, GoRouterState state) => const WildlifeTracksPage(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'wildlife-track',
              builder: (BuildContext context, GoRouterState state) =>
                  WildlifeTrackDetailPage(trackId: state.pathParameters['id'] ?? ''),
            ),
          ],
        ),
      ],
    ),
    GoRoute(
      path: '/techpie',
      name: 'techpie',
      builder: (BuildContext context, GoRouterState state) => const TechpieHomePage(),
      routes: <RouteBase>[
        // 三个静态子段；本模块没有 `:id` 路由，因此不存在"静态段被 :id 吃掉"的问题。
        GoRoute(
          path: 'bindings',
          name: 'techpie-bindings',
          builder: (BuildContext context, GoRouterState state) =>
              const TechpieBindingsPage(),
        ),
        GoRoute(
          path: 'capabilities',
          name: 'techpie-capabilities',
          builder: (BuildContext context, GoRouterState state) =>
              const TechpieCapabilitiesPage(),
        ),
        GoRoute(
          path: 'webview',
          name: 'techpie-webview',
          builder: (BuildContext context, GoRouterState state) =>
              const TechpieWebViewPage(),
        ),
      ],
    ),
    GoRoute(
      path: '/campus-card',
      name: 'campus-card',
      builder: (BuildContext context, GoRouterState state) => const CampusCardPage(),
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
