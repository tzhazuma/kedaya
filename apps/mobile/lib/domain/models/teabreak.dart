/// 学术会议茶歇分享（`teabreak`）—— 逐条镜像 `packages/contracts/src/teabreaks.ts`。
///
/// ## 这个模块的核心不是「列表」，是「多久没被确认了」
///
/// 茶歇有保质期：一个 20 分钟的茶歇，昨天的信息等于没有。因此模型里最重要的
/// 两个东西是 [teabreakStatus]（当前时效）与 [sortTeabreaks]（先冲哪个）。
///
/// ## 时间用 [DateTime]，不用 ISO 字符串
///
/// 契约的传输层是 ISO-8601 UTC 字符串，但 `apps/mobile` 的既有模型
/// （`GroupbuyOrder` / `WildlifeSighting` / `CampusBindingSummary` …）一律在
/// `fromJson` 里解析成 [DateTime]、在 `toJson` 里用 [isoUtc] 写回。
/// 本文件保持一致：**解析在数据层边界，展示层只认 [DateTime]**。
///
/// ## 不做的事
///
/// 不提供「会议室实时人数」，也不做「预约茶歇」（契约开头的第 3 条）——
/// 模型里没有这些字段，因此这类功能在类型上就写不出来。
library;

import 'json_read.dart';

/* ------------------------------------------------------------------ *
 * 1. 开放程度
 * ------------------------------------------------------------------ */

/// 茶歇的开放程度 —— 本模块**最有价值的一个字段**（契约 `TEABREAK_ACCESS`）。
///
/// 它决定「去不去」，也决定用户承担的风险。
enum TeabreakAccess {
  open('open', '对外开放（不需注册）'),
  registered('registered', '仅限注册参会者'),
  unknown('unknown', '不确定');

  const TeabreakAccess(this.wire, this.label);

  /// 线上标识（与契约 `TEABREAK_ACCESS` 逐字一致）。
  final String wire;

  /// 面向用户的名字（契约 `TEABREAK_ACCESS_LABELS`）。
  final String label;

  /// 给这个开放程度的**风险提示**（契约 `TEABREAK_ACCESS_HINTS`）。
  ///
  /// 不说教「请勿蹭会」—— 只陈述事实：去了可能被问「你是哪位」。
  String get hint => switch (this) {
        TeabreakAccess.open => '通常会有人指引，可以直接过去。',
        TeabreakAccess.registered => '需要会议注册证或胸牌，可能被工作人员询问。',
        TeabreakAccess.unknown => '发布者也不确定。建议在门口观察一下，或找认识的参会者带进去。',
      };

