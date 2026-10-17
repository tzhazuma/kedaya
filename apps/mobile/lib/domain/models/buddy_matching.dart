/// `buddy` 匹配算法的 **Dart 侧镜像**。
///
/// ---
/// ## ⚠️ 镜像自 `packages/shared/src/buddy/scoring.ts`，改一处必须改两处
/// ---
///
/// `@kedaya/shared` 的 `buddy` 子模块是 **TypeScript**，Flutter 端无法 import。
/// 因此本文件镜像了它的**最小必要部分**：
///
/// | 本文件 | TS 侧 | 规格 |
/// | --- | --- | --- |
/// | [buddyRuleCoefficients] / [buddyRuleScoreFor] | `ruleScoreFor` | §3.3 的三板块系数表 |
/// | [buddyExplainMatch] | `explainMatch` | §5.7 的理由构造规则 |
/// | [buddyOverlapsAvailability] | `overlapsAvailability` | §3.3 的 F7（含跨零点） |
/// | [buddyFeedbackAdjustment] | `feedbackAdjustment` | §3.6 的反馈与衰减 |
///
/// **系数与理由文案以 `docs/features/buddy-matching.md` §3.3 / §5.7 为唯一真相**，
/// 并且与 TS 版**逐字一致**（`test/domain/buddy_matching_test.dart` 用文档里的
/// 数字机械校验本表，任何人手改系数都会让测试失败）。
///
/// ## 这份镜像**不是**客户端匹配引擎
///
/// 匹配的**权威实现**在服务端（`services/api/src/modules/buddy/`）。本端镜像它只为两件事：
///
/// 1. **`MockBuddyRepository` 在无后端时给出与线上一致的排序与理由**
///    （契约 §7 硬规则 4：必须有 mock adapter，让 UI 能在无后端时开发）；
/// 2. **本地可解释性**：客户端能对服务端返回的 `reason` 做一致性自查，
///    也能在没有服务端理由时（如 `rule` 降级）用同一套文案渲染。
///
/// 客户端**不**据此改写服务端给的 `score` / `reason`：展示以服务端为准，
/// 镜像只在 mock 与自查里生效。`matchMode` 也**始终**来自服务端（§5.7「必须暴露」）。
///
/// ## 文档未逐字指定的两处绑定（**已上报，见 feature README §6**）
///
/// `ruleScoreFor(section, me, post, creatorProfile)` 的两个入参来源，规格只写了
/// 特征名、没写取自谁。本端按「推荐单位是**帖子**」（§3.6 D2）来绑定：
///
/// | 特征 | 本端绑定 | 理由 |
/// | --- | --- | --- |
/// | 共同 `activityTags` | `me.activityTags` ∩ **`post.tags`** | §2.3 说 `post.tags` 是「匹配打分的**主特征**」；活动标签描述的是"这场活动是什么" |
/// | 共同 `interestTags` | `me.interestTags` ∩ `creatorProfile.interestTags` | 兴趣是**人**的属性，帖子没有这个字段 |
/// | 同 `department` | `me.department` == `creatorProfile.department` | 院系是人的属性（§3.3「同院系」） |
/// | 同 `skillLevel` | `me.skillLevel` == `creatorProfile.skillLevel` | §2.3 明确 `minSkillLevel` 是**硬过滤**、不是打分，所以软分的「水平相同」只能是人比人 |
/// | 同 `preferredAreas` | `me.preferredAreas` ∩ `creatorProfile.preferredAreas` | 帖子只有单个 `location`，没有「常去区域」 |
/// | 时段重叠（`daily` 的 +0.2） | [buddyOverlapsAvailability]`(me.availability, post.startsAt, post.durationMin)` | 规格 §3.3 给这条的注解是「**非硬过滤时的软分**」——就是 F7 的同一个信号，只是当软分用 |
library;

import 'buddy.dart';
import 'buddy_profile.dart';
import 'buddy_tags.dart';
import 'json_read.dart';

// ------------------------------------------------------------------ 常量

/// 一天 1440 分钟。
const int buddyMinutesPerDay = 1440;

