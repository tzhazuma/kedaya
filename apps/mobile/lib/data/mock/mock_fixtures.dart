import '../../domain/models/errand_task.dart';
import '../../domain/models/groupbuy_order.dart';
import '../../domain/models/lost_found_item.dart';
import '../../domain/models/user.dart';
import '../../domain/models/wellbeing_appointment.dart';

/// mock 数据的固定时间基准。
///
/// 刻意用常量而非 `DateTime.now()`：同一份 fixture 在测试与 UI 里表现一致，
/// 相对时间文案（"3 小时前"）也可复现。
final DateTime mockNow = DateTime.utc(2026, 10, 16, 12);

/// mock 用户（第一级身份层，不含任何校园系统凭据）。
const User mockUser = User(
  userId: 'u-1001',
  studentId: '20240001',
  displayName: '可达鸭测试账号',
  department: '信息学院',
  email: 'test@shanghaitech.edu.cn',
);

/// 5 条拼单，覆盖 recruiting / locked / completed / cancelled 四种状态。
final List<GroupbuyOrder> mockGroupbuyOrders = <GroupbuyOrder>[
  GroupbuyOrder(
    id: 'gb-1001',
    title: '一食堂麻辣香锅拼单',
    description: '满 5 份起送，楼下自取，先到先得。',
    unitPriceFen: 2800,
    targetQuantity: 5,
    joinedQuantity: 3,
    status: GroupbuyStatus.recruiting,
    initiatorId: 'u-2001',
    initiatorName: '鸭鸭一号',
    pickupLocation: '一食堂二楼',
    deadline: mockNow.add(const Duration(hours: 6)),
    createdAt: mockNow.subtract(const Duration(hours: 2)),
    updatedAt: mockNow.subtract(const Duration(minutes: 30)),
    imageUrls: const <String>[],
  ),
  GroupbuyOrder(
    id: 'gb-1002',
    title: '咖啡券拼单（10 张起）',
    description: '校内咖啡店买十送一，均摊后每张便宜 1.8 元。',
    unitPriceFen: 1800,
    targetQuantity: 10,
    joinedQuantity: 7,
    status: GroupbuyStatus.recruiting,
    initiatorId: 'u-2002',
    initiatorName: '咖啡因驱动',
    pickupLocation: '咖啡厅',
    deadline: mockNow.add(const Duration(days: 1)),
    createdAt: mockNow.subtract(const Duration(hours: 5)),
    updatedAt: mockNow.subtract(const Duration(hours: 1)),
  ),
  GroupbuyOrder(
    id: 'gb-1003',
    title: '宿舍水果拼箱（赣南脐橙）',
    description: '一箱 20 斤，按份均摊，已锁定等待到货。',
    unitPriceFen: 4500,
    targetQuantity: 4,
    joinedQuantity: 4,
    status: GroupbuyStatus.locked,
    initiatorId: 'u-2003',
    initiatorName: '橙子星人',
    pickupLocation: '5 号宿舍楼下',
    deadline: mockNow.subtract(const Duration(hours: 3)),
    createdAt: mockNow.subtract(const Duration(days: 1, hours: 4)),
    updatedAt: mockNow.subtract(const Duration(hours: 3)),
  ),
  GroupbuyOrder(
    id: 'gb-1004',
    title: '羽毛球场地拼单（周末场）',
    description: '已成团，费用已结清。',
    unitPriceFen: 2000,
    targetQuantity: 6,
    joinedQuantity: 6,
    status: GroupbuyStatus.completed,
    initiatorId: 'u-2004',
    initiatorName: '扣杀选手',
    pickupLocation: '体育馆前台',
    deadline: mockNow.subtract(const Duration(days: 2)),
    createdAt: mockNow.subtract(const Duration(days: 4)),
    updatedAt: mockNow.subtract(const Duration(days: 2)),
  ),
  GroupbuyOrder(
    id: 'gb-1005',
    title: '打印纸拼单（已取消）',
    description: '发起人临时取消。',
    unitPriceFen: 1500,
    targetQuantity: 8,
    joinedQuantity: 2,
    status: GroupbuyStatus.cancelled,
    initiatorId: 'u-2005',
    initiatorName: '论文中',
    pickupLocation: '实验楼 A 座',
    createdAt: mockNow.subtract(const Duration(days: 3)),
    updatedAt: mockNow.subtract(const Duration(days: 2, hours: 20)),
  ),
];

