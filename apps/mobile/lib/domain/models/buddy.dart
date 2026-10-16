/// `buddy`（找搭子）的领域模型 —— 帖子 / 板块 / 状态机 / 发布草稿。
///
/// 真相来源：`docs/features/buddy-matching.md` §2.3 / §2.8 / §5.3 / §5.4
/// 与 `docs/architecture/02-domain-model.md` §2.3（已冻结）。
///
/// 分层约束（冻结契约 §7 硬规则 1）：本文件只 import `dart:core` 与同层模型，
/// 不含任何框架 / IO / JSON 解码 —— 只接收**已解码**的 `Map<String, Object?>`。
library;

import 'buddy_tags.dart';
import 'json_read.dart';
import 'validate.dart';

// ------------------------------------------------------------------ 冻结常量

/// 规格 §2.3：`title` 1–60 字。
const int buddyTitleMaxLength = 60;

/// 规格 §2.3：`description` ≤1000 字。
const int buddyDescriptionMaxLength = 1000;

/// 规格 §2.3 + §11.10-D：`capacity` 2–20，**含发起人**。
const int buddyCapacityMin = 2;
const int buddyCapacityMax = 20;

/// 规格 §2.3：`durationMin` 30–480。
const int buddyDurationMinMin = 30;
const int buddyDurationMinMax = 480;

/// 本地时区固定偏移：**Asia/Shanghai = UTC+8**。
///
/// 为什么可以用固定偏移而不是时区数据库：中国大陆自 1991 年起**不再使用夏令时**，
/// 因此 UTC+8 是精确的。用 `package:timezone` 会引入依赖并破坏
/// 「`domain` 层零框架依赖」（契约 §7 硬规则 1 + `tool/selfcheck.py`）。
///
/// 定义在这里（而不是 `buddy_matching.dart`）是因为 `buddy_profile.dart`
/// 与 `buddy_matching.dart` 都要用它，而后者已经 import 前者 —— 放这里可以避免环。
const Duration buddyShanghaiUtcOffset = Duration(hours: 8);

/// 规格 §2.4：`BuddyApplication.message` ≤200 字。
const int buddyApplicationMessageMaxLength = 200;

// ------------------------------------------------------------------ 板块

/// 三个板块（契约 §11.10-G / 规格 §1.3）。
///
/// **没有 `dating`**：契约 §11.10-G 明确裁决可达鸭不实现 dating 板块，
/// 「若未来要做，必须**新开模块 + 新 ADR + 独立二次同意门**，不得在 `buddy` 里悄悄加」。
/// 因此本枚举里**不存在**任何交友/约会语义的成员。
///
/// 服务端若下发了未登记的板块（包括 `dating`），一律收敛为 [unknown]，
/// 而 [unknown] **不是**一个可用板块：[isMatchable] 为 `false`，
/// 不能作为筛选条件、不参与匹配、也不可能出现在帖子上
/// （帖子的板块恒由 `activity` 派生，见 [sectionOfActivity]）。
enum BuddySection {
  academic('academic', '学术自习'),
  daily('daily', '日常搭子'),
  sport('sport', '运动组队'),

  /// 未登记的板块（含契约 §11.10-G 明令不做的 `dating`）。**不可用**。
  unknown('unknown', '未登记');

  const BuddySection(this.wire, this.label);

  final String wire;
  final String label;

  /// 是否是三个真实板块之一。`unknown` 为 `false`。
  bool get isMatchable => this != BuddySection.unknown;

  /// 未登记 → [unknown]（**不抛异常**，也不静默当成某个真实板块）。
  static BuddySection fromWire(String wire) =>
      tryFromWire(wire) ?? BuddySection.unknown;

  /// 未登记 → `null`（需要区分"没有板块"的调用方用这个）。
  static BuddySection? tryFromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddySection value in BuddySection.values) {
      if (value != BuddySection.unknown && value.wire == normalized) return value;
    }
    return null;
  }
}