/// 推荐列表最多拼接几条理由（规格 §5.7「取前 3 条拼接」）。
const int buddyReasonMaxCount = 3;

/// 「共同兴趣：A,B,C」里最多列几个（规格 §5.7「最多 3 个，对齐 `matching.py:282`」）。
const int buddyReasonTagMaxCount = 3;

/// 无任何规则命中时的回落文案（规格 §5.7，对齐 `matching.py:299-301`）。
const String buddyFallbackReason = '有潜在匹配';

/// 没有匹配资料时的统一理由（规格 §5.7）。
const String buddyTimeSortedReason = '按时间排序';

// ------------------------------------------------------------------ 规则种类

/// 软打分的规则种类（规格 §3.3 的「规则」列）。
enum BuddyRuleKind {
  sameDepartment('同院系'),
  commonInterestTags('共同兴趣'),
  commonActivityTags('共同活动'),
  availabilityOverlap('时间合适'),
  samePreferredArea('常去同一区域'),
  sameSkillLevel('运动水平相同');

  const BuddyRuleKind(this.label);

  final String label;
}

/// §3.3 表里的一行系数。
///
/// `scoreFor(hits)` 就是 `min(cap, perHit × hits)`；固定加分的行 `cap == perHit`。
final class BuddyRuleCoefficient {
  const BuddyRuleCoefficient({
    required this.kind,
    required this.perHit,
    required this.cap,
  });

  final BuddyRuleKind kind;

  /// 每命中一项的加分。
  final double perHit;

  /// 上限（固定加分时与 [perHit] 相等）。
  final double cap;

  /// 固定加分（不分命中项数）。
  bool get isFlat => perHit == cap;

  double scoreFor(int hits) {
    if (hits <= 0) return 0;
    final double raw = perHit * hits;
    return raw > cap ? cap : raw;
  }

  @override
  String toString() => '${kind.name}(+$perHit, cap=$cap)';
}

/// **三板块的软打分系数表 —— 逐字镜像规格 §3.3。**
///
/// 每个板块的列表顺序 = 规格 §3.3 的表格行顺序 = **理由的输出顺序**
/// （理由顺序有实证：§5.7 的示例 `"运动水平相同、共同活动：羽毛球、常去同一区域"`
/// 正是 `sport` 板块按 §3.3 行序输出的前 3 条）。
///
/// | 板块 | 规则 | 加分 |
/// | --- | --- | --- |
/// | `academic` | 同 `department` | `+0.4` |
/// | `academic` | 共同 `interestTags` | `+min(0.3, 0.10 × n)` |
/// | `academic` | 共同 `activityTags` | `+0.1` |
/// | `daily` | 共同 `interestTags` | `+min(0.5, 0.15 × n)` |
/// | `daily` | 可用时段重叠 | `+0.2` |
/// | `daily` | 同 `preferredAreas` | `+0.1` |
/// | `sport` | `skillLevel` 相同 | `+0.3` |
/// | `sport` | 共同 `activityTags` | `+min(0.4, 0.15 × n)` |
/// | `sport` | 共同 `interestTags` | `+min(0.2, 0.10 × n)` |
/// | `sport` | 同 `preferredAreas` | `+0.1` |
///
/// **刻意不含**的两条（规格 §3.3 的删除项）：
///   - ~~同学校 `+0.2`~~ —— 单校部署下恒为真、零信息量（§3.3 关键适配 1）；
///   - ~~同学历~~ —— 我们无 `education_level`（在 `profile` 模块，不复制）。
///
/// **规则分上限**：`academic` 0.8 / `daily` 0.8 / `sport` 1.0，融合前必须
/// `clamp(ruleScore, 0, 1)`（§3.3 末段）。
const Map<BuddySection, List<BuddyRuleCoefficient>> buddyRuleCoefficients =
    <BuddySection, List<BuddyRuleCoefficient>>{
  BuddySection.academic: <BuddyRuleCoefficient>[
    BuddyRuleCoefficient(
        kind: BuddyRuleKind.sameDepartment, perHit: 0.4, cap: 0.4),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.commonInterestTags,
      perHit: 0.10,
      cap: 0.30,
    ),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.commonActivityTags,
      perHit: 0.1,
      cap: 0.1,
    ),
  ],
  BuddySection.daily: <BuddyRuleCoefficient>[
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.commonInterestTags,
      perHit: 0.15,
      cap: 0.50,
    ),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.availabilityOverlap,
      perHit: 0.2,
      cap: 0.2,
    ),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.samePreferredArea,
      perHit: 0.1,
      cap: 0.1,
    ),
  ],
  BuddySection.sport: <BuddyRuleCoefficient>[
    BuddyRuleCoefficient(
        kind: BuddyRuleKind.sameSkillLevel, perHit: 0.3, cap: 0.3),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.commonActivityTags,
      perHit: 0.15,
      cap: 0.40,
    ),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.commonInterestTags,
      perHit: 0.10,
      cap: 0.20,
    ),
    BuddyRuleCoefficient(
      kind: BuddyRuleKind.samePreferredArea,
      perHit: 0.1,
      cap: 0.1,
    ),
  ],
};

