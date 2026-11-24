import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'pages/wellbeing_booking_page.dart';
import 'pages/wellbeing_page.dart';

/// 心理支持路由段。
///
/// ⚠️ 当前任务边界不允许修改 `lib/app/app_router.dart`，因此这里提供
/// **可直接展开**的路由工厂；装配时在 `createAppRouter` 的 `routes` 列表里
/// 加一行 `...buildWellbeingRoutes()` 即可。
///
/// 子路由 `booking` 必须与 `/wellbeing` 一起注册，
/// `WellbeingPage` 的「预约一次谈话」按钮会 push `/wellbeing/booking`。
List<RouteBase> buildWellbeingRoutes() => <RouteBase>[
      GoRoute(
        path: '/wellbeing',
        name: 'wellbeing',
        builder: (BuildContext context, GoRouterState state) =>
            const WellbeingPage(),
        routes: <RouteBase>[
          GoRoute(
            path: 'booking',
            name: 'wellbeing-booking',
            builder: (BuildContext context, GoRouterState state) =>
                const WellbeingBookingPage(),
          ),
        ],
      ),
    ];