/// 三个真实板块（不含 [BuddySection.unknown]）。UI 分栏用这个。
const List<BuddySection> buddyMatchableSections = <BuddySection>[
  BuddySection.academic,
  BuddySection.daily,
  BuddySection.sport,
];

// ------------------------------------------------------------------ 活动类型

/// 活动类型（契约 `02-domain-model.md` §2.3 已冻结：`sport|study|meal|travel|game|other`）。
enum BuddyActivity {
  sport('sport', '运动'),
  study('study', '自习'),
  meal('meal', '吃饭'),
  travel('travel', '出行'),
  game('game', '游戏'),
  other('other', '其它');

  const BuddyActivity(this.wire, this.label);

  final String wire;
  final String label;

  /// 未登记 → [other]（`other` 是契约已冻结的兜底值，保守收敛）。
  static BuddyActivity fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddyActivity value in BuddyActivity.values) {
      if (value.wire == normalized) return value;
    }
    return BuddyActivity.other;
  }
}

/// `sectionOf(activity)` —— 板块由 `activity` **派生**（规格 §2.3，纯函数）。
///
/// | 板块 | 来源 `activity` |
/// | --- | --- |
/// | `academic` | `study` |
/// | `daily` | `meal` / `travel` / `other` |
/// | `sport` | `sport` / `game` |
///
/// **不新增 `section` 字段**：同一信息两处存储必然漂移（规格 §2.3 原话）。
BuddySection sectionOfActivity(BuddyActivity activity) => switch (activity) {
  BuddyActivity.study => BuddySection.academic,
  BuddyActivity.meal => BuddySection.daily,
  BuddyActivity.travel => BuddySection.daily,
  BuddyActivity.other => BuddySection.daily,
  BuddyActivity.sport => BuddySection.sport,
  BuddyActivity.game => BuddySection.sport,
};

/// 某个板块包含哪些 `activity`（`sectionOfActivity` 的反向投影，供 UI 筛选）。
List<BuddyActivity> activitiesOfSection(BuddySection section) => BuddyActivity.values
    .where((BuddyActivity activity) => sectionOfActivity(activity) == section)
    .toList(growable: false);

// ------------------------------------------------------------------ 技能水平

/// 运动水平（规格 §2.2 `skillLevel`；仅 `sport` 板块使用）。
enum BuddySkillLevel {
  beginner('beginner', '入门', 0),
  casual('casual', '随便玩玩', 1),
  regular('regular', '经常玩', 2),
  competitive('competitive', '竞技', 3);

  const BuddySkillLevel(this.wire, this.label, this.rank);

  final String wire;
  final String label;

  /// 单调序（`minSkillLevel` 的硬过滤 F6 用 `rank >=` 比较，而不是相等）。
  final int rank;

  /// 未登记 → [casual]（规格 §2.2 的默认值）。
  static BuddySkillLevel fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddySkillLevel value in BuddySkillLevel.values) {
      if (value.wire == normalized) return value;
    }
    return BuddySkillLevel.casual;
  }
}

// ------------------------------------------------------------------ 状态机

/// `BuddyPost` 状态机（规格 §2.8，与 `02-domain-model.md:535-548` 逐字一致）。
enum BuddyPostStatus {
  open('OPEN', '招募中'),
  full('FULL', '已满员'),
  closed('CLOSED', '已关闭'),
  expired('EXPIRED', '已过期'),
  cancelled('CANCELLED', '已取消'),

  /// 未登记状态：按**不可申请、不可见**处理（保守）。
  unknown('unknown', '未知');

