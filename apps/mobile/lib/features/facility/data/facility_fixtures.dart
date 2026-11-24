/// 场馆预约的演示数据（只存在于 feature 内，不经过网络）。
///
/// 六个场馆是产品要求的固定集合；预置预约有两个作用：
///   1. 列表页能显示「今日剩余 N 段」不是永远 14；
///   2. 详情页能看到「已约满」的时段真的置灰。
library;

import '../../../domain/models/facility_booking.dart';
import '../../../domain/models/facility_venue.dart';

const List<FacilityVenue> facilityDemoVenues = <FacilityVenue>[
  FacilityVenue(
    id: 'badminton',
    name: '羽毛球馆',
    location: '体育中心 1F',
    description: '四片标准场地，木质地板；请自备球拍与羽毛球。',
  ),
  FacilityVenue(
    id: 'basketball',
    name: '篮球场',
    location: '东区篮球场',
    description: '室外全场两片，雨天不开放；晚间有照明。',
  ),
  FacilityVenue(
    id: 'gym',
    name: '健身房',
    location: '体育中心 2F',
    description: '有氧与力量器械区，需穿运动鞋入场。',
  ),
  FacilityVenue(
    id: 'study-room',
    name: '自习室',
    location: '图书馆 3F',
    description: '静音自习区，单人单桌，插座充足。',
  ),
  FacilityVenue(
    id: 'discussion-room',
    name: '讨论室',
    location: '信息学院 2-201',
    description: '带白板与投屏，适合小组讨论；请控制音量。',
  ),
  FacilityVenue(
    id: 'piano-room',
    name: '琴房',
    location: '艺术中心 B1',
    description: '立式钢琴两间，隔音练习；请勿带饮料入内。',
  ),
];

/// 生成相对 [now] 的演示预约。
///
/// 固定使用「今天 / 明天 / 后天」而不是绝对日期：无论哪天打开，
/// 列表里都有今天的数据，不会变成一份过期快照。
List<FacilityBooking> facilityDemoBookings(DateTime now) {
  final DateTime today = facilityDateOnly(now);
  final DateTime tomorrow = DateTime(today.year, today.month, today.day + 1);
  final DateTime dayAfter = DateTime(today.year, today.month, today.day + 2);

  FacilityBooking make({
    required String venueId,
    required DateTime date,
    required int startHour,
    required int partySize,
    bool isMine = false,
    FacilityBookingStatus status = FacilityBookingStatus.booked,
    String? note,
    String owner = 'peer',
  }) =>
      FacilityBooking(
        id: 'demo-$venueId-${facilityDateKey(date)}-$startHour-$owner',
        venueId: venueId,
        date: date,
        slot: facilitySlots[startHour - facilityFirstSlotHour],
        partySize: partySize,
        status: status,
        isMine: isMine,
        createdAt: now,
        note: note,
      );

  return <FacilityBooking>[
    // 我的预约：两条有效 + 一条已取消（用于展示状态与「取消后释放」）。
    make(
      venueId: 'badminton',
      date: today,
      startHour: 18,
      partySize: 4,
      isMine: true,
      owner: 'mine',
      note: '带了两副拍',
    ),
    make(
      venueId: 'gym',
      date: tomorrow,
      startHour: 10,
      partySize: 2,
      isMine: true,
      owner: 'mine',
    ),
    make(
      venueId: 'study-room',
      date: tomorrow,
      startHour: 9,
      partySize: 1,
      isMine: true,
      owner: 'mine-cancelled',
      status: FacilityBookingStatus.cancelled,
      note: '临时有课，取消了',
    ),

    // 别人的预约：让今天的剩余时段数真实地少于 14。
    make(venueId: 'badminton', date: today, startHour: 20, partySize: 2),
    make(venueId: 'basketball', date: today, startHour: 18, partySize: 6),
    make(venueId: 'basketball', date: today, startHour: 20, partySize: 4),
    make(venueId: 'gym', date: today, startHour: 19, partySize: 1),
    make(venueId: 'study-room', date: today, startHour: 14, partySize: 1),
    make(venueId: 'discussion-room', date: today, startHour: 16, partySize: 5),
    make(venueId: 'piano-room', date: today, startHour: 21, partySize: 1),

    make(venueId: 'badminton', date: tomorrow, startHour: 19, partySize: 2),
    make(venueId: 'basketball', date: tomorrow, startHour: 20, partySize: 4),
    make(
        venueId: 'discussion-room',
        date: tomorrow,
        startHour: 14,
        partySize: 3),
    make(venueId: 'piano-room', date: tomorrow, startHour: 20, partySize: 1),

    make(venueId: 'basketball', date: dayAfter, startHour: 19, partySize: 4),
    make(venueId: 'gym', date: dayAfter, startHour: 18, partySize: 2),
  ];
}
