/// `buddy` 的 mock 数据（契约 §7 硬规则 4：必须有 mock adapter，无后端可跑）。
///
/// **为什么 fixtures 是「相对当前时间」生成的函数，而不是固定常量**
///
/// 组队活动的 `startsAt` 必须是**未来**（规格 §2.3：`startsAt` 必须晚于当前），
/// 而 `wildlife` / `forum` 那些固定时间基准的 fixtures 用在 `buddy` 上会让
/// 所有活动"一上线就全部过期"，列表页恒为空。
///
/// 因此本文件导出的是**以 `now` 为锚点**的生成函数：
///   - UI（默认时钟 = `DateTime.now`）永远能看到"即将开始的活动"；
///   - 测试传入固定 `now`，结果完全可复现。
library;

import '../../domain/models/buddy.dart';
import '../../domain/models/buddy_application.dart';
import '../../domain/models/buddy_profile.dart';
import 'mock_fixtures.dart';

/// 把「上海本地时间」转成 UTC 时刻（Asia/Shanghai = UTC+8，**无夏令时**）。
///
/// `dayAnchor` 只用来确定"哪一天"（按其上海本地日期），
/// `dayOffset` 在该日期上加减天数。
DateTime buddyShanghaiInstant(
  DateTime dayAnchor, {
  int dayOffset = 0,
  required int hour,
  int minute = 0,
}) {
  final DateTime local = dayAnchor.toUtc().add(buddyShanghaiUtcOffset);
  final DateTime localDate = DateTime.utc(local.year, local.month, local.day);
  return localDate
      .add(Duration(days: dayOffset, hours: hour, minutes: minute))
      .subtract(buddyShanghaiUtcOffset);
}

/// 当前登录用户 id（mock 里来自 `mockUser`；真实实现来自 JWT）。
String get buddyMockCurrentUserId => mockUser.userId;

/// 当前登录用户的展示名。
String get buddyMockCurrentUserName => mockUser.displayNameOrId;