/// 3 条跑腿任务。
final List<ErrandTask> mockErrandTasks = <ErrandTask>[
  ErrandTask(
    id: 'er-2001',
    title: '帮取 3 号快递柜的快递',
    rewardFen: 500,
    status: ErrandStatus.open,
    createdAt: mockNow.subtract(const Duration(minutes: 40)),
    note: '两个小包裹，取件码私聊发。',
    pickupAddress: '3 号快递柜',
    deliveryAddress: '6 号宿舍楼 302',
    requesterId: 'u-3001',
    deadline: mockNow.add(const Duration(hours: 8)),
  ),
  ErrandTask(
    id: 'er-2002',
    title: '二食堂带一份番茄鸡蛋盖饭',
    rewardFen: 300,
    status: ErrandStatus.accepted,
    createdAt: mockNow.subtract(const Duration(hours: 2)),
    pickupAddress: '二食堂一楼',
    deliveryAddress: '图书馆 4 楼研讨间',
    requesterId: 'u-3002',
    runnerId: 'u-2001',
  ),
  ErrandTask(
    id: 'er-2003',
    title: '打印店取装订好的论文',
    rewardFen: 800,
    status: ErrandStatus.completed,
    createdAt: mockNow.subtract(const Duration(days: 1)),
    pickupAddress: '教学中心打印店',
    deliveryAddress: '信息学院 5 楼',
    requesterId: 'u-3003',
    runnerId: 'u-2003',
  ),
];

/// 3 条失物招领。
final List<LostFoundItem> mockLostFoundItems = <LostFoundItem>[
  LostFoundItem(
    id: 'lf-3001',
    kind: LostFoundKind.lost,
    title: '丢失一张校园卡（姓名首字母 L）',
    status: LostFoundStatus.open,
    createdAt: mockNow.subtract(const Duration(hours: 3)),
    description: '昨晚在体育馆附近丢失。',
    location: '体育馆 — 一食堂一带',
    occurredAt: mockNow.subtract(const Duration(hours: 14)),
    contact: '微信：lost-card-demo',
  ),
  LostFoundItem(
    id: 'lf-3002',
    kind: LostFoundKind.found,
    title: '拾获黑色无线耳机盒',
    status: LostFoundStatus.open,
    createdAt: mockNow.subtract(const Duration(hours: 8)),
    description: '图书馆 3 楼 A 区座位捡到。',
    location: '图书馆 3 楼',
    occurredAt: mockNow.subtract(const Duration(hours: 9)),
  ),
  LostFoundItem(
    id: 'lf-3003',
    kind: LostFoundKind.found,
    title: '拾获一把宿舍钥匙（已归还）',
    status: LostFoundStatus.closed,
    createdAt: mockNow.subtract(const Duration(days: 2)),
    location: '5 号宿舍楼门口',
    occurredAt: mockNow.subtract(const Duration(days: 2, hours: 1)),
  ),
];

/// 2 条心理预约（敏感级 critical 的示例数据，仅用于本地 mock）。
final List<WellbeingAppointment> mockWellbeingAppointments =
    <WellbeingAppointment>[
  WellbeingAppointment(
    id: 'wb-4001',
    counselorName: '示例咨询师 A',
    startsAt: mockNow.add(const Duration(days: 2)),
    endsAt: mockNow.add(const Duration(days: 2, hours: 1)),
    status: WellbeingStatus.confirmed,
    createdAt: mockNow.subtract(const Duration(days: 1)),
    mode: WellbeingMode.inPerson,
    location: '学生服务中心 2 楼咨询室',
  ),
  WellbeingAppointment(
    id: 'wb-4002',
    counselorName: '示例咨询师 B',
    startsAt: mockNow.add(const Duration(days: 5)),
    endsAt: mockNow.add(const Duration(days: 5, hours: 1)),
    status: WellbeingStatus.requested,
    createdAt: mockNow.subtract(const Duration(hours: 6)),
    mode: WellbeingMode.online,
  ),
];