  const BuddyPostStatus(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyPostStatus fromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final BuddyPostStatus value in BuddyPostStatus.values) {
      if (value != BuddyPostStatus.unknown && value.wire == normalized) return value;
    }
    return BuddyPostStatus.unknown;
  }

  /// 终态：不会再发生转移。
  bool get isTerminal =>
      this == BuddyPostStatus.closed ||
      this == BuddyPostStatus.expired ||
      this == BuddyPostStatus.cancelled ||
      this == BuddyPostStatus.unknown;

  /// 只有 `OPEN` 能接受新申请（规格 §5.5 的 `POST_NOT_OPEN`）。
  bool get isOpen => this == BuddyPostStatus.open;

  /// 发起人能否关闭（`OPEN` / `FULL` → `CLOSED`）。
  bool get canBeClosed => this == BuddyPostStatus.open || this == BuddyPostStatus.full;

  /// 是否出现在列表里（规格 §5.9 的列表 `where` 条件是 `status: 'OPEN'`）。
  ///
  /// `FULL` 帖**不**出现在列表（与规格 §5.9 的查询逐字一致），但仍可**按 id 打开详情**
  /// —— 已申请的人需要能看到自己申请过的活动。
  bool get appearsInList => this == BuddyPostStatus.open;
}

/// `canTransition(from, to)` —— 规格 §2.8 的状态机，**纯函数**。
///
/// 契约 `02-domain-model.md:36` 规则 2 要求状态流转只走这样的纯函数，
/// 不允许 Controller 里直接 `update({ status })`。
bool canTransitionBuddyPost(BuddyPostStatus from, BuddyPostStatus to) {
  if (from == to) return false;
  return switch (from) {
    BuddyPostStatus.open =>
      to == BuddyPostStatus.full ||
          to == BuddyPostStatus.closed ||
          to == BuddyPostStatus.expired ||
          to == BuddyPostStatus.cancelled,
    BuddyPostStatus.full =>
      to == BuddyPostStatus.open ||
          to == BuddyPostStatus.closed ||
          to == BuddyPostStatus.expired ||
          to == BuddyPostStatus.cancelled,
    BuddyPostStatus.closed ||
    BuddyPostStatus.expired ||
    BuddyPostStatus.cancelled ||
    BuddyPostStatus.unknown => false,
  };
}

// ------------------------------------------------------------------ 性别偏好

/// 性别偏好（契约 §2.3 已冻结；**是发起人的准入约束，不是打分特征**）。
///
/// 规格 §1.2 N5：性别**不进**向量、不进特征、不参与打分。
enum BuddyGenderPreference {
  any('any', '不限'),
  same('same', '同性'),
  other('other', '异性');

  const BuddyGenderPreference(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyGenderPreference fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddyGenderPreference value in BuddyGenderPreference.values) {
      if (value.wire == normalized) return value;
    }
    return BuddyGenderPreference.any;
  }
}

// ------------------------------------------------------------------ 发起人

/// 帖子里的发起人引用（规格 §5.3 的 `creator: {id, nickname, avatarUrl}`）。
///
/// **刻意只有三个字段**：规格 §6.1 的可见性矩阵规定「发起人**联系方式**」对
/// 已登录他人 ❌、对 `PENDING` 申请人 ❌，只有 `ACCEPTED` 之后才通过
/// `notifications` 交换（§6.2）。因此联系方式**不可能**出现在本模型里 ——
/// 不是"UI 记得别渲染"，而是类型里没有这个字段。
final class BuddyCreator {
  const BuddyCreator({required this.id, this.nickname, this.avatarUrl});

  factory BuddyCreator.fromJson(Map<String, Object?> json) => BuddyCreator(
    id: readStringOr(json, 'id', ''),
    nickname: readStringOrNull(json, 'nickname'),
    avatarUrl: readStringOrNull(json, 'avatarUrl'),
  );

  final String id;
  final String? nickname;
  final String? avatarUrl;

  /// 展示名：昵称为空时回落为 id（不编造昵称）。
  String get displayName =>
      (nickname != null && nickname!.isNotEmpty) ? nickname! : id;

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'nickname': nickname,
    'avatarUrl': avatarUrl,
  };

  @override
  bool operator ==(Object other) => other is BuddyCreator && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'BuddyCreator($id)';
}

