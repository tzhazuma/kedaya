/// `buddy` 的**匹配资料**与**可用时段**（规格 `docs/features/buddy-matching.md` §2.2 / §6.3）。
///
/// ## 这个模型为什么要和 `profile` 模块分开
///
/// 规格 §2.2 的原话：`profile` 存「我是谁」，`BuddyProfile` 只存「匹配要用的特征」。
/// **这个分离是刻意的** —— 撤回/关闭匹配只需删 `BuddyProfile`，不影响账号资料。
///
/// ## 隐私设计（规格 §6.1 / §6.3）
///
/// - `BuddyProfile` **对任何人都不直接可见**，包括发帖人（§6.1 可见性矩阵）。
///   它**只被算法使用**，输出只有 `score` + `reason`（聚合后的短语，不暴露完整标签集）。
///   因此本模型**没有**「他人视角」的投影函数 —— 不是 UI 记得别渲染，而是根本没有出口。
/// - `matchEnabled` **默认 `false`**（§6.3「默认不参与」）：匹配需要暴露
///   「我的兴趣/可用时段」给算法，属于对个人信息的**新用途**，不默认开启。
/// - 不采集敏感属性：**无** `gender`、**无** `age`、**无** `birthDate`、**无** `mbti`、
///   无婚恋字段、无精确坐标（§6.3 表格）。这些键在本文件的解析里**永远不会被读取**。
library;

import 'buddy.dart';
import 'buddy_tags.dart';
import 'json_read.dart';

// ------------------------------------------------------------------ 时段

/// 可用时段的上界：**1440 分钟 = 24:00**。
///
/// ⚠️ **对规格 §2.2 的一处显式放宽（已在 feature README §6 上报）**：
/// 规格写的是 `startMin`/`endMin` **0–1439**。但「23:00 到午夜」这个时段用
/// `endMin = 1439` 表示会留下 **1 分钟空洞**（23:59–24:00 不可用），
/// 而 1440 才是"到午夜"的自然边界，也是把跨零点时段拆成
/// 「当天 + 次日」两段时**必须**用到的值（见 [splitCrossMidnight]）。
///
/// 因此本端把 `endMin` 的上界放宽到 **1440**（`startMin` 仍是 0–1439）。
/// 若后端坚持 1439，**只需改这一个常量**（校验与拆分都读它），
/// 单点可回退。≤1439 的取值行为与规格完全一致。
const int buddyAvailabilityEndMinMax = 1440;

/// 一周七天的顺序：**0 = 周日**，与 JS `Date.getDay()` 一致（规格 §3.3 的
/// `overlapsAvailability` 逐行移植自 TS，索引语义必须相同）。
const int buddyDowMin = 0;
const int buddyDowMax = 6;

