/// `facility` 的路由表。
///
/// 本文件**不修改** `lib/app/app_router.dart`（本次任务的边界只到 feature）。
/// 接入时在 `createAppRouter` 的 `routes` 里展开：
///
/// ```dart
/// ...facilityRoutes(),
/// ```
///
/// 路由：
///   - `/facility`              场馆列表
///   - `/facility/bookings`     我的预约（静态段必须在 `:id` 之前）
///   - `/facility/:id`          场馆详情
///   - `/facility/:id/book`     确认预约（`?date=YYYY-MM-DD&slot=8`）
library;

import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import '../../domain/models/facility_booking.dart';
import '../../domain/models/facility_venue.dart';
import 'presentation/pages/facility_booking_page.dart';
import 'presentation/pages/facility_page.dart';
import 'presentation/pages/facility_venue_page.dart';
import 'presentation/pages/my_facility_bookings_page.dart';

/// 供 `app_router.dart` 展开的路由列表。
List<RouteBase> facilityRoutes() => <RouteBase>[
      GoRoute(
        path: '/facility',
        name: 'facility',
        builder: (BuildContext context, GoRouterState state) =>
            const FacilityPage(),
        routes: <RouteBase>[
          // 静态段必须声明在 `:id` **之前**（go_router 同级按声明顺序匹配）。
          GoRoute(
            path: 'bookings',
            name: 'facility-bookings',
            builder: (BuildContext context, GoRouterState state) =>
                const MyFacilityBookingsPage(),
          ),
          GoRoute(
            path: ':id',
            name: 'facility-venue',
            builder: (BuildContext context, GoRouterState state) =>
                FacilityVenuePage(
              venueId: state.pathParameters['id'] ?? '',
            ),
            routes: <RouteBase>[
              GoRoute(
                path: 'book',
                name: 'facility-booking',
                // 缺少日期 / 时段时回到场馆详情，而不是默认约今天第一段。
                redirect: (BuildContext context, GoRouterState state) {
                  final String venueId = state.pathParameters['id'] ?? '';
                  if (_bookingDate(state) == null ||
                      _bookingSlot(state) == null) {
                    return '/facility/$venueId';
                  }
                  return null;
                },
                builder: (BuildContext context, GoRouterState state) =>
                    FacilityBookingPage(
                  venueId: state.pathParameters['id'] ?? '',
                  date: _bookingDate(state) ?? facilityDateOnly(DateTime.now()),
                  slot: _bookingSlot(state) ?? facilitySlots.first,
                ),
              ),
            ],
          ),
        ],
      ),
    ];

DateTime? _bookingDate(GoRouterState state) {
  final String? raw = state.uri.queryParameters['date'];
  if (raw == null) return null;
  return DateTime.tryParse(raw);
}

FacilitySlot? _bookingSlot(GoRouterState state) {
  final String? raw = state.uri.queryParameters['slot'];
  if (raw == null) return null;
  final int? hour = int.tryParse(raw);
  if (hour == null) return null;
  return facilitySlotByStartHour(hour);
}