// ------------------------------------------------------------------ 帖子

/// 一次性的组队活动（契约 §2.3 已冻结 + 规格 §2.3 新增的可选字段）。
final class BuddyPost {
  const BuddyPost({
    required this.id,
    required this.activity,
    required this.title,
    required this.location,
    required this.startsAt,
    required this.capacity,
    required this.creator,
    this.description,
    this.status = BuddyPostStatus.open,
    this.joinedCount = 1,
    this.genderPreference = BuddyGenderPreference.any,
    this.tags = const <String>[],
    this.durationMin,
    this.minSkillLevel,
    this.autoCloseAt,
    this.createdAt,
  });

  /// 从**已解码**的 JSON 解析。
  ///
  /// 两条刻意的设计：
  ///   1. **`section` 字段一律忽略** —— 板块恒由 `activity` 派生（规格 §2.3）。
  ///      于是服务端下发 `section: "dating"` 也不可能在客户端造出一个 dating 帖子；
  ///   2. `gender` / `age` / `birthDate` / `mbti` / `embedding` / 联系方式
  ///      这些键**永远不会被读取**（规格 §8.4 T26/T27）。
  factory BuddyPost.fromJson(Map<String, Object?> json) {
    final String? minSkill = readStringOrNull(json, 'minSkillLevel');
    final Map<String, Object?>? creatorJson = readMapOrNull(json, 'creator');
    final BuddyCreator creator = creatorJson != null
        ? BuddyCreator.fromJson(creatorJson)
        : BuddyCreator(
            id: readStringOr(json, 'creatorId', ''),
            nickname: readStringOrNull(json, 'creatorName'),
          );
    return BuddyPost(
      id: readString(json, 'id'),
      activity: BuddyActivity.fromWire(readStringOr(json, 'activity', 'other')),
      title: readString(json, 'title'),
      description: readStringOrNull(json, 'description'),
      location: readStringOr(json, 'location', ''),
      startsAt: readDateTime(json, 'startsAt'),
      capacity: readIntOr(json, 'capacity', buddyCapacityMin),
      joinedCount: readIntOr(json, 'joinedCount', 1),
      creator: creator,
      status: BuddyPostStatus.fromWire(readStringOr(json, 'status', 'OPEN')),
      genderPreference: BuddyGenderPreference.fromWire(
        readStringOr(json, 'genderPreference', 'any'),
      ),
      tags: readStringList(json, 'tags'),
      durationMin: readIntOrNull(json, 'durationMin'),
      minSkillLevel: minSkill == null ? null : BuddySkillLevel.fromWire(minSkill),
      autoCloseAt: readDateTimeOrNull(json, 'autoCloseAt'),
      createdAt: readDateTimeOrNull(json, 'createdAt'),
    );
  }

  final String id;
  final BuddyActivity activity;
  final String title;
  final String? description;
  final String location;
  final DateTime startsAt;
  final int capacity;

  /// 已加入人数（**含发起人**，初值 1 —— 契约 §11.10-D 裁决）。
  final int joinedCount;

  final BuddyCreator creator;
  final BuddyPostStatus status;
  final BuddyGenderPreference genderPreference;

  /// 活动标签（≤8，封闭表）。**匹配打分的主特征**（规格 §2.3）。
  final List<String> tags;

  /// 预计时长（分钟，30–480）。用于时段重叠判断（规格 §3.3 F7）。
  final int? durationMin;

  /// 仅 `sport`；作为**硬过滤**（F6），不是打分。
  final BuddySkillLevel? minSkillLevel;

  /// 到期自动转 `EXPIRED` 的时间（默认 `startsAt`）。
  final DateTime? autoCloseAt;

  final DateTime? createdAt;

  /// 板块 —— **派生**，不是存储字段（规格 §2.3）。
  BuddySection get section => sectionOfActivity(activity);

  /// 剩余名额（`capacity` 含发起人）。
  int get remainingSeats {
    final int left = capacity - joinedCount;
    return left < 0 ? 0 : left;
  }

