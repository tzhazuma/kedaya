import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'pages/petition_compose_page.dart';
import 'pages/petition_detail_page.dart';
import 'pages/petition_page.dart';
import 'petition_paths.dart';

/// 本模块的路由注册表。
///
/// `lib/app/app_router.dart` 里只需把 [buildPetitionRoutes] 展开进根 `routes`，
/// 静态段 `new` 必须排在 `:id` 之前（go_router 同级按声明顺序匹配）。
List<RouteBase> buildPetitionRoutes() => <RouteBase>[
      GoRoute(
        path: PetitionRoutes.list,
        name: 'petition',
        builder: (BuildContext context, GoRouterState state) =>
            const PetitionPage(),
        routes: <RouteBase>[
          // ⚠️ 静态段必须在 `:id` 之前，否则 `/petition/new` 会被当成详情 id。
          GoRoute(
            path: 'new',
            name: 'petition-new',
            builder: (BuildContext context, GoRouterState state) =>
                const PetitionComposePage(),
          ),
          GoRoute(
            path: ':id',
            name: 'petition-detail',
            builder: (BuildContext context, GoRouterState state) =>
                PetitionDetailPage(
              ticketId: state.pathParameters['id'] ?? '',
            ),
          ),
        ],
      ),
    ];
