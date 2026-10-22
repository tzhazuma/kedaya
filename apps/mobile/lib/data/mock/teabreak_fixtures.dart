library;

import '../../domain/models/teabreak.dart';

/// `teabreak` 的演示数据（契约 §7 硬规则 4：无后端可跑）。
///
/// ## 为什么是**函数**而不是常量
///
/// 茶歇的卖点是「**现在**还有」，写死绝对日期的演示数据过几天就会全部变成
/// `over` —— 那时候页面看起来像坏了，而其实是数据老了。因此这里只接受一个
/// `now`，**所有时刻都由它加减出来**：
///
/// | 条目 | 相对 `now` | 时效 |
/// | --- | --- | --- |
/// | `tb-1001` | 茶歇窗 `now-15m … now+15m`，5 分钟前有人确认 | `fresh` |
/// | `tb-1002` | 茶歇窗 `now-2h30m … now+30m`，2 小时没确认 | `stale` |
/// | `tb-1003` | 下一个 15:00 的下午场（茶歇 15:30–16:00） | `notStarted` |
/// | `tb-1004` | 昨天 14:00–14:30 的茶歇 | `over` |
///
/// 三种 [TeabreakAccess]（`open` / `registered` / `unknown`）各至少出现一次。
///
/// ⚠️ `tb-1003` 用「下一个 15:00」而不是 `now + 2h`：只有这样它**永远是下午场**，
/// 无论用户是早上八点还是晚上十一点打开 demo。
/// 发布者显示名（mock 用户，见 `mock_fixtures.dart` 的 `mockUser`）。
///
/// 不直接 import `mock_fixtures.dart`：那个文件拖着拼单 / 失物 / 心理预约的
/// fixture，本模块没有理由跟着它们一起加载。
const String mockTeabreakPosterName = '可达鸭测试账号';

/// 生成**相对 [now]** 的 4 条演示茶歇。
List<Teabreak> buildMockTeabreaks(DateTime now) {
  final DateTime afternoon = nextTeabreakAfternoon(now);
  return <Teabreak>[
    // ① fresh：正在发茶歇，5 分钟前刚有人确认。
    Teabreak(
      id: 'tb-1001',
      conferenceName: '第七届信息科学前沿论坛',
      venue: '信息学院 1-101',
      conferenceStartsAt: now.subtract(const Duration(hours: 3)),
      conferenceEndsAt: now.add(const Duration(hours: 3)),
      teaStartsAt: now.subtract(const Duration(minutes: 15)),
      teaEndsAt: now.add(const Duration(minutes: 15)),
      access: TeabreakAccess.open,
      postedBy: '信息学院 2023 级博士生',
      createdAt: now.subtract(const Duration(hours: 4)),
      confirms: <TeabreakConfirm>[
        TeabreakConfirm(
          confirmId: 'tbc-9001',
          confirmedAt: now.subtract(const Duration(minutes: 5)),
        ),
      ],
      note: '有咖啡、可颂和橙汁，在二楼走廊尽头。',
    ),
    // ② stale：还在时间窗内，但已经 2 小时没人确认了。
    Teabreak(
      id: 'tb-1002',
      conferenceName: '物质科学前沿研讨会',
      venue: '物质学院 3-201',
      conferenceStartsAt: now.subtract(const Duration(hours: 5)),
      conferenceEndsAt: now.add(const Duration(hours: 1)),
      teaStartsAt: now.subtract(const Duration(minutes: 150)),
      teaEndsAt: now.add(const Duration(minutes: 30)),
      access: TeabreakAccess.registered,
      postedBy: '路过的一只鸭',
      createdAt: now.subtract(const Duration(hours: 6)),
      confirms: <TeabreakConfirm>[
        TeabreakConfirm(
          confirmId: 'tbc-9002',
          confirmedAt: now.subtract(const Duration(hours: 2)),
        ),
      ],
    ),
    // ③ notStarted：下午的会，茶歇还没开始（也还没人确认）。
    Teabreak(
      id: 'tb-1003',
      conferenceName: '人工智能与教育创新论坛',
      venue: '教学中心 2-305',
      conferenceStartsAt: afternoon.subtract(const Duration(hours: 2)),
      conferenceEndsAt: afternoon.add(const Duration(hours: 2)),
      teaStartsAt: afternoon.add(const Duration(minutes: 30)),
      teaEndsAt: afternoon.add(const Duration(hours: 1)),
      access: TeabreakAccess.unknown,
      postedBy: '教务办门口的海报',
      createdAt: now.subtract(const Duration(minutes: 20)),
    ),
    // ④ over：昨天就已经结束了 —— 留着是为了让「已结束」这个状态可见。
    Teabreak(
      id: 'tb-1004',
      conferenceName: '生命科学青年学者论坛',
      venue: '生命学院 4-102',
      conferenceStartsAt: now.subtract(const Duration(hours: 26)),
      conferenceEndsAt: now.subtract(const Duration(hours: 18)),
      teaStartsAt: now.subtract(const Duration(hours: 23)),
      teaEndsAt: now.subtract(const Duration(hours: 22, minutes: 30)),
      access: TeabreakAccess.open,
      postedBy: '生院茶歇侦察兵',
      createdAt: now.subtract(const Duration(days: 1, hours: 5)),
      confirms: <TeabreakConfirm>[
        TeabreakConfirm(
          confirmId: 'tbc-9003',
          confirmedAt: now.subtract(const Duration(hours: 23)),
        ),
      ],
      note: '昨天的会，点心早就没了。',
    ),
  ];
}

/// 「下一个 15:00」——今天 15:00 还没到就取今天，否则取明天。
///
/// 注意：`now` 可能是 UTC（测试里常这么传），而「下午三点」是**本地**时区的
/// 概念，所以先转本地再构造，返回后再交给调用方按同一时刻比较。
DateTime nextTeabreakAfternoon(DateTime now) {
  final DateTime local = now.isUtc ? now.toLocal() : now;
  DateTime at = DateTime(local.year, local.month, local.day, 15);
  if (!at.isAfter(now)) {
    at = DateTime(local.year, local.month, local.day + 1, 15);
  }
  return at;
}
