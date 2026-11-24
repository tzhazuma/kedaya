import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'presentation/pages/canteen_dishes_page.dart';
import 'presentation/pages/canteen_home_page.dart';
import 'presentation/pages/meal_compose_page.dart';
import 'presentation/pages/meal_records_page.dart';

/// 营养管家的路由名与路径。
///
/// 路径是四个页面的**唯一**来源：页面里的跳转、测试和父级装配都引用这里。
abstract final class CanteenRoutes {
  static const String home = '/canteen';
  static const String dishes = '/canteen/dishes';
  static const String mealCompose = '/canteen/meal';
  static const String records = '/canteen/records';
}

/// 供 `app_router.dart` 展开的路由段。
///
/// 受本次改动边界限制，`lib/app/app_router.dart` 与
/// `lib/presentation/pages/module_detail_page.dart` 未在本模块内修改；
/// 装配方式见 README §5。
final List<RouteBase> canteenRoutes = <RouteBase>[
  GoRoute(
    path: CanteenRoutes.home,
    name: 'canteen',
    builder: (BuildContext context, GoRouterState state) =>
        const CanteenHomePage(),
    routes: <RouteBase>[
      GoRoute(
        path: 'dishes',
        name: 'canteen-dishes',
        builder: (BuildContext context, GoRouterState state) =>
            const CanteenDishesPage(),
      ),
      GoRoute(
        path: 'meal',
        name: 'canteen-meal',
        builder: (BuildContext context, GoRouterState state) =>
            const MealComposePage(),
      ),
      GoRoute(
        path: 'records',
        name: 'canteen-records',
        builder: (BuildContext context, GoRouterState state) =>
            const MealRecordsPage(),
      ),
    ],
  ),
];