  bool get isFull => joinedCount >= capacity;

  /// 是否可以申请加入（规格 §5.5：非 `OPEN` → `POST_NOT_OPEN`；满员 → `POST_FULL`）。
  bool get canJoin => status.isOpen && !isFull;

  /// 结束时刻；`durationMin` 未知时返回 null。
  DateTime? get endsAtOrNull =>
      durationMin == null ? null : startsAt.add(Duration(minutes: durationMin!));

  /// 是否由 [userId] 发起（UI 据此显示「我发布的」）。
  bool isCreatedBy(String userId) => creator.id == userId;

  /// 「N/M 人」文案（`joinedCount` 含发起人）。
  String get seatsLabel => '$joinedCount/$capacity 人';

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'activity': activity.wire,
    // 派生值：读回时被忽略，发出时与后端形状一致（规格 §5.3 响应含 `section`）。
    'section': section.wire,
    'status': status.wire,
    'title': title,
    'description': description,
    'location': location,
    'startsAt': isoUtc(startsAt),
    'durationMin': durationMin,
    'capacity': capacity,
    'joinedCount': joinedCount,
    'genderPreference': genderPreference.wire,
    'tags': tags,
    'minSkillLevel': minSkillLevel?.wire,
    'autoCloseAt': autoCloseAt == null ? null : isoUtc(autoCloseAt!),
    'creator': creator.toJson(),
    'createdAt': createdAt == null ? null : isoUtc(createdAt!),
  };

  BuddyPost copyWith({
    String? id,
    BuddyActivity? activity,
    String? title,
    String? description,
    String? location,
    DateTime? startsAt,
    int? capacity,
    int? joinedCount,
    BuddyCreator? creator,
    BuddyPostStatus? status,
    BuddyGenderPreference? genderPreference,
    List<String>? tags,
    int? durationMin,
    BuddySkillLevel? minSkillLevel,
    DateTime? autoCloseAt,
    DateTime? createdAt,
  }) => BuddyPost(
    id: id ?? this.id,
    activity: activity ?? this.activity,
    title: title ?? this.title,
    description: description ?? this.description,
    location: location ?? this.location,
    startsAt: startsAt ?? this.startsAt,
    capacity: capacity ?? this.capacity,
    joinedCount: joinedCount ?? this.joinedCount,
    creator: creator ?? this.creator,
    status: status ?? this.status,
    genderPreference: genderPreference ?? this.genderPreference,
    tags: tags ?? this.tags,
    durationMin: durationMin ?? this.durationMin,
    minSkillLevel: minSkillLevel ?? this.minSkillLevel,
    autoCloseAt: autoCloseAt ?? this.autoCloseAt,
    createdAt: createdAt ?? this.createdAt,
  );

  @override
  bool operator ==(Object other) => other is BuddyPost && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'BuddyPost($id, ${activity.wire}, ${status.wire}, $seatsLabel)';
}

// ------------------------------------------------------------------ 查询

/// 列表排序（规格 §5.3）。
enum BuddyPostSort {
  startsAtAsc('startsAt_asc', '按开始时间'),
  createdAtDesc('createdAt_desc', '按发布时间');

  const BuddyPostSort(this.wire, this.label);

  final String wire;
  final String label;
}

/// 活动列表查询（规格 §5.3）。
final class BuddyPostQuery {
  const BuddyPostQuery({
    this.section,
    this.activities = const <BuddyActivity>[],
    this.tags = const <String>[],
    this.startsAfter,
    this.cursor,
    this.limit = defaultBuddyPageSize,
    this.sort = BuddyPostSort.startsAtAsc,
  });

  /// 板块筛选；`null` = 不过滤。[BuddySection.unknown] 会被丢弃（不是可用板块）。
  final BuddySection? section;

  final List<BuddyActivity> activities;

  /// 标签 key，命中任一即返回。
  final List<String> tags;