const List<String> _dowLabels = <String>['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/// `dow` → 中文（越界回落为「未知」而不是抛错）。
String buddyDowLabel(int dow) =>
    (dow >= buddyDowMin && dow <= buddyDowMax) ? _dowLabels[dow] : '未知';

/// 分钟数 → `HH:mm`；1440 渲染为 `24:00`。
String buddyMinutesLabel(int minutes) {
  if (minutes == buddyAvailabilityEndMinMax) return '24:00';
  final int clamped = minutes < 0 ? 0 : minutes;
  final String hour = (clamped ~/ 60).toString().padLeft(2, '0');
  final String minute = (clamped % 60).toString().padLeft(2, '0');
  return '$hour:$minute';
}

/// 一个每周可用时段（分钟粒度，本地时区 **Asia/Shanghai**，规格 §2.2）。
final class AvailabilitySlot {
  const AvailabilitySlot({
    required this.dow,
    required this.startMin,
    required this.endMin,
  });

  factory AvailabilitySlot.fromJson(Map<String, Object?> json) => AvailabilitySlot(
    dow: readIntOr(json, 'dow', 0),
    startMin: readIntOr(json, 'startMin', 0),
    endMin: readIntOr(json, 'endMin', 0),
  );

  /// 0 = 周日 … 6 = 周六（与 JS `getDay()` 一致）。
  final int dow;

  final int startMin;
  final int endMin;

  /// 时长（分钟）。非法时段返回 0。
  int get durationMin => endMin > startMin ? endMin - startMin : 0;

  /// 校验错误；`null` 表示合法。
  ///
  /// 规则：`dow` 0–6；`0 <= startMin <= 1439`；
  /// `startMin < endMin <=` [buddyAvailabilityEndMinMax]。
  String? get error {
    if (dow < buddyDowMin || dow > buddyDowMax) return '星期必须是 0–6（0 = 周日）';
    if (startMin < 0 || startMin >= buddyAvailabilityEndMinMax) {
      return '开始时间必须在 00:00–23:59 之间';
    }
    if (endMin <= startMin) return '结束时间必须晚于开始时间（跨零点请用「跨零点」选项）';
    if (endMin > buddyAvailabilityEndMinMax) return '结束时间最晚到 24:00';
    return null;
  }

  bool get isValid => error == null;

  /// 显示文案，如 `周一 09:00–12:00`。
  String get label =>
      '${buddyDowLabel(dow)} ${buddyMinutesLabel(startMin)}–${buddyMinutesLabel(endMin)}';

  Map<String, Object?> toJson() => <String, Object?>{
    'dow': dow,
    'startMin': startMin,
    'endMin': endMin,
  };

  @override
  bool operator ==(Object other) =>
      other is AvailabilitySlot &&
      other.dow == dow &&
      other.startMin == startMin &&
      other.endMin == endMin;

  @override
  int get hashCode => Object.hash(dow, startMin, endMin);

  @override
  String toString() => 'AvailabilitySlot($label)';
}

/// 把「结束时间早于/等于开始时间」的输入**拆成跨零点的两段**（规格 §3.3 的边界情况）。
///
/// 例：周一 23:00–01:00（`dow=1, startMin=1380, endMin=60`）
///   → `[周一 23:00–24:00, 周二 00:00–01:00]`
///
/// `endMin > startMin` 时原样返回单元素列表（不需要拆）。
/// 结果**只含合法时段**；输入本身非法（如 `startMin` 越界）时返回空列表，
/// 由调用方把 [AvailabilitySlot.error] 显示给用户。
List<AvailabilitySlot> splitCrossMidnight({
  required int dow,
  required int startMin,
  required int endMin,
}) {
  if (dow < buddyDowMin || dow > buddyDowMax) return const <AvailabilitySlot>[];
  if (startMin < 0 || startMin >= buddyAvailabilityEndMinMax) {
    return const <AvailabilitySlot>[];
  }
  if (endMin > startMin && endMin <= buddyAvailabilityEndMinMax) {
    return <AvailabilitySlot>[
      AvailabilitySlot(dow: dow, startMin: startMin, endMin: endMin),
    ];
  }
  if (endMin < 0 || endMin > buddyAvailabilityEndMinMax) {
    return const <AvailabilitySlot>[];
  }
  // 跨零点：当天 [startMin, 24:00) + 次日 [00:00, endMin)。
  final int nextDow = (dow + 1) % 7;
  final List<AvailabilitySlot> parts = <AvailabilitySlot>[
    AvailabilitySlot(dow: dow, startMin: startMin, endMin: buddyAvailabilityEndMinMax),
  ];
  if (endMin > 0) {
    parts.add(AvailabilitySlot(dow: nextDow, startMin: 0, endMin: endMin));
  }
  return parts;
}

/// 把一组时段规范化：拆分跨零点项、去重、按（星期，开始时间）排序。
List<AvailabilitySlot> normalizeAvailability(List<AvailabilitySlot> slots) {
  final List<AvailabilitySlot> out = <AvailabilitySlot>[];
  for (final AvailabilitySlot slot in slots) {
    final List<AvailabilitySlot> parts = slot.endMin > slot.startMin
        ? <AvailabilitySlot>[slot]
        : splitCrossMidnight(
            dow: slot.dow,
            startMin: slot.startMin,
            endMin: slot.endMin,
          );
    for (final AvailabilitySlot part in parts) {
      if (part.isValid && !out.contains(part)) out.add(part);
    }
  }
  out.sort((AvailabilitySlot a, AvailabilitySlot b) {
    if (a.dow != b.dow) return a.dow.compareTo(b.dow);
    return a.startMin.compareTo(b.startMin);
  });
  return out;
}

// ------------------------------------------------------------------ 本地时间

/// UTC 时刻 → 上海本地时间。
DateTime buddyLocalTime(DateTime instant) =>
    instant.toUtc().add(buddyShanghaiUtcOffset);

/// 本地时刻的日期文案，如 `10月24日`。
String buddyLocalDateLabel(DateTime instant) {
  final DateTime local = buddyLocalTime(instant);
  return '${local.month}月${local.day}日';
}

/// 本地时刻的「星期 + 时间」文案，如 `周六 14:00`。
String buddyLocalDateTimeLabel(DateTime instant) {
  final DateTime local = buddyLocalTime(instant);
  return '${buddyDowLabel(local.weekday % 7)} '
      '${buddyMinutesLabel(local.hour * 60 + local.minute)}';
}

/// 本地时刻的完整文案，如 `10月24日 周六 14:00`。
String buddyLocalFullLabel(DateTime instant) =>
    '${buddyLocalDateLabel(instant)} ${buddyLocalDateTimeLabel(instant)}';

/// 时段是否两两重叠（UI 提示用；**不是**提交阻断条件）。
bool hasOverlappingAvailability(List<AvailabilitySlot> slots) {
  for (int i = 0; i < slots.length; i++) {
    for (int j = i + 1; j < slots.length; j++) {
      final AvailabilitySlot a = slots[i];
      final AvailabilitySlot b = slots[j];
      if (a.dow != b.dow) continue;
      if (a.startMin < b.endMin && b.startMin < a.endMin) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ 资料

/// 我的匹配资料（规格 §2.2）。
final class BuddyProfile {
  const BuddyProfile({
    required this.userId,
    this.sections = const <BuddySection>[],
    this.interestTags = const <String>[],
    this.activityTags = const <String>[],
    this.skillLevel = BuddySkillLevel.casual,
    this.availability = const <AvailabilitySlot>[],
    this.preferredAreas = const <String>[],
    this.department,
    this.bio,
    this.matchEnabled = false,
  });

  /// 未填写过的资料（`matchEnabled` 默认 `false`）。
  factory BuddyProfile.empty(String userId) => BuddyProfile(userId: userId);

  /// 从**已解码**的 JSON 解析。
  ///
  /// `embedding` / `embeddingModel` / `gender` / `age` / `mbti` 等键
  /// **永远不会被读取**（规格 §8.4 T26）。
  factory BuddyProfile.fromJson(Map<String, Object?> json) => BuddyProfile(
    userId: readStringOr(json, 'userId', ''),
    sections: readStringList(json, 'sections')
        .map(BuddySection.fromWire)
        .where((BuddySection section) => section.isMatchable)
        .toList(growable: false),
    interestTags: readStringList(json, 'interestTags'),
    activityTags: readStringList(json, 'activityTags'),
    skillLevel: BuddySkillLevel.fromWire(readStringOr(json, 'skillLevel', 'casual')),
    availability: readListOrEmpty(json, 'availability')
        .where((Object? item) => item is Map<Object?, Object?> || item is Map<String, Object?>)
        .map(
          (Object? item) =>
              AvailabilitySlot.fromJson(requireJsonMap(item, what: 'availability[] 元素')),
        )
        .toList(growable: false),
    preferredAreas: readStringList(json, 'preferredAreas'),
    department: readStringOrNull(json, 'department'),
    bio: readStringOrNull(json, 'bio'),
    matchEnabled: readBoolOr(json, 'matchEnabled', false),
  );

  /// 一人一份（FK→`User`）。
  final String userId;

  /// 参与哪些板块；至少 1 项才可被推荐（规格 §2.2）。
  final List<BuddySection> sections;

  /// 兴趣标签（≤20，每项 ≤24 字，封闭表）。
  final List<String> interestTags;

  /// 想做的活动类型（≤10，封闭表）。
  final List<String> activityTags;

  /// 运动水平（仅 `sport` 板块使用）。
  final BuddySkillLevel skillLevel;

  /// 每周可用时段。
  final List<AvailabilitySlot> availability;

  /// 常去区域（校园地点白名单，≤5 项；**不是**精确坐标）。
  final List<String> preferredAreas;

  /// 院系。**唯一与 `profile` 重叠的字段**，用于 `academic` 板块（规格 §3.3）。
  final String? department;

  /// 一句话自述（≤200 字，过内容安全）。
  final String? bio;

  /// **默认关闭**：不主动开启就不进推荐池（规格 §6.3）。
  final bool matchEnabled;

  /// 真实板块列表（已过滤掉 [BuddySection.unknown]）。
  List<BuddySection> get matchableSections => sections
      .where((BuddySection section) => section.isMatchable)
      .toList(growable: false);

  /// 是否会被推荐：开关打开 **且** 至少选了一个板块（规格 §2.2）。
  bool get isRecommendable => matchEnabled && matchableSections.isNotEmpty;

  /// 是否已填写过任何匹配特征（UI 用来区分"空白资料"）。
  bool get hasAnySignal =>
      interestTags.isNotEmpty ||
      activityTags.isNotEmpty ||
      availability.isNotEmpty ||
      preferredAreas.isNotEmpty ||
      (department != null && department!.isNotEmpty);

  /// 全部字段错误（字段名 → 文案）。空 Map 表示可保存。
  ///
  /// 对应规格 §2.2 的约束列；服务端仍会再校验一次（`VALIDATION_FAILED`）。
  Map<String, String> validationErrors() {
    final Map<String, String> errors = <String, String>{};

    if (interestTags.length > buddyInterestTagMaxCount) {
      errors['interestTags'] = '兴趣标签最多 $buddyInterestTagMaxCount 个';
    } else {
      for (final String tag in interestTags) {
        if (tag.runes.length > buddyInterestTagMaxLength) {
          errors['interestTags'] = '单个兴趣标签请控制在 $buddyInterestTagMaxLength 字以内';
          break;
        }
        if (!isKnownBuddyTag(tag)) {
          errors['interestTags'] = '标签「$tag」未登记（UNKNOWN_TAG:$tag）';
          break;
        }
      }
    }

    if (activityTags.length > buddyActivityTagMaxCount) {
      errors['activityTags'] = '活动标签最多 $buddyActivityTagMaxCount 个';
    } else {
      for (final String tag in activityTags) {
        if (!isKnownBuddyTag(tag)) {
          errors['activityTags'] = '标签「$tag」未登记（UNKNOWN_TAG:$tag）';
          break;
        }
      }
    }

    if (preferredAreas.length > buddyPreferredAreaMaxCount) {
      errors['preferredAreas'] = '常去区域最多 $buddyPreferredAreaMaxCount 个';
    } else {
      for (final String area in preferredAreas) {
        if (!isKnownCampusLocation(area)) {
          errors['preferredAreas'] = '「$area」不在校园地点白名单里';
          break;
        }
      }
    }

    final String? departmentValue = department;
    if (departmentValue != null &&
        departmentValue.trim().runes.length > buddyDepartmentMaxLength) {
      errors['department'] = '院系请控制在 $buddyDepartmentMaxLength 字以内';
    }

    final String? bioValue = bio;
    if (bioValue != null) {
      if (bioValue.trim().runes.length > buddyBioMaxLength) {
        errors['bio'] = '自述请控制在 $buddyBioMaxLength 字以内';
      } else {
        final String? contact = buddyContactInfoKind(bioValue);
        if (contact != null) {
          errors['bio'] = '自述里不要填$contact —— 匹配资料对任何人都不可见，填了也没用';
        }
      }
    }

    for (final AvailabilitySlot slot in availability) {
      final String? error = slot.error;
      if (error != null) {
        errors['availability'] = '${slot.label.isEmpty ? '时段' : slot.label}：$error';
        break;
      }
    }

    return errors;
  }

  bool get isValid => validationErrors().isEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
    'userId': userId,
    'sections': matchableSections
        .map((BuddySection section) => section.wire)
        .toList(growable: false),
    'interestTags': interestTags,
    'activityTags': activityTags,
    'skillLevel': skillLevel.wire,
    'availability': availability
        .map((AvailabilitySlot slot) => slot.toJson())
        .toList(growable: false),
    'preferredAreas': preferredAreas,
    'department': department,
    'bio': bio,
    'matchEnabled': matchEnabled,
  };

  BuddyProfile copyWith({
    String? userId,
    List<BuddySection>? sections,
    List<String>? interestTags,
    List<String>? activityTags,
    BuddySkillLevel? skillLevel,
    List<AvailabilitySlot>? availability,
    List<String>? preferredAreas,
    String? department,
    String? bio,
    bool? matchEnabled,
    bool clearDepartment = false,
    bool clearBio = false,
  }) => BuddyProfile(
    userId: userId ?? this.userId,
    sections: sections ?? this.sections,
    interestTags: interestTags ?? this.interestTags,
    activityTags: activityTags ?? this.activityTags,
    skillLevel: skillLevel ?? this.skillLevel,
    availability: availability ?? this.availability,
    preferredAreas: preferredAreas ?? this.preferredAreas,
    department: clearDepartment ? null : (department ?? this.department),
    bio: clearBio ? null : (bio ?? this.bio),
    matchEnabled: matchEnabled ?? this.matchEnabled,
  );

  @override
  String toString() =>
      'BuddyProfile($userId, sections=${matchableSections.length}, '
      'interest=${interestTags.length}, activity=${activityTags.length}, '
      'slots=${availability.length}, matchEnabled=$matchEnabled)';
}