/// 一批活动（覆盖三个板块 + 四种状态 + 我发的 + 已满）。
///
/// | id | 板块 | 状态 | 说明 |
/// | --- | --- | --- | --- |
/// | `bp-1001` | sport | OPEN | 羽毛球（与我高度匹配，用于推荐页） |
/// | `bp-1002` | academic | OPEN | 图书馆自习 |
/// | `bp-1003` | daily | OPEN | 二食堂吃饭 |
/// | `bp-1004` | sport | FULL | 篮球（**不出现在列表**，但可按 id 打开详情） |
/// | `bp-1005` | daily | OPEN | 拼车去机场（**我发的**） |
/// | `bp-1006` | sport | OPEN | 桌游（`game` → sport 板块；我已申请 → 不推荐） |
/// | `bp-1010` | sport | OPEN | 周四晚羽毛球（与我最匹配，推荐页首选） |
/// | `bp-1007` | academic | EXPIRED | 已过期（不出现在列表） |
/// | `bp-1008` | sport | CLOSED | 已关闭（不出现在列表） |
/// | `bp-1009` | daily | CANCELLED | 已取消（仅发起人可见） |
List<BuddyPost> mockBuddyPosts(DateTime now) => <BuddyPost>[
      BuddyPost(
        id: 'bp-1001',
        activity: BuddyActivity.sport,
        title: '周六下午羽毛球，缺 2 人',
        description: '体育馆 3 号场，打两小时，新手也行。',
        location: '体育馆 3 号场',
        startsAt: buddyShanghaiInstant(now, dayOffset: 2, hour: 14),
        durationMin: 120,
        capacity: 4,
        joinedCount: 2,
        genderPreference: BuddyGenderPreference.any,
        tags: const <String>['badminton', 'indoor'],
        minSkillLevel: BuddySkillLevel.beginner,
        creator: const BuddyCreator(id: 'u-2001', nickname: '鸭鸭一号'),
        status: BuddyPostStatus.open,
        createdAt: now.subtract(const Duration(hours: 3)),
      ),
      BuddyPost(
        id: 'bp-1002',
        activity: BuddyActivity.study,
        title: '图书馆四楼自习，一起卷',
        description: '晚上七点到十点，安静区，不聊天。',
        location: '图书馆',
        startsAt: buddyShanghaiInstant(now, dayOffset: 1, hour: 19),
        durationMin: 180,
        capacity: 3,
        joinedCount: 1,
        tags: const <String>['selfstudy', 'library'],
        creator: const BuddyCreator(id: 'u-2002', nickname: '论文中'),
        createdAt: now.subtract(const Duration(hours: 8)),
      ),
      BuddyPost(
        id: 'bp-1003',
        activity: BuddyActivity.meal,
        title: '二食堂麻辣香锅，四人桌',
        location: '二食堂',
        startsAt: buddyShanghaiInstant(now, dayOffset: 0, hour: 18),
        durationMin: 60,
        capacity: 5,
        joinedCount: 3,
        tags: const <String>['canteen', 'hotpot'],
        creator: const BuddyCreator(id: 'u-2003', nickname: '橙子星人'),
        createdAt: now.subtract(const Duration(hours: 12)),
      ),
      BuddyPost(
        id: 'bp-1004',
        activity: BuddyActivity.sport,
        title: '篮球 3v3（已满员）',
        location: '篮球场',
        startsAt: buddyShanghaiInstant(now, dayOffset: 3, hour: 16),
        durationMin: 90,
        capacity: 6,
        joinedCount: 6,
        tags: const <String>['basketball', 'outdoor'],
        minSkillLevel: BuddySkillLevel.regular,
        creator: const BuddyCreator(id: 'u-2002', nickname: '论文中'),
        status: BuddyPostStatus.full,
        createdAt: now.subtract(const Duration(days: 1)),
      ),
      BuddyPost(
        id: 'bp-1005',
        activity: BuddyActivity.travel,
        title: '周日拼车去浦东机场',
        description: '早上六点校门口出发，两人成行。',
        location: '校门口',
        startsAt: buddyShanghaiInstant(now, dayOffset: 4, hour: 6),
        durationMin: 90,
        capacity: 2,
        joinedCount: 1,
        tags: const <String>['carpool', 'airport'],
        creator: BuddyCreator(
            id: buddyMockCurrentUserId, nickname: buddyMockCurrentUserName),
        createdAt: now.subtract(const Duration(hours: 20)),
      ),
      BuddyPost(
        id: 'bp-1006',
        activity: BuddyActivity.game,
        title: '桌游局：阿瓦隆 6 人',
        location: '学生服务中心',
        startsAt: buddyShanghaiInstant(now, dayOffset: 2, hour: 19),
        durationMin: 180,
        capacity: 6,
        joinedCount: 1,
        tags: const <String>['boardgame', 'indoor'],
        creator: const BuddyCreator(id: 'u-2004', nickname: '扣杀选手'),
        createdAt: now.subtract(const Duration(hours: 30)),
      ),
      BuddyPost(
        id: 'bp-1010',
        activity: BuddyActivity.sport,
        title: '周四晚羽毛球，缺 3 人',
        description: '体育馆 2 号场，打两小时，欢迎新手。',
        location: '体育馆',
        startsAt: buddyShanghaiInstant(now, dayOffset: 5, hour: 19),
        durationMin: 120,
        capacity: 4,
        joinedCount: 1,
        tags: const <String>['badminton', 'indoor'],
        minSkillLevel: BuddySkillLevel.beginner,
        creator: const BuddyCreator(id: 'u-2001', nickname: '鸭鸭一号'),
        createdAt: now.subtract(const Duration(hours: 1)),
      ),
      BuddyPost(
        id: 'bp-1007',
        activity: BuddyActivity.study,
        title: '（已过期）周末编程结对',
        location: '信息科学与技术学院',
        startsAt: buddyShanghaiInstant(now, dayOffset: -2, hour: 10),
        durationMin: 120,
        capacity: 2,
        joinedCount: 1,
        tags: const <String>['coding'],
        creator: const BuddyCreator(id: 'u-2002', nickname: '论文中'),
        status: BuddyPostStatus.expired,
        createdAt: now.subtract(const Duration(days: 5)),
      ),
      BuddyPost(
        id: 'bp-1008',
        activity: BuddyActivity.sport,
        title: '（已关闭）夜跑',
        location: '田径场',
        startsAt: buddyShanghaiInstant(now, dayOffset: 1, hour: 21),
        durationMin: 60,
        capacity: 4,
        joinedCount: 2,
        tags: const <String>['running', 'outdoor'],
        creator: const BuddyCreator(id: 'u-2003', nickname: '橙子星人'),
        status: BuddyPostStatus.closed,
        createdAt: now.subtract(const Duration(days: 2)),
      ),
      BuddyPost(
        id: 'bp-1009',
        activity: BuddyActivity.meal,
        title: '（已取消）咖啡搭子',
        location: '图书馆一楼咖啡角',
        startsAt: buddyShanghaiInstant(now, dayOffset: 1, hour: 15),
        durationMin: 60,
        capacity: 2,
        joinedCount: 1,
        tags: const <String>['coffee'],
        creator: const BuddyCreator(id: 'u-2004', nickname: '扣杀选手'),
        status: BuddyPostStatus.cancelled,
        createdAt: now.subtract(const Duration(days: 3)),
      ),
    ];