  final DateTime? startsAfter;

  /// 游标 —— **对客户端完全不透明**（契约 §11.10-E）。
  ///
  /// 客户端**只能原样回传**：不得解析、不得构造、不得假设格式
  /// （`sort=startsAt_asc` 时服务端会用复合游标 `(startsAt, id)`）。
  final String? cursor;

  final int limit;
  final BuddyPostSort sort;

  BuddyPostQuery copyWith({
    BuddySection? section,
    List<BuddyActivity>? activities,
    List<String>? tags,
    DateTime? startsAfter,
    String? cursor,
    int? limit,
    BuddyPostSort? sort,
    bool clearCursor = false,
  }) => BuddyPostQuery(
    section: section ?? this.section,
    activities: activities ?? this.activities,
    tags: tags ?? this.tags,
    startsAfter: startsAfter ?? this.startsAfter,
    cursor: clearCursor ? null : (cursor ?? this.cursor),
    limit: limit ?? this.limit,
    sort: sort ?? this.sort,
  );

  Map<String, Object?> toQuery() => <String, Object?>{
    if (section != null && section!.isMatchable) 'section': section!.wire,
    if (activities.isNotEmpty)
      'activity': activities.map((BuddyActivity value) => value.wire).join(','),
    if (tags.isNotEmpty) 'tags': tags.join(','),
    if (startsAfter != null) 'startsAfter': isoUtc(startsAfter!),
    if (cursor != null && cursor!.isNotEmpty) 'cursor': cursor,
    'limit': limit < 1 ? 1 : (limit > maxBuddyPageSize ? maxBuddyPageSize : limit),
    'sort': sort.wire,
  };
}

/// 游标分页的默认页大小与上限（规格 §5.3：`limit` 1–100，默认 20）。
const int defaultBuddyPageSize = 20;
const int maxBuddyPageSize = 100;

/// 推荐页大小（规格 §5.7：1–50，默认 10）。
const int defaultBuddyRecommendLimit = 10;
const int maxBuddyRecommendLimit = 50;

// ------------------------------------------------------------------ 联系方式检测

/// 描述里的联系方式模式（规格 §6.4）。
///
/// 返回命中的**类别名**；`null` 表示未命中。
///
/// **这是客户端预校验，不是安全边界** —— 权威判定在服务端
/// （`VALIDATION_FAILED` / `CONTACT_INFO_IN_DESCRIPTION`）。
///
/// ⚠️ **对规格正则的一处收敛（已在 feature README §6 上报）**：
/// 规格 §6.4 写的微信模式是 `[Vv]信?\s*[:：]?\s*\w+`。这个正则会把**任何以
/// v/V 开头的英文单词**判成联系方式（`video` → `v` + `ideo` 命中），
/// 而组队描述里出现英文单词很常见。本端因此要求：
///   · `v信` / `V信` / `微信` 形式：`[Vv]?信\s*[:：]?\s*\w+`；
///   · 裸 `v` / `V` 形式：**必须带冒号**（`\b[Vv]\s*[:：]\s*\w+`）。
/// 这仍然覆盖规格想拦的真实写法（`v: abc`、`微信：abc`），只是不再误伤英文单词。
String? buddyContactInfoKind(String text) {
  if (_buddyMobilePattern.hasMatch(text)) return '手机号';
  if (_buddyWechatPattern.hasMatch(text)) return '微信号';
  if (_buddyQqPattern.hasMatch(text)) return 'QQ 号';
  if (_buddyEmailPattern.hasMatch(text)) return '邮箱';
  return null;
}

final RegExp _buddyMobilePattern = RegExp(r'1[3-9]\d{9}');
final RegExp _buddyWechatPattern = RegExp(r'([Vv]?信\s*[:：]?\s*\w+|\b[Vv]\s*[:：]\s*\w+)');
final RegExp _buddyQqPattern = RegExp(r'(?:QQ|qq)\s*[:：]?\s*\d{5,12}');
final RegExp _buddyEmailPattern = RegExp(r'[\w.+-]+@[\w-]+\.[\w.]+');