/// 取某板块的系数行（`unknown` 板块没有任何规则 → 空列表）。
List<BuddyRuleCoefficient> buddyCoefficientsFor(BuddySection section) =>
    buddyRuleCoefficients[section] ?? const <BuddyRuleCoefficient>[];

// ------------------------------------------------------------------ 时段重叠

/// 规格 §3.3 的 F7：活动时间窗是否落在我的任一可用时段内（**纯函数，无 IO**）。
///
/// TS 版（逐行对应）：
///
/// ```ts
/// const local = toZonedTime(startsAt, tz);
/// const dow = local.getDay();
/// const start = local.getHours() * 60 + local.getMinutes();
/// const end = start + durationMin;
/// return availability.some((a) => a.dow === dow && a.startMin < end && start < a.endMin);
/// ```
///
/// **跨零点**（规格 §3.3 的注解）：`end > 1440` 时活动延续到次日，
/// 同时检查 `dow + 1` 的时段，窗口为 `[start − 1440, end − 1440)`。
/// 这与 TS 版「把 `end` 直接当绝对分钟数比较」等价：负的下界对所有
/// `endMin >= 0` 恒真，因此次日只剩 `slot.startMin < end − 1440` 这一个条件。
///
/// `availability` 为空 → `false`（**不能**把"没填时段"当成"随时都行"）。
bool buddyOverlapsAvailability(
  List<AvailabilitySlot> availability,
  DateTime startsAt,
  int durationMin, {
  Duration tzOffset = buddyShanghaiUtcOffset,
}) {
  if (availability.isEmpty || durationMin <= 0) return false;
  final DateTime local = startsAt.toUtc().add(tzOffset);
  // Dart: 周一 = 1 … 周日 = 7；JS getDay(): 周日 = 0 … 周六 = 6。
  // `weekday % 7` 正好把两者对齐（周日 7 → 0）。
  final int dow = local.weekday % 7;
  final int start = local.hour * 60 + local.minute;
  final int end = start + durationMin;

  if (_slotWindowOverlaps(availability, dow, start, end)) return true;
  if (end > buddyMinutesPerDay) {
    return _slotWindowOverlaps(
      availability,
      (dow + 1) % 7,
      start - buddyMinutesPerDay,
      end - buddyMinutesPerDay,
    );
  }
  return false;
}

bool _slotWindowOverlaps(
  List<AvailabilitySlot> slots,
  int dow,
  int windowStart,
  int windowEnd,
) {
  for (final AvailabilitySlot slot in slots) {
    if (slot.dow != dow) continue;
    if (slot.startMin < windowEnd && windowStart < slot.endMin) return true;
  }
  return false;
}