/// 当前用户的匹配资料。
///
/// `matchEnabled` **默认 `false`**（规格 §6.3「默认不参与」）——
/// 于是推荐页开箱即走"未开启匹配"的诚实路径（`matchMode: rule` +
/// 「按时间排序」），用户必须**显式**打开开关才会进入推荐池。
BuddyProfile mockBuddyProfile() => BuddyProfile(
      userId: buddyMockCurrentUserId,
      sections: const <BuddySection>[BuddySection.sport, BuddySection.academic],
      interestTags: const <String>['coding', 'badminton', 'movie'],
      activityTags: const <String>['badminton', 'selfstudy', 'coffee'],
      skillLevel: BuddySkillLevel.casual,
      availability: const <AvailabilitySlot>[
        AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
        AvailabilitySlot(dow: 2, startMin: 19 * 60, endMin: 22 * 60),
        AvailabilitySlot(dow: 3, startMin: 19 * 60, endMin: 22 * 60),
        AvailabilitySlot(dow: 4, startMin: 19 * 60, endMin: 22 * 60),
        AvailabilitySlot(dow: 5, startMin: 19 * 60, endMin: 22 * 60),
        AvailabilitySlot(dow: 6, startMin: 9 * 60, endMin: 12 * 60),
        AvailabilitySlot(dow: 6, startMin: 14 * 60, endMin: 19 * 60),
        AvailabilitySlot(dow: 0, startMin: 9 * 60, endMin: 12 * 60),
        AvailabilitySlot(dow: 0, startMin: 14 * 60, endMin: 21 * 60),
      ],
      preferredAreas: const <String>['图书馆', '体育馆'],
      department: mockUser.department,
      bio: '常泡图书馆，羽毛球随便打打。',
      matchEnabled: false,
    );

/// 各发起人的匹配资料。
///
/// **mock 扮演服务端**：真实的 `ruleScoreFor` 需要「发起人的匹配资料」作为入参
/// （规格 §3.3 的签名 `ruleScoreFor(section, me, post, creatorProfile)`），
/// 而这份资料**永远不会下发给客户端**（规格 §6.1：`BuddyProfile` 对任何人不可见）。
/// mock 里它只存在于内存中、只用于算分，不经过任何响应模型 —— 这正是真实架构的形状。
Map<String, BuddyProfile> mockBuddyCreatorProfiles() => <String, BuddyProfile>{
      'u-2001': const BuddyProfile(
        userId: 'u-2001',
        sections: <BuddySection>[BuddySection.sport],
        interestTags: <String>['badminton', 'coding', 'music'],
        activityTags: <String>['badminton', 'fitness'],
        skillLevel: BuddySkillLevel.casual,
        preferredAreas: <String>['体育馆', '图书馆'],
        department: '信息科学与技术学院',
        matchEnabled: true,
      ),
      'u-2002': const BuddyProfile(
        userId: 'u-2002',
        sections: <BuddySection>[BuddySection.academic, BuddySection.sport],
        interestTags: <String>['coding', 'reading', 'movie'],
        activityTags: <String>['selfstudy', 'library'],
        skillLevel: BuddySkillLevel.regular,
        preferredAreas: <String>['图书馆'],
        department: '信息科学与技术学院',
        matchEnabled: true,
      ),
      'u-2003': const BuddyProfile(
        userId: 'u-2003',
        sections: <BuddySection>[BuddySection.daily],
        interestTags: <String>['hotpot', 'movie', 'music'],
        activityTags: <String>['canteen', 'hotpot'],
        skillLevel: BuddySkillLevel.beginner,
        preferredAreas: <String>['二食堂', '一食堂'],
        department: '生命科学与技术学院',
        matchEnabled: true,
      ),
      'u-2004': const BuddyProfile(
        userId: 'u-2004',
        sections: <BuddySection>[BuddySection.sport, BuddySection.daily],
        interestTags: <String>['gaming', 'boardgame', 'anime'],
        activityTags: <String>['gaming', 'boardgame'],
        skillLevel: BuddySkillLevel.competitive,
        preferredAreas: <String>['学生服务中心'],
        department: '创业与管理学院',
        matchEnabled: true,
      ),
    };

/// 几条已经存在的申请（用于「审批」页开箱即有内容）。
List<BuddyApplication> mockBuddyApplications(DateTime now) =>
    <BuddyApplication>[
      // 别人申请我发的「拼车去机场」——发起人视角的待审批项。
      BuddyApplication(
        id: 'ba-2001',
        postId: 'bp-1005',
        applicantId: 'u-2003',
        applicantName: '橙子星人',
        message: '我也赶早班机，一起？',
        status: BuddyApplicationStatus.pending,
        createdAt: now.subtract(const Duration(hours: 5)),
      ),
      // 我申请别人的羽毛球局 —— 已接受（可见性：只有发起人与我本人能看到）。
      BuddyApplication(
        id: 'ba-2002',
        postId: 'bp-1001',
        applicantId: buddyMockCurrentUserId,
        applicantName: buddyMockCurrentUserName,
        message: '我也常打，一起？',
        status: BuddyApplicationStatus.accepted,
        createdAt: now.subtract(const Duration(hours: 6)),
        decidedAt: now.subtract(const Duration(hours: 4)),
        decidedBy: 'u-2001',
      ),
      // 我申请别人的桌游局 —— 待审批（用于验证硬过滤 F4：已申请的不再推荐）。
      BuddyApplication(
        id: 'ba-2003',
        postId: 'bp-1006',
        applicantId: buddyMockCurrentUserId,
        applicantName: buddyMockCurrentUserName,
        status: BuddyApplicationStatus.pending,
        createdAt: now.subtract(const Duration(hours: 2)),
      ),
    ];