// ------------------------------------------------------------------ 发布草稿

/// 发布草稿 —— 纯逻辑，含**全部字段级校验**（规格 §5.4 的错误表）。
///
/// 放在 domain 是为了让校验可被单测直接覆盖，而不是只能靠点 UI 验证。
final class BuddyPostDraft {
  const BuddyPostDraft({
    this.activity = BuddyActivity.sport,
    this.title = '',
    this.description = '',
    this.location = '',
    this.startsAt,
    this.durationMin = 120,
    this.capacity = 4,
    this.genderPreference = BuddyGenderPreference.any,
    this.tags = const <String>[],
    this.minSkillLevel,
  });

  final BuddyActivity activity;
  final String title;
  final String description;
  final String location;

  /// 开始时间；`null` 表示还没选。
  final DateTime? startsAt;

  final int durationMin;
  final int capacity;
  final BuddyGenderPreference genderPreference;

  /// 活动标签 key（封闭表，≤8）。
  final List<String> tags;

  /// 仅 `sport` 板块有意义。
  final BuddySkillLevel? minSkillLevel;

  /// 草稿所属板块（由 `activity` 派生，UI 分栏用）。
  BuddySection get section => sectionOfActivity(activity);

  /// 实际生效的 `minSkillLevel`：`minSkillLevel` **只对 `sport`** 板块生效
  /// （规格 §2.3），其它板块一律视为 null（`durationMin` 则所有板块都用，
  /// 它参与 §3.3 F7 的时段重叠判断）。
  BuddySkillLevel? get effectiveMinSkillLevel =>
      section == BuddySection.sport ? minSkillLevel : null;

  String? get titleError {
    final String value = title.trim();
    if (value.isEmpty) return '请填写标题';
    if (!isLengthWithin(value, 1, buddyTitleMaxLength)) {
      return '标题请控制在 $buddyTitleMaxLength 字以内';
    }
    return null;
  }

  String? get descriptionError {
    if (description.trim().runes.length > buddyDescriptionMaxLength) {
      return '说明请控制在 $buddyDescriptionMaxLength 字以内';
    }
    final String? contact = buddyContactInfoKind(description);
    if (contact != null) {
      return '说明里不要填$contact —— 组队成功后系统会自动交换联系方式';
    }
    return null;
  }

  String? get locationError {
    final String value = location.trim();
    if (value.isEmpty) return '请选择地点';
    if (!isKnownCampusLocation(value)) return '地点不在校园地点白名单里';
    return null;
  }

  /// `startsAt` 必须晚于当前（规格 §2.3）。
  String? startsAtErrorAt(DateTime now) {
    final DateTime? value = startsAt;
    if (value == null) return '请选择开始时间';
    if (!value.isAfter(now)) return '开始时间必须晚于当前时间';
    return null;
  }

  String? get durationError {
    if (durationMin < buddyDurationMinMin || durationMin > buddyDurationMinMax) {
      return '时长请填 $buddyDurationMinMin–$buddyDurationMinMax 分钟';
    }
    return null;
  }

  String? get capacityError {
    if (capacity < buddyCapacityMin || capacity > buddyCapacityMax) {
      return '人数请填 $buddyCapacityMin–$buddyCapacityMax 人（含你自己）';
    }
    return null;
  }

  /// 标签校验：数量上限 + **封闭表**（未登记 / 已下架都拒）。
  String? get tagsError {
    if (tags.length > buddyPostTagMaxCount) {
      return '最多选 $buddyPostTagMaxCount 个标签';
    }
    for (final String tag in tags) {
      if (!isKnownBuddyTag(tag)) return '标签「$tag」未登记（UNKNOWN_TAG:$tag）';
      if (!isActiveBuddyTag(tag)) return '标签「${buddyTagLabel(tag)}」已下架，不能再选';
    }
    return null;
  }