/// 两份可用时段是否有交集（人 vs 人的时段重叠）。
///
/// 规格 §3.3 只给了「活动窗口 vs 我的时段」的判定；本函数是它在
/// "两个人的时段表"上的对偶，供 UI 提示用（**不参与 §3.3 的打分**）。
bool buddyAvailabilityIntersects(
  List<AvailabilitySlot> a,
  List<AvailabilitySlot> b,
) {
  for (final AvailabilitySlot left in a) {
    for (final AvailabilitySlot right in b) {
      if (left.dow != right.dow) continue;
      if (left.startMin < right.endMin && right.startMin < left.endMin)
        return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ 规则分

/// 一次 `ruleScoreFor` 用到的全部信号（命中的标签 key 也保留，供理由渲染与测试）。
final class BuddyRuleSignals {
  const BuddyRuleSignals({
    this.sameDepartment = false,
    this.commonInterestTags = const <String>[],
    this.commonActivityTags = const <String>[],
    this.availabilityOverlaps = false,
    this.samePreferredArea = false,
    this.sameSkillLevel = false,
  });

  final bool sameDepartment;

  /// 共同兴趣标签（**key**，渲染时转显示名）。
  final List<String> commonInterestTags;

  /// 共同活动标签（**key**）。
  final List<String> commonActivityTags;

  final bool availabilityOverlaps;
  final bool samePreferredArea;
  final bool sameSkillLevel;

  /// 某条规则的"命中数"（`0` 表示未命中）。
  int hitsFor(BuddyRuleKind kind) => switch (kind) {
        BuddyRuleKind.sameDepartment => sameDepartment ? 1 : 0,
        BuddyRuleKind.commonInterestTags => commonInterestTags.length,
        BuddyRuleKind.commonActivityTags => commonActivityTags.length,
        BuddyRuleKind.availabilityOverlap => availabilityOverlaps ? 1 : 0,
        BuddyRuleKind.samePreferredArea => samePreferredArea ? 1 : 0,
        BuddyRuleKind.sameSkillLevel => sameSkillLevel ? 1 : 0,
      };
}

/// `ruleScoreFor` 的结果：分数 + 信号 + 中文理由。
final class BuddyRuleScore {
  const BuddyRuleScore({
    required this.score,
    required this.signals,
    required this.reason,
  });

  /// 已 `clamp(0, 1)`（规格 §3.3 末段要求）。
  final double score;

  final BuddyRuleSignals signals;

  /// 中文理由，**一定非空**（§5.7：无命中时回落 [buddyFallbackReason]）。
  final String reason;

  @override
  String toString() => 'BuddyRuleScore(${score.toStringAsFixed(3)}, "$reason")';
}

/// 计算两个 profile 的共同标签（保序：以 [mine] 的顺序为准）。
List<String> _commonTags(List<String> mine, List<String> theirs) {
  if (mine.isEmpty || theirs.isEmpty) return const <String>[];
  return mine.where(theirs.contains).toList(growable: false);
}

/// 从三份输入抽取 [BuddyRuleSignals]（纯函数，无 IO）。
///
/// 各特征的绑定见文件头「文档未逐字指定的两处绑定」表。
BuddyRuleSignals buddyRuleSignalsFor({
  required BuddyPost post,
  required BuddyProfile me,
  required BuddyProfile creatorProfile,
}) =>
    BuddyRuleSignals(
      sameDepartment: me.department != null &&
          me.department!.trim().isNotEmpty &&
          me.department!.trim() == creatorProfile.department?.trim(),
      commonInterestTags:
          _commonTags(me.interestTags, creatorProfile.interestTags),
      commonActivityTags: _commonTags(me.activityTags, post.tags),
      availabilityOverlaps: post.durationMin != null &&
          buddyOverlapsAvailability(
              me.availability, post.startsAt, post.durationMin!),
      samePreferredArea:
          _commonTags(me.preferredAreas, creatorProfile.preferredAreas)
              .isNotEmpty,
      sameSkillLevel: me.skillLevel == creatorProfile.skillLevel,
    );

/// `ruleScoreFor(section, me, post, creatorProfile)` —— 规格 §3.3 的软打分。
///
/// 返回值**已经** `clamp(0, 1)`：三板块的规则分之和可能超过 1.0
/// （`academic` 最高 0.8、`daily` 0.8、`sport` 1.0），融合前必须收敛，
/// 否则 `0.30` 的权重会被放大（§3.3 末段 + §8.2 T12）。
///
/// `section` 用 [BuddySection.unknown] 调用时得分恒为 0、理由为回落文案
/// —— 未登记的板块**不参与打分**（契约 §11.10-G）。
BuddyRuleScore buddyRuleScoreFor({
  required BuddySection section,
  required BuddyPost post,
  required BuddyProfile me,
  required BuddyProfile creatorProfile,
}) {
  final List<BuddyRuleCoefficient> rows = buddyCoefficientsFor(section);
  if (rows.isEmpty) {
    return const BuddyRuleScore(
      score: 0,
      signals: BuddyRuleSignals(),
      reason: buddyFallbackReason,
    );
  }
  final BuddyRuleSignals signals = buddyRuleSignalsFor(
    post: post,
    me: me,
    creatorProfile: creatorProfile,
  );
  double total = 0;
  for (final BuddyRuleCoefficient row in rows) {
    total += row.scoreFor(signals.hitsFor(row.kind));
  }
  return BuddyRuleScore(
    score: buddyClamp01(total),
    signals: signals,
    reason: buddyExplainMatch(section: section, signals: signals),
  );
}

/// `explainMatch` —— 规格 §5.7 的中文理由构造。
///
/// 规则：
///   - 按板块的 §3.3 行序输出**命中的**理由；
///   - 取前 [buddyReasonMaxCount] 条，用 `、` 拼接；
///   - 一条都没命中 → [buddyFallbackReason]。
///
/// | 命中 | 文案 |
/// | --- | --- |
/// | 同 `department` | `同院系` |
/// | 共同 `interestTags` | `共同兴趣：A,B,C`（最多 3 个） |
/// | 共同 `activityTags` | `共同活动：A,B` |
/// | 同时段可用 | `时间合适` |
/// | 同 `preferredAreas` | `常去同一区域` |
/// | 同 `skillLevel` | `运动水平相同` |
/// | 无命中 | `有潜在匹配` |
String buddyExplainMatch({
  required BuddySection section,
  required BuddyRuleSignals signals,
}) {
  final List<BuddyRuleCoefficient> rows = buddyCoefficientsFor(section);
  final List<String> reasons = <String>[];
  for (final BuddyRuleCoefficient row in rows) {
    if (signals.hitsFor(row.kind) <= 0) continue;
    reasons.add(_reasonTextFor(row.kind, signals));
    if (reasons.length >= buddyReasonMaxCount) break;
  }
  if (reasons.isEmpty) return buddyFallbackReason;
  return reasons.join('、');
}

String _reasonTextFor(BuddyRuleKind kind, BuddyRuleSignals signals) =>
    switch (kind) {
      BuddyRuleKind.sameDepartment => '同院系',
      BuddyRuleKind.commonInterestTags =>
        '共同兴趣：${_tagLabels(signals.commonInterestTags)}',
      BuddyRuleKind.commonActivityTags =>
        '共同活动：${_tagLabels(signals.commonActivityTags)}',
      BuddyRuleKind.availabilityOverlap => '时间合适',
      BuddyRuleKind.samePreferredArea => '常去同一区域',
      BuddyRuleKind.sameSkillLevel => '运动水平相同',
    };

/// key → 显示名，最多 [buddyReasonTagMaxCount] 个，`,` 分隔（§5.7 的 `A,B,C`）。
String _tagLabels(List<String> keys) {
  final Iterable<String> head = keys.take(buddyReasonTagMaxCount);
  return head.map(buddyTagLabel).join(',');
}

// ------------------------------------------------------------------ 融合

/// 匹配模式（规格 §3.5 / §5.7）。**必须暴露给客户端**，让 UI 能诚实展示。
enum BuddyMatchMode {
  /// 真 embedding 余弦 + 规则（需 pgvector + 模型）。
  vector('vector', '向量 + 规则'),

  /// 哈希向量余弦 + 规则（无模型时的降级档）。
  ///
  /// 规格 §3.1 的警告：哈希向量**不是语义向量**，是"带位置扰动的字符袋哈希"，
  /// 因此**不得**对外声称语义相似。
  hash('hash', '哈希向量 + 规则（降级）'),

  /// 仅规则分（无 pgvector / 无 embedding 列时的降级档）。
  rule('rule', '仅规则（降级）'),

  /// 服务端下发了未登记的模式。
  unknown('unknown', '未知');

  const BuddyMatchMode(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyMatchMode fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddyMatchMode value in BuddyMatchMode.values) {
      if (value != BuddyMatchMode.unknown && value.wire == normalized)
        return value;
    }
    return BuddyMatchMode.unknown;
  }

  /// 是否是降级档（UI 据此避免"为你智能推荐"这类措辞，§5.7）。
  bool get isDegraded => this != BuddyMatchMode.vector;

  /// 诚实的展示文案。**`rule` / `unknown` 下不得声称"智能推荐"**。
  String get notice => switch (this) {
        BuddyMatchMode.vector => '为你智能推荐',
        BuddyMatchMode.hash => '按标签与时段推荐（当前为哈希降级，非语义模型）',
        BuddyMatchMode.rule => '按标签与时段排序（当前无向量能力，不是智能推荐）',
        BuddyMatchMode.unknown => '推荐模式未知，结果仅供参考',
      };
}

/// 融合公式（规格 §3.4）。
///
/// - 模式 A（`vector`）/ 模式 B（`hash`）：`baseScore × 0.70 + ruleScore × 0.30`。
///   规格 §3.4 明确：`towerScore` **恒为 `None`**（我们不做双塔），
///   于是实际公式与 STUMatch 的 "no tower" 分支（`matching.py:441`）逐字一致。
/// - 模式 C（`rule`）：`ruleScore × 1.0`（`baseScore` 权重归零）。
/// - 最后 `+ feedbackAdjustment` 并 `clamp(0, 1)`。
double buddyFinalScore({
  required BuddyMatchMode mode,
  required double ruleScore,
  double baseScore = 0,
  double feedbackAdjustment = 0,
}) {
  final double clampedRule = buddyClamp01(ruleScore);
  final double fused = switch (mode) {
    BuddyMatchMode.rule || BuddyMatchMode.unknown => clampedRule,
    BuddyMatchMode.vector ||
    BuddyMatchMode.hash =>
      buddyClamp01(baseScore) * 0.70 + clampedRule * 0.30,
  };
  return buddyClamp01(fused + feedbackAdjustment);
}

/// `clamp(x, 0, 1)`。
double buddyClamp01(double value) {
  if (value.isNaN) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/// 保留 3 位小数（规格 §5.7，对齐 `matching.py:466` 的 `round(score, 3)`）。
double buddyRound3(double value) => (value * 1000).roundToDouble() / 1000;

/// 纯 `dart:core` 的 `exp(-x)`。
///
/// **为什么手写**：契约 §7 硬规则 1 要求 `domain` 层只允许 `dart:core`，
/// 而本仓库的 `tool/selfcheck.py` 据此把 `dart:math` 也判为违规
/// （与 `lib/domain/models/geo.dart` 手写 `cos` / `sqrt` 同理）。
///
/// 实现：范围归约 `x = k·ln2 + r`（`r ∈ [0, ln2)`）+ 14 项泰勒级数 +
/// `2^-k` 逐次减半。实测最大**相对**误差 ~2e-14（`x ∈ [0, 200]`），
/// 由 `test/domain/buddy_matching_test.dart` 用独立算出的期望值锁定。
double buddyExpNeg(double x) {
  if (x.isNaN) return double.nan;
  if (x <= 0) return 1;
  if (x > 700) return 0;
  final int k = (x / _ln2).floor();
  final double r = x - k * _ln2;
  double term = 1;
  double sum = 1;
  for (int i = 1; i <= 14; i++) {
    term *= -r / i;
    sum += term;
  }
  double scale = 1;
  for (int i = 0; i < k; i++) {
    scale *= 0.5;
  }
  return sum * scale;
}

const double _ln2 = 0.6931471805599453;

// ------------------------------------------------------------------ 反馈

/// 反馈动作（规格 §2.5：与 STUMatch 同名同义）。
enum BuddyMatchFeedbackAction {
  like('like', '喜欢'),
  dislike('dislike', '不感兴趣'),
  skip('skip', '跳过');

  const BuddyMatchFeedbackAction(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyMatchFeedbackAction? tryFromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final BuddyMatchFeedbackAction value
        in BuddyMatchFeedbackAction.values) {
      if (value.wire == normalized) return value;
    }
    return null;
  }
}

/// 反馈权重（规格 §3.6，对齐 `matching.py:367-371`）。
const Map<BuddyMatchFeedbackAction, double> buddyFeedbackActionWeights =
    <BuddyMatchFeedbackAction, double>{
  BuddyMatchFeedbackAction.like: 0.20,
  BuddyMatchFeedbackAction.dislike: -0.30,
  BuddyMatchFeedbackAction.skip: -0.05,
};

/// 半衰期（天）（规格 §3.6，对齐 `matching.py:366`）。
const double buddyFeedbackHalflifeDays = 30;

/// 一条匹配反馈（规格 §2.5）。
///
/// **反馈目标是帖子，不是人**（规格 §2.5 / §3.6 D10）：对"这个人"表达不喜欢
/// 会变成对同学的隐性评价（且会泄漏为"我被某人踩过"），对"这个活动"表达
/// 不感兴趣则是无害的。
///
/// **唯一约束** `@@unique([userId, targetPostId, section])` —— 同一板块内对同一
/// 帖子的反馈可覆盖（UPSERT），避免刷反馈（规格 §2.5 / §3.6 D11）。
final class BuddyMatchFeedback {
  const BuddyMatchFeedback({
    required this.userId,
    required this.targetPostId,
    required this.section,
    required this.action,
    required this.createdAt,
  });

  factory BuddyMatchFeedback.fromJson(Map<String, Object?> json) =>
      BuddyMatchFeedback(
        userId: readStringOr(json, 'userId', ''),
        targetPostId: readString(json, 'targetPostId'),
        // 未登记板块（含 `dating`）收敛为 `unknown`：它**不参与任何板块的反馈隔离**，
        // 因此永远不会被错误地应用到某个真实板块上。
        section:
            BuddySection.fromWire(readStringOr(json, 'section', 'unknown')),
        action: BuddyMatchFeedbackAction.tryFromWire(
                readStringOr(json, 'action', 'skip')) ??
            BuddyMatchFeedbackAction.skip,
        createdAt: readDateTime(json, 'createdAt'),
      );

  final String userId;
  final String targetPostId;

  /// 反馈发生的板块。**隔离维度**（规格 §3.6）：`academic` 的 dislike
  /// **不**影响该帖在 `daily` 的分数（§8.2 T6）。
  final BuddySection section;

  final BuddyMatchFeedbackAction action;
  final DateTime createdAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'userId': userId,
        'targetPostId': targetPostId,
        'section': section.wire,
        'action': action.wire,
        'createdAt': isoUtc(createdAt),
      };

  @override
  String toString() =>
      'BuddyMatchFeedback($targetPostId, ${section.wire}, ${action.wire})';
}

/// `feedbackAdjustment` —— 规格 §3.6（对齐 `matching.py:349-381`）。
///
/// ```
/// decay = exp(-days / 30)
/// adjustments[targetPostId] = weight(action) × decay
/// ```
///
/// 同一帖子多次反馈**取最后一次**（`Map` 覆盖；DB 侧由唯一约束保证）。
/// **必须保证 section 隔离**：调用方传入的 [feedbacks] 必须已经按
/// `WHERE section = $section` 过滤过（规格 §3.6 的加粗要求）。
Map<String, double> buddyFeedbackAdjustment(
  List<BuddyMatchFeedback> feedbacks,
  DateTime now,
) {
  final Map<String, double> out = <String, double>{};
  for (final BuddyMatchFeedback feedback in feedbacks) {
    final double delta = buddyFeedbackActionWeights[feedback.action] ?? 0;
    final double rawDays =
        now.toUtc().difference(feedback.createdAt.toUtc()).inMilliseconds /
            86400000.0;
    final double days = rawDays < 0 ? 0 : rawDays;
    final double decay = buddyExpNeg(days / buddyFeedbackHalflifeDays);
    out[feedback.targetPostId] = delta * decay;
  }
  return out;
}

// ------------------------------------------------------------------ 推荐

/// 推荐查询（规格 §5.7）。
final class BuddyRecommendQuery {
  const BuddyRecommendQuery({
    required this.section,
    this.limit = defaultBuddyRecommendLimit,
    this.cursor,
  });

  /// **必填**（规格 §5.7：缺 `section` → `VALIDATION_FAILED`）。
  final BuddySection section;

  final int limit;
  final String? cursor;

  bool get isSectionValid => section.isMatchable;

  Map<String, Object?> toQuery() => <String, Object?>{
        'section': section.wire,
        'limit': limit < 1
            ? 1
            : (limit > maxBuddyRecommendLimit ? maxBuddyRecommendLimit : limit),
        if (cursor != null && cursor!.isNotEmpty) 'cursor': cursor,
      };
}

/// 一条推荐：帖子 + 分数 + **中文理由**（规格 §5.7）。
///
/// 规格 §1.1 G3：推荐必须是**可解释**的 —— 每条推荐必须给出中文理由，
/// 不允许只给分数。因此 [reason] 在构造时就被断言非空（见 `assert`）。
final class BuddyRecommendation {
  const BuddyRecommendation({
    required this.post,
    required this.score,
    required this.reason,
  }) : assert(reason != '', '规格 §5.7：reason 必须非空');

  factory BuddyRecommendation.fromJson(Map<String, Object?> json) {
    final Map<String, Object?>? postJson = readMapOrNull(json, 'post');
    final Map<String, Object?> source = postJson ?? json;
    final String reason = readStringOr(json, 'reason', buddyFallbackReason);
    return BuddyRecommendation(
      post: BuddyPost.fromJson(source),
      score: readDoubleOr(json, 'score', 0),
      reason: reason.isEmpty ? buddyFallbackReason : reason,
    );
  }

  final BuddyPost post;

  /// 0.0000–1.0000（服务端保留 3 位小数，§5.7）。
  final double score;

  /// 中文理由，**必须非空**。
  final String reason;

  /// 百分制展示（UI 用），保留整数。
  int get percent => (buddyClamp01(score) * 100).round();

  Map<String, Object?> toJson() => <String, Object?>{
        'post': post.toJson(),
        'score': score,
        'reason': reason,
      };

  @override
  String toString() =>
      'BuddyRecommendation(${post.id}, ${score.toStringAsFixed(3)}, "$reason")';
}

/// 推荐结果页（`matchMode` 是响应级字段，见规格 §5.7）。
final class BuddyRecommendationPage {
  const BuddyRecommendationPage({
    required this.items,
    required this.matchMode,
    this.nextCursor,
  });

  factory BuddyRecommendationPage.fromJson(Map<String, Object?> json) {
    final String mode = readStringOr(json, 'matchMode', 'rule');
    final BuddyMatchMode parsed = BuddyMatchMode.fromWire(mode);
    final List<BuddyRecommendation> items = readListOrEmpty(json, 'items')
        .where((Object? item) =>
            item is Map<Object?, Object?> || item is Map<String, Object?>)
        .map(
          (Object? item) => BuddyRecommendation.fromJson(
            requireJsonMap(item, what: 'recommendations[] 元素'),
          ),
        )
        .toList(growable: false);
    return BuddyRecommendationPage(
      items: items,
      matchMode:
          parsed == BuddyMatchMode.unknown ? BuddyMatchMode.rule : parsed,
      nextCursor: readStringOrNull(json, 'nextCursor'),
    );
  }

  final List<BuddyRecommendation> items;
  final BuddyMatchMode matchMode;
  final String? nextCursor;

  bool get isEmpty => items.isEmpty;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
        'matchMode': matchMode.wire,
        'items': items
            .map((BuddyRecommendation item) => item.toJson())
            .toList(growable: false),
        'nextCursor': nextCursor,
      };

  @override
  String toString() =>
      'BuddyRecommendationPage(${items.length} items, ${matchMode.wire})';
}