  /// 未知取值返回 null —— 调用方**必须**显式决定怎么处理，不许静默降级。
  static TeabreakAccess? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final TeabreakAccess access in TeabreakAccess.values) {
      if (access.wire == normalized) return access;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 2. 时效
 * ------------------------------------------------------------------ */

/// 茶歇信息多久算「过期」：20 分钟（契约 `TEABREAK_FRESHNESS_MS`）。
///
/// 20 分钟是实测经验值：一个会议茶歇通常 15–30 分钟。
/// 超过这个时长还没人再确认，默认已经收摊。
const int teabreakFreshnessMs = 20 * 60 * 1000;

/// 一条茶歇信息的可信度（契约 `TEABREAK_FRESHNESS`）。
enum TeabreakFreshness {
  fresh('fresh', '刚确认还有'),
  stale('stale', '20 分钟没人确认了'),
  over('over', '已结束'),
  notStarted('notStarted', '还没开始');

  const TeabreakFreshness(this.wire, this.label);

  /// 线上标识。注意 [notStarted] 是驼峰（与契约一致），不是 kebab-case。
  final String wire;

  /// 面向用户的文案（契约 `TEABREAK_FRESHNESS_LABELS`）。
  final String label;

  /// 现在去一趟是否**有意义**（时间窗内）。
  bool get isWithinWindow => this == fresh || this == stale;

  static TeabreakFreshness? fromWire(String wire) {
    final String normalized = wire.trim();
    for (final TeabreakFreshness freshness in TeabreakFreshness.values) {
      if (freshness.wire == normalized) return freshness;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 3. 数据模型
 * ------------------------------------------------------------------ */

/// 一次「确认还有茶歇」—— 比附议更轻，只说明「刚才我去看了，有」。
final class TeabreakConfirm {
  const TeabreakConfirm({required this.confirmId, required this.confirmedAt});

  factory TeabreakConfirm.fromJson(Map<String, Object?> json) =>
      TeabreakConfirm(
        confirmId: readString(json, 'confirmId'),
        confirmedAt: readDateTime(json, 'confirmedAt'),
      );

  /// 随机标识（**不是**用户 id），仅用于去重。
  final String confirmId;

  final DateTime confirmedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'confirmId': confirmId,
        'confirmedAt': isoUtc(confirmedAt),
      };

  @override
  bool operator ==(Object other) =>
      other is TeabreakConfirm &&
      other.confirmId == confirmId &&
      other.confirmedAt == confirmedAt;

  @override
  int get hashCode => Object.hash(confirmId, confirmedAt);

  @override
  String toString() => 'TeabreakConfirm($confirmId, ${isoUtc(confirmedAt)})';
}

/// 一条学术会议茶歇信息（契约 `Teabreak`，字段一一对应）。
final class Teabreak {
  const Teabreak({
    required this.id,
    required this.conferenceName,
    required this.venue,
    required this.conferenceStartsAt,
    required this.conferenceEndsAt,
    required this.teaStartsAt,
    required this.teaEndsAt,
    required this.access,
    required this.postedBy,
    required this.createdAt,
    this.confirms = const <TeabreakConfirm>[],
    this.note,
  });

  factory Teabreak.fromJson(Map<String, Object?> json) {
    final String rawAccess = readString(json, 'access');
    final TeabreakAccess? access = TeabreakAccess.fromWire(rawAccess);
    if (access == null) {
      throw FormatException('Teabreak: 未知开放程度 "$rawAccess"');
    }
    final String? note = readStringOrNull(json, 'note');
    return Teabreak(
      id: readString(json, 'id'),
      conferenceName: readString(json, 'conferenceName'),
      venue: readString(json, 'venue'),
      conferenceStartsAt: readDateTime(json, 'conferenceStartsAt'),
      conferenceEndsAt: readDateTime(json, 'conferenceEndsAt'),
      teaStartsAt: readDateTime(json, 'teaStartsAt'),
      teaEndsAt: readDateTime(json, 'teaEndsAt'),
      access: access,
      postedBy: readString(json, 'postedBy'),
      createdAt: readDateTime(json, 'createdAt'),
      confirms: readListOrEmpty(json, 'confirms')
          .whereType<Map<String, Object?>>()
          .map(TeabreakConfirm.fromJson)
          .toList(growable: false),
      note: (note == null || note.trim().isEmpty) ? null : note,
    );
  }

  final String id;

  /// 会议名称（要能认出来，比如「第七届信息科学前沿论坛」）。
  final String conferenceName;

  /// 地点（楼 + 房间，比如「信息学院 1-101」）。
  final String venue;

  final DateTime conferenceStartsAt;
  final DateTime conferenceEndsAt;

  /// 茶歇时间窗。
  ///
  /// ⚠️ 允许与会议时间窗不同 —— 茶歇通常在会议中途，而且发布者经常只知道大概
  /// （「下午三点多」）。所以这里是 `[teaStartsAt, teaEndsAt]` 而不是单个时刻，
  /// 且允许短到 10 分钟。
  final DateTime teaStartsAt;
  final DateTime teaEndsAt;

  final TeabreakAccess access;

  /// 发布者显示名。
  final String postedBy;

  final DateTime createdAt;

  /// 「我去看了，还有」的确认记录。
  final List<TeabreakConfirm> confirms;

  /// 补充说明（「有咖啡和可颂」「在二楼走廊」）；空串归一为 `null`。
  final String? note;

  /// 最近一次确认的时刻；从未确认返回 `null`。
  DateTime? get lastConfirmedAt {
    DateTime? latest;
    for (final TeabreakConfirm confirm in confirms) {
      if (latest == null || confirm.confirmedAt.isAfter(latest)) {
        latest = confirm.confirmedAt;
      }
    }
    return latest;
  }

  /// 茶歇窗口时长（毫秒）。
  int get teaWindowMs => teaEndsAt.difference(teaStartsAt).inMilliseconds;

  /// 当前时效（注入 `now`，便于测试——与契约的 `teabreakStatus` 同签名）。
  TeabreakStatus statusAt(DateTime now) => teabreakStatus(this, now);

  Teabreak copyWith({
    String? id,
    String? conferenceName,
    String? venue,
    DateTime? conferenceStartsAt,
    DateTime? conferenceEndsAt,
    DateTime? teaStartsAt,
    DateTime? teaEndsAt,
    TeabreakAccess? access,
    String? postedBy,
    DateTime? createdAt,
    List<TeabreakConfirm>? confirms,
    String? note,
  }) =>
      Teabreak(
        id: id ?? this.id,
        conferenceName: conferenceName ?? this.conferenceName,
        venue: venue ?? this.venue,
        conferenceStartsAt: conferenceStartsAt ?? this.conferenceStartsAt,
        conferenceEndsAt: conferenceEndsAt ?? this.conferenceEndsAt,
        teaStartsAt: teaStartsAt ?? this.teaStartsAt,
        teaEndsAt: teaEndsAt ?? this.teaEndsAt,
        access: access ?? this.access,
        postedBy: postedBy ?? this.postedBy,
        createdAt: createdAt ?? this.createdAt,
        confirms: confirms ?? this.confirms,
        note: note ?? this.note,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'conferenceName': conferenceName,
        'venue': venue,
        'conferenceStartsAt': isoUtc(conferenceStartsAt),
        'conferenceEndsAt': isoUtc(conferenceEndsAt),
        'teaStartsAt': isoUtc(teaStartsAt),
        'teaEndsAt': isoUtc(teaEndsAt),
        'access': access.wire,
        'postedBy': postedBy,
        'createdAt': isoUtc(createdAt),
        'confirms':
            confirms.map((TeabreakConfirm c) => c.toJson()).toList(growable: false),
        'note': note,
      };

  @override
  bool operator ==(Object other) =>
      other is Teabreak &&
      other.id == id &&
      other.conferenceName == conferenceName &&
      other.venue == venue &&
      other.conferenceStartsAt == conferenceStartsAt &&
      other.conferenceEndsAt == conferenceEndsAt &&
      other.teaStartsAt == teaStartsAt &&
      other.teaEndsAt == teaEndsAt &&
      other.access == access &&
      other.postedBy == postedBy &&
      other.createdAt == createdAt &&
      _sameConfirms(other.confirms, confirms) &&
      other.note == note;

  @override
  int get hashCode => Object.hash(
        id,
        conferenceName,
        venue,
        conferenceStartsAt,
        conferenceEndsAt,
        teaStartsAt,
        teaEndsAt,
        access,
        postedBy,
        createdAt,
        Object.hashAll(confirms),
        note,
      );

  @override
  String toString() => 'Teabreak($id, $conferenceName, @$venue, '
      '${access.wire}, confirms=${confirms.length})';
}

/// `List` 没有值相等，因此这里手写一次（domain 层不引 `package:collection`）。
bool _sameConfirms(List<TeabreakConfirm> a, List<TeabreakConfirm> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 4. 时效判定（契约 `teabreakStatus`）
 * ------------------------------------------------------------------ */

/// 一条茶歇信息的当前状态（契约 `TeabreakStatus`）。
final class TeabreakStatus {
  const TeabreakStatus({
    required this.freshness,
    required this.sinceLastConfirmMs,
    required this.worthGoing,
  });

  final TeabreakFreshness freshness;

  /// 最近一次确认距今多久（毫秒）；从未确认则为 `null`。
  final int? sinceLastConfirmMs;

  /// 值不值得现在跑一趟。
  final bool worthGoing;

  @override
  bool operator ==(Object other) =>
      other is TeabreakStatus &&
      other.freshness == freshness &&
      other.sinceLastConfirmMs == sinceLastConfirmMs &&
      other.worthGoing == worthGoing;

  @override
  int get hashCode => Object.hash(freshness, sinceLastConfirmMs, worthGoing);

  @override
  String toString() => 'TeabreakStatus(${freshness.wire}, '
      'sinceLastConfirmMs=$sinceLastConfirmMs, worthGoing=$worthGoing)';
}

/// 算一条茶歇信息的当前状态。
///
/// 逐条对应契约 §4（顺序即优先级）：
///
/// | 条件 | freshness | worthGoing |
/// | --- | --- | --- |
/// | `now > teaEndsAt` | `over` | `false` |
/// | `now < teaStartsAt` | `notStarted` | `false` |
/// | 时间窗内 + 20 分钟内确认过 | `fresh` | `true` |
/// | 时间窗内 + 20 分钟没确认 | `stale` | `true` |
///
/// ⚠️ `stale` 也算「值得去」—— 判断标准不是「新鲜」，而是「时间窗内」。
/// 新鲜度只影响文案的确定性，因此 UI 必须把「可能还有」说清楚。
///
/// [now] 由调用方注入而不是读时钟：否则这个函数无法测试。
TeabreakStatus teabreakStatus(Teabreak teabreak, DateTime now) {
  final DateTime? lastConfirm = teabreak.lastConfirmedAt;
  final int? sinceLastConfirmMs = lastConfirm == null
      ? null
      : now.difference(lastConfirm).inMilliseconds;

  // 已过结束时间 → 一定没了（注意：恰好等于结束时刻仍算「窗口内」，与 TS 一致）。
  if (now.isAfter(teabreak.teaEndsAt)) {
    return TeabreakStatus(
      freshness: TeabreakFreshness.over,
      sinceLastConfirmMs: sinceLastConfirmMs,
      worthGoing: false,
    );
  }

  // 还没到开始时间。
  if (now.isBefore(teabreak.teaStartsAt)) {
    return TeabreakStatus(
      freshness: TeabreakFreshness.notStarted,
      sinceLastConfirmMs: sinceLastConfirmMs,
      worthGoing: false,
    );
  }

  // 时间窗内：看多久没被确认。从未确认过 = 不可信 = stale。
  final bool fresh = sinceLastConfirmMs != null &&
      sinceLastConfirmMs <= teabreakFreshnessMs;
  return TeabreakStatus(
    freshness: fresh ? TeabreakFreshness.fresh : TeabreakFreshness.stale,
    sinceLastConfirmMs: sinceLastConfirmMs,
    worthGoing: true,
  );
}

/* ------------------------------------------------------------------ *
 * 5. 排序（契约 `sortTeabreaks`）
 * ------------------------------------------------------------------ */

/// 按「值不值得现在跑一趟」排序，规则与契约**逐条一致**（依次比较）：
///
/// 1. `worthGoing` 为真的排前面；
/// 2. 同样值得去时，`fresh` 排在 `stale` 前面
///    （`notStarted` / `over` 用同一张 rank 表：0 / 1 / 2 / 3）；
/// 3. 同样新鲜度时，茶歇**结束得早**的排前面（快没了，先冲这个）；
/// 4. 最后按开始时间。
///
/// ⚠️ 最后再用**原始下标**兜底：Dart 的 `List.sort` **不保证稳定**，
/// 而 TS 的 `Array.prototype.sort` 是稳定的。没有这层兜底，完全相同的两条
/// 数据的相对顺序会在 Dart 侧随机漂移，与契约/Web/小程序不一致。
List<Teabreak> sortTeabreaks(List<Teabreak> teabreaks, DateTime now) {
  final List<int> order =
      List<int>.generate(teabreaks.length, (int index) => index);
  order.sort((int a, int b) {
    final TeabreakStatus sa = teabreakStatus(teabreaks[a], now);
    final TeabreakStatus sb = teabreakStatus(teabreaks[b], now);

    if (sa.worthGoing != sb.worthGoing) return sa.worthGoing ? -1 : 1;
    final int rankDiff = _freshnessRank(sa.freshness) -
        _freshnessRank(sb.freshness);
    if (rankDiff != 0) return rankDiff;

    // 同样值得去：结束得早的先冲。
    final int endCompare =
        teabreaks[a].teaEndsAt.compareTo(teabreaks[b].teaEndsAt);
    if (endCompare != 0) return endCompare;

    final int startCompare =
        teabreaks[a].teaStartsAt.compareTo(teabreaks[b].teaStartsAt);
    if (startCompare != 0) return startCompare;

    // 稳定排序：全部键相同 → 保留输入顺序。
    return a.compareTo(b);
  });
  return <Teabreak>[
    for (final int index in order) teabreaks[index],
  ];
}

int _freshnessRank(TeabreakFreshness freshness) => switch (freshness) {
      TeabreakFreshness.fresh => 0,
      TeabreakFreshness.stale => 1,
      TeabreakFreshness.notStarted => 2,
      TeabreakFreshness.over => 3,
    };

/* ------------------------------------------------------------------ *
 * 6. 草稿与校验（契约 §5）
 * ------------------------------------------------------------------ */

const int teabreakConferenceMin = 3;
const int teabreakConferenceMax = 80;
const int teabreakVenueMin = 2;
const int teabreakVenueMax = 60;

/// 茶歇窗口最短 10 分钟（再短就不是茶歇了）。
const int teabreakMinWindowMs = 10 * 60 * 1000;

/// 茶歇窗口最长 3 小时（再长说明填错了，或者那是午餐）。
const int teabreakMaxWindowMs = 3 * 60 * 60 * 1000;

/// 校验问题码（契约 `TeabreakDraftProblem`）。
///
/// 用**问题码**而不是布尔：UI 要给具体提示，而不是一句「格式不对」。
enum TeabreakDraftProblem {
  conferenceTooShort('conference-too-short'),
  conferenceTooLong('conference-too-long'),
  venueTooShort('venue-too-short'),
  venueTooLong('venue-too-long'),
  conferenceEndBeforeStart('conference-end-before-start'),
  teaWindowTooShort('tea-window-too-short'),
  teaWindowTooLong('tea-window-too-long'),
  teaOutsideConference('tea-outside-conference'),
  inThePast('in-the-past');

  const TeabreakDraftProblem(this.wire);

  /// 线上/日志用的稳定标识（与契约逐字一致）。
  final String wire;
}

/// 新建茶歇的草稿。
///
/// 契约的 `TeabreakDraftInput` 只含**校验**所需字段；这里额外带 [access] 与
/// [note]，因为创建表单要提交它们（校验规则仍然只看前六个字段）。
final class TeabreakDraft {
  const TeabreakDraft({
    required this.conferenceName,
    required this.venue,
    required this.conferenceStartsAt,
    required this.conferenceEndsAt,
    required this.teaStartsAt,
    required this.teaEndsAt,
    this.access = TeabreakAccess.unknown,
    this.note,
  });

  final String conferenceName;
  final String venue;
  final DateTime conferenceStartsAt;
  final DateTime conferenceEndsAt;
  final DateTime teaStartsAt;
  final DateTime teaEndsAt;
  final TeabreakAccess access;
  final String? note;

  Map<String, Object?> toJson() => <String, Object?>{
        'conferenceName': conferenceName.trim(),
        'venue': venue.trim(),
        'conferenceStartsAt': isoUtc(conferenceStartsAt),
        'conferenceEndsAt': isoUtc(conferenceEndsAt),
        'teaStartsAt': isoUtc(teaStartsAt),
        'teaEndsAt': isoUtc(teaEndsAt),
        'access': access.wire,
        if (note != null && note!.trim().isNotEmpty) 'note': note!.trim(),
      };

  @override
  String toString() =>
      'TeabreakDraft(${conferenceName.trim()} @${venue.trim()}, '
      '${access.wire})';
}

/// 校验草稿；返回问题列表（空 = 通过）。顺序与契约一致。
///
/// ⚠️ 与 TS 实现的唯一差异：TS 在 `Date.parse` 失败时补一个
/// `tea-window-too-short` 并提前返回；Dart 侧时间是 [DateTime]（类型上解析不了
/// 就进不到这里），因此那一支没有对应物。
List<TeabreakDraftProblem> validateTeabreakDraft(
  TeabreakDraft draft,
  DateTime now,
) {
  final List<TeabreakDraftProblem> problems = <TeabreakDraftProblem>[];

  final String name = draft.conferenceName.trim();
  final String venue = draft.venue.trim();
  // 注意：`String.length` 数的是 UTF-16 code unit，与 JS 的 `.length` 相同。
  if (name.length < teabreakConferenceMin) {
    problems.add(TeabreakDraftProblem.conferenceTooShort);
  }
  if (name.length > teabreakConferenceMax) {
    problems.add(TeabreakDraftProblem.conferenceTooLong);
  }
  if (venue.length < teabreakVenueMin) {
    problems.add(TeabreakDraftProblem.venueTooShort);
  }
  if (venue.length > teabreakVenueMax) {
    problems.add(TeabreakDraftProblem.venueTooLong);
  }

  if (!draft.conferenceEndsAt.isAfter(draft.conferenceStartsAt)) {
    problems.add(TeabreakDraftProblem.conferenceEndBeforeStart);
  }

  final int windowMs = draft.teaEndsAt.difference(draft.teaStartsAt).inMilliseconds;
  if (windowMs < teabreakMinWindowMs) {
    problems.add(TeabreakDraftProblem.teaWindowTooShort);
  }
  if (windowMs > teabreakMaxWindowMs) {
    problems.add(TeabreakDraftProblem.teaWindowTooLong);
  }

  // 茶歇必须在会议时间窗内（允许贴边）。
  if (draft.teaStartsAt.isBefore(draft.conferenceStartsAt) ||
      draft.teaEndsAt.isAfter(draft.conferenceEndsAt)) {
    problems.add(TeabreakDraftProblem.teaOutsideConference);
  }

  // 已经结束的会不能再发。
  if (draft.conferenceEndsAt.isBefore(now)) {
    problems.add(TeabreakDraftProblem.inThePast);
  }

  return problems;
}

/// 问题码 → 中文提示（契约 `describeTeabreakProblem`，文案逐字一致）。
String describeTeabreakProblem(TeabreakDraftProblem problem) =>
    switch (problem) {
      TeabreakDraftProblem.conferenceTooShort =>
        '会议名称至少 $teabreakConferenceMin 个字，要能认出来是哪个会',
      TeabreakDraftProblem.conferenceTooLong =>
        '会议名称最多 $teabreakConferenceMax 个字',
      TeabreakDraftProblem.venueTooShort => '地点至少 $teabreakVenueMin 个字，请写清楼和房间号',
      TeabreakDraftProblem.venueTooLong => '地点最多 $teabreakVenueMax 个字',
      TeabreakDraftProblem.conferenceEndBeforeStart => '会议结束时间必须晚于开始时间',
      TeabreakDraftProblem.teaWindowTooShort => '茶歇时间窗至少 10 分钟',
      TeabreakDraftProblem.teaWindowTooLong => '茶歇时间窗最多 3 小时（再长可能不是茶歇）',
      TeabreakDraftProblem.teaOutsideConference => '茶歇必须在会议时间之内',
      TeabreakDraftProblem.inThePast => '这个会议已经结束了，发出来也没人去',
    };

/* ------------------------------------------------------------------ *
 * 7. 文案（契约 §6）
 * ------------------------------------------------------------------ */

/// 把剩余时间说成人话（「还有 X 分钟结束」用的就是它）。
///
/// 与契约 `describeRemaining` 一致：四舍五入到分钟；不足 1 分钟单独一句。
String describeRemaining(DateTime endAt, DateTime now) {
  final int remainMs = endAt.difference(now).inMilliseconds;
  if (remainMs <= 0) return '已结束';

  // TS 用 Math.round；Dart 的 double.round() 同为「四舍五入（.5 远离 0）」。
  final int minutes = (remainMs / 60000).round();
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return '还有 $minutes 分钟';
  final int hours = minutes ~/ 60;
  final int rest = minutes % 60;
  return rest == 0 ? '还有 $hours 小时' : '还有 $hours 小时 $rest 分钟';
}

/// 把「多久没确认」说成人话（与契约 `describeSinceConfirm` 一致）。
String describeSinceConfirm(int? sinceMs) {
  if (sinceMs == null) return '还没有人确认';
  if (sinceMs < 60000) return '刚刚确认';
  final int minutes = sinceMs ~/ 60000;
  if (minutes < 60) return '$minutes 分钟前确认';
  final int hours = minutes ~/ 60;
  return '$hours 小时前确认';
}

/// 「还有 X 分钟结束」/「还有 X 分钟开始」/「已结束」。
///
/// 抽出这个函数而不是让页面各写一份：三种时效的措辞必须三端一致，
/// 而「还有 20 分钟」在没开始时会变成一句错话。
String describeTeabreakTiming(
  Teabreak teabreak,
  TeabreakStatus status,
  DateTime now,
) =>
    switch (status.freshness) {
      TeabreakFreshness.notStarted =>
        '${describeRemaining(teabreak.teaStartsAt, now)}开始',
      TeabreakFreshness.over => describeRemaining(teabreak.teaEndsAt, now),
      _ => '${describeRemaining(teabreak.teaEndsAt, now)}结束',
    };