  /// 全部字段错误（字段名 → 文案）。空 Map 表示可提交。
  ///
  /// 字段名与规格 §5.4 的 `details.reason` 对齐（后端返回的是字段名本身）。
  Map<String, String> validationErrorsAt(DateTime now) {
    final Map<String, String> errors = <String, String>{};
    void put(String field, String? message) {
      if (message != null) errors[field] = message;
    }

    put('title', titleError);
    put('description', descriptionError);
    put('location', locationError);
    put('startsAt', startsAtErrorAt(now));
    put('durationMin', durationError);
    put('capacity', capacityError);
    put('tags', tagsError);
    return errors;
  }

  bool isValidAt(DateTime now) => validationErrorsAt(now).isEmpty;

  /// 转成 `POST /api/v1/buddy/items` 的请求体（规格 §5.4）。
  ///
  /// **不含 `creatorId`**：发起人由后端从 JWT 取，客户端不参与。
  /// **不含 `section`**：板块由 `activity` 派生。
  CreateBuddyPostCommand toCommand() => CreateBuddyPostCommand(
    activity: activity,
    title: title.trim(),
    description: description.trim().isEmpty ? null : description.trim(),
    location: location.trim(),
    startsAt: startsAt!,
    durationMin: durationMin,
    capacity: capacity,
    genderPreference: genderPreference,
    tags: tags,
    minSkillLevel: effectiveMinSkillLevel,
  );

  BuddyPostDraft copyWith({
    BuddyActivity? activity,
    String? title,
    String? description,
    String? location,
    DateTime? startsAt,
    int? durationMin,
    int? capacity,
    BuddyGenderPreference? genderPreference,
    List<String>? tags,
    BuddySkillLevel? minSkillLevel,
    bool clearMinSkillLevel = false,
  }) => BuddyPostDraft(
    activity: activity ?? this.activity,
    title: title ?? this.title,
    description: description ?? this.description,
    location: location ?? this.location,
    startsAt: startsAt ?? this.startsAt,
    durationMin: durationMin ?? this.durationMin,
    capacity: capacity ?? this.capacity,
    genderPreference: genderPreference ?? this.genderPreference,
    tags: tags ?? this.tags,
    minSkillLevel: clearMinSkillLevel ? null : (minSkillLevel ?? this.minSkillLevel),
  );

  @override
  String toString() =>
      'BuddyPostDraft(${activity.wire}, ${title.length}字, '
      '${tags.length}标签, $capacity人)';
}

/// 发布命令（`POST /api/v1/buddy/items`，动作名 `join`/`close`/`decide`/`feedback`
/// 见契约 §11.2）。
final class CreateBuddyPostCommand {
  const CreateBuddyPostCommand({
    required this.activity,
    required this.title,
    required this.location,
    required this.startsAt,
    required this.capacity,
    this.description,
    this.durationMin,
    this.genderPreference = BuddyGenderPreference.any,
    this.tags = const <String>[],
    this.minSkillLevel,
  });

  final BuddyActivity activity;
  final String title;
  final String? description;
  final String location;
  final DateTime startsAt;
  final int capacity;
  final int? durationMin;
  final BuddyGenderPreference genderPreference;
  final List<String> tags;
  final BuddySkillLevel? minSkillLevel;

  Map<String, Object?> toJson() => <String, Object?>{
    'activity': activity.wire,
    'title': title,
    'description': description,
    'location': location,
    // 契约 §6.1：时间是 ISO-8601 **UTC** 字符串。
    // 规格 §5.4 的示例写的是 `+08:00` 偏移，指的是同一时刻，本端统一发 UTC `Z`。
    'startsAt': isoUtc(startsAt),
    'durationMin': durationMin,
    'capacity': capacity,
    'genderPreference': genderPreference.wire,
    'tags': tags,
    'minSkillLevel': minSkillLevel?.wire,
  };
}
