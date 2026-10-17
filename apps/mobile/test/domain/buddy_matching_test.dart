import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';

/// `buddy` 匹配算法镜像的守门测试。
///
/// **这个文件的第一组测试是「系数与文档一致」的机械校验**：
/// `docs/features/buddy-matching.md` §3.3 的表格是唯一真相，
/// 表里的每个数字都在下面逐字写死 —— 谁手改了系数，这里立刻红。
void main() {
  BuddyPost post({
    BuddyActivity activity = BuddyActivity.sport,
    List<String> tags = const <String>[],
    DateTime? startsAt,
    int? durationMin,
    BuddySkillLevel? minSkillLevel,
    String creatorId = 'u-9999',
  }) =>
      BuddyPost(
        id: 'bp-test',
        activity: activity,
        title: '测试活动',
        location: '体育馆',
        startsAt: startsAt ?? DateTime.utc(2026, 10, 19, 12),
        capacity: 4,
        creator: BuddyCreator(id: creatorId),
        tags: tags,
        durationMin: durationMin,
        minSkillLevel: minSkillLevel,
      );

  BuddyProfile profile({
    List<String> interestTags = const <String>[],
    List<String> activityTags = const <String>[],
    List<String> preferredAreas = const <String>[],
    List<AvailabilitySlot> availability = const <AvailabilitySlot>[],
    BuddySkillLevel skillLevel = BuddySkillLevel.casual,
    String? department,
    bool matchEnabled = true,
  }) =>
      BuddyProfile(
        userId: 'u-me',
        sections: const <BuddySection>[BuddySection.sport],
        interestTags: interestTags,
        activityTags: activityTags,
        preferredAreas: preferredAreas,
        availability: availability,
        skillLevel: skillLevel,
        department: department,
        matchEnabled: matchEnabled,
      );

  BuddyRuleCoefficient row(BuddySection section, BuddyRuleKind kind) =>
      buddyCoefficientsFor(section).firstWhere(
        (BuddyRuleCoefficient item) => item.kind == kind,
      );

  // ---------------------------------------------------------------- 系数表

  group('§3.3 系数表与文档逐字一致', () {
    test('academic：同院系 +0.4 / 兴趣 +min(0.3, 0.10n) / 活动 +0.1，且没有「同学校」', () {
      final List<BuddyRuleCoefficient> rows = buddyCoefficientsFor(
        BuddySection.academic,
      );
      expect(rows, hasLength(3), reason: '§3.3 明确删除了「同学校 +0.2」');

      expect(
          row(BuddySection.academic, BuddyRuleKind.sameDepartment).perHit, 0.4);
      expect(row(BuddySection.academic, BuddyRuleKind.sameDepartment).cap, 0.4);

      final BuddyRuleCoefficient interest = row(
        BuddySection.academic,
        BuddyRuleKind.commonInterestTags,
      );
      expect(interest.perHit, closeTo(0.10, 1e-12));
      expect(interest.cap, closeTo(0.30, 1e-12));

      final BuddyRuleCoefficient activity = row(
        BuddySection.academic,
        BuddyRuleKind.commonActivityTags,
      );
      expect(activity.perHit, closeTo(0.1, 1e-12));
      expect(activity.cap, closeTo(0.1, 1e-12));
    });

    test('daily：兴趣 +min(0.5, 0.15n) / 时段重叠 +0.2 / 同区域 +0.1（没有「年龄差」）', () {
      final List<BuddyRuleCoefficient> rows =
          buddyCoefficientsFor(BuddySection.daily);
      expect(rows, hasLength(3));

      final BuddyRuleCoefficient interest = row(
        BuddySection.daily,
        BuddyRuleKind.commonInterestTags,
      );
      expect(interest.perHit, closeTo(0.15, 1e-12));
      expect(interest.cap, closeTo(0.50, 1e-12));

      final BuddyRuleCoefficient overlap = row(
        BuddySection.daily,
        BuddyRuleKind.availabilityOverlap,
      );
      expect(overlap.perHit, closeTo(0.2, 1e-12));
      expect(overlap.cap, closeTo(0.2, 1e-12));

      expect(
        row(BuddySection.daily, BuddyRuleKind.samePreferredArea).perHit,
        closeTo(0.1, 1e-12),
      );
    });

    test('sport：水平 +0.3 / 活动 +min(0.4, 0.15n) / 兴趣 +min(0.2, 0.10n) / 同区域 +0.1',
        () {
      final List<BuddyRuleCoefficient> rows =
          buddyCoefficientsFor(BuddySection.sport);
      expect(rows, hasLength(4));

      expect(
        row(BuddySection.sport, BuddyRuleKind.sameSkillLevel).perHit,
        closeTo(0.3, 1e-12),
      );

      final BuddyRuleCoefficient activity = row(
        BuddySection.sport,
        BuddyRuleKind.commonActivityTags,
      );
      expect(activity.perHit, closeTo(0.15, 1e-12));
      expect(activity.cap, closeTo(0.40, 1e-12));

      final BuddyRuleCoefficient interest = row(
        BuddySection.sport,
        BuddyRuleKind.commonInterestTags,
      );
      expect(interest.perHit, closeTo(0.10, 1e-12));
      expect(interest.cap, closeTo(0.20, 1e-12));

      expect(
        row(BuddySection.sport, BuddyRuleKind.samePreferredArea).perHit,
        closeTo(0.1, 1e-12),
      );
    });

    test('min(cap, perHit × n) 的取值与上限', () {
      final BuddyRuleCoefficient academic = row(
        BuddySection.academic,
        BuddyRuleKind.commonInterestTags,
      );
      expect(academic.scoreFor(0), 0);
      expect(academic.scoreFor(1), closeTo(0.10, 1e-12));
      expect(academic.scoreFor(2), closeTo(0.20, 1e-12));
      expect(academic.scoreFor(3), closeTo(0.30, 1e-12));
      expect(academic.scoreFor(9), closeTo(0.30, 1e-12), reason: '封顶 0.3');

      final BuddyRuleCoefficient daily = row(
        BuddySection.daily,
        BuddyRuleKind.commonInterestTags,
      );
      expect(daily.scoreFor(3), closeTo(0.45, 1e-12));
      expect(daily.scoreFor(4), closeTo(0.50, 1e-12));
      expect(daily.scoreFor(8), closeTo(0.50, 1e-12), reason: '封顶 0.5');

      final BuddyRuleCoefficient sportActivity = row(
        BuddySection.sport,
        BuddyRuleKind.commonActivityTags,
      );
      expect(sportActivity.scoreFor(2), closeTo(0.30, 1e-12));
      expect(sportActivity.scoreFor(3), closeTo(0.40, 1e-12),
          reason: '0.45 被封到 0.4');
    });

    test('三板块规则分上限分别是 0.8 / 0.8 / 1.0（§3.3 末段）', () {
      double maxOf(BuddySection section) => buddyCoefficientsFor(
            section,
          ).fold(
              0.0, (double sum, BuddyRuleCoefficient item) => sum + item.cap);

      expect(maxOf(BuddySection.academic), closeTo(0.8, 1e-12));
      expect(maxOf(BuddySection.daily), closeTo(0.8, 1e-12));
      expect(maxOf(BuddySection.sport), closeTo(1.0, 1e-12));
    });

    test('未登记板块没有任何规则（契约 §11.10-G：不参与打分）', () {
      expect(buddyCoefficientsFor(BuddySection.unknown), isEmpty);
      final BuddyRuleScore score = buddyRuleScoreFor(
        section: BuddySection.unknown,
        post: post(),
        me: profile(),
        creatorProfile: profile(),
      );
      expect(score.score, 0);
      expect(score.reason, buddyFallbackReason);
    });
  });

  // ---------------------------------------------------------------- 理由

  group('§5.7 explainMatch 的理由', () {
    test('sport 全命中时按 §3.3 行序输出，且与文档示例逐字一致', () {
      // 规格 §5.7 的示例响应：
      //   "reason": "运动水平相同、共同活动：羽毛球、常去同一区域"
      const BuddyRuleSignals signals = BuddyRuleSignals(
        sameSkillLevel: true,
        commonActivityTags: <String>['badminton'],
        samePreferredArea: true,
      );
      expect(
        buddyExplainMatch(section: BuddySection.sport, signals: signals),
        '运动水平相同、共同活动：羽毛球、常去同一区域',
      );
    });

    test('academic 按「同院系 → 共同兴趣 → 共同活动」输出，兴趣最多 3 个', () {
      const BuddyRuleSignals signals = BuddyRuleSignals(
        sameDepartment: true,
        commonInterestTags: <String>[
          'badminton',
          'programming',
          'movie',
          'pets'
        ],
        commonActivityTags: <String>['gym'],
      );
      expect(
        buddyExplainMatch(section: BuddySection.academic, signals: signals),
        '同院系、共同兴趣：羽毛球,编程,电影、共同活动：健身',
        reason: '只取前 3 条理由，且兴趣最多列 3 个（对齐 matching.py:282）',
      );
    });

    test('daily 按「共同兴趣 → 时间合适 → 常去同一区域」输出', () {
      const BuddyRuleSignals signals = BuddyRuleSignals(
        commonInterestTags: <String>['hotpot'],
        availabilityOverlaps: true,
        samePreferredArea: true,
      );
      expect(
        buddyExplainMatch(section: BuddySection.daily, signals: signals),
        '共同兴趣：火锅、时间合适、常去同一区域',
      );
    });

    test('一条都没命中时回落为「有潜在匹配」（对齐 matching.py:299-301）', () {
      expect(
        buddyExplainMatch(
          section: BuddySection.sport,
          signals: const BuddyRuleSignals(),
        ),
        '有潜在匹配',
      );
      expect(buddyFallbackReason, '有潜在匹配');
    });

    test('未登记板块的理由也是回落文案（永不为空）', () {
      final String reason = buddyExplainMatch(
        section: BuddySection.unknown,
        signals: const BuddyRuleSignals(sameDepartment: true),
      );
      expect(reason, isNotEmpty);
      expect(reason, buddyFallbackReason);
    });
  });

  // ---------------------------------------------------------------- 时段

  group('§3.3 F7 overlapsAvailability（含跨零点）', () {
    // 2026-10-19 是**周一**；UTC 12:00 == 上海 20:00。
    final DateTime monday2000 = DateTime.utc(2026, 10, 19, 12);

    test('落在时段内 → true；刚好贴边 → false（左闭右开）', () {
      const List<AvailabilitySlot> slots = <AvailabilitySlot>[
        AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
      ];
      expect(buddyOverlapsAvailability(slots, monday2000, 60), isTrue);
      // 20:00 起 60 分钟 = 20:00–21:00 ⊂ 19:00–22:00
      expect(
        buddyOverlapsAvailability(slots, DateTime.utc(2026, 10, 19, 14), 60),
        isFalse,
        reason: '22:00 开始不在 [19:00, 22:00) 内',
      );
      expect(
        buddyOverlapsAvailability(slots, DateTime.utc(2026, 10, 19, 10), 60),
        isFalse,
        reason: '18:00–19:00 与 [19:00, 22:00) 无交集',
      );
      expect(
        buddyOverlapsAvailability(slots, DateTime.utc(2026, 10, 19, 10), 120),
        isTrue,
        reason: '18:00–20:00 与 [19:00, 22:00) 有交集',
      );
    });

    test('空时段表 → false（不把「没填」当成「随时都行」）', () {
      expect(
        buddyOverlapsAvailability(const <AvailabilitySlot>[], monday2000, 60),
        isFalse,
      );
      expect(
        buddyOverlapsAvailability(
          const <AvailabilitySlot>[
            AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          ],
          monday2000,
          0,
        ),
        isFalse,
      );
    });

    test('跨零点：活动 23:30 + 60 分钟会命中**次日** 00:00–01:00 的时段', () {
      // UTC 15:30 == 上海 23:30（周一）
      final DateTime monday2330 = DateTime.utc(2026, 10, 19, 15, 30);
      const List<AvailabilitySlot> nextDayEarly = <AvailabilitySlot>[
        AvailabilitySlot(dow: 2, startMin: 0, endMin: 60),
      ];
      expect(
        buddyOverlapsAvailability(nextDayEarly, monday2330, 60),
        isTrue,
        reason: '23:30–00:30 覆盖次日 00:00–00:30',
      );

      const List<AvailabilitySlot> nextDayLate = <AvailabilitySlot>[
        AvailabilitySlot(dow: 2, startMin: 120, endMin: 180),
      ];
      expect(
        buddyOverlapsAvailability(nextDayLate, monday2330, 60),
        isFalse,
        reason: '次日 02:00–03:00 与 23:30–00:30 无交集',
      );

      // 当天的部分同样有效。
      const List<AvailabilitySlot> sameDayLate = <AvailabilitySlot>[
        AvailabilitySlot(dow: 1, startMin: 23 * 60, endMin: 24 * 60),
      ];
      expect(buddyOverlapsAvailability(sameDayLate, monday2330, 60), isTrue);
    });

    test('恰好结束于午夜（end == 1440）不检查次日', () {
      // 上海 22:00 起 120 分钟 → end == 1440，不 > 1440
      final DateTime monday2200 = DateTime.utc(2026, 10, 19, 14);
      const List<AvailabilitySlot> nextDay = <AvailabilitySlot>[
        AvailabilitySlot(dow: 2, startMin: 0, endMin: 120),
      ];
      expect(buddyOverlapsAvailability(nextDay, monday2200, 120), isFalse);
    });

    test('时区：UTC 16:00 是上海**次日** 00:00，按周二判定', () {
      final DateTime utc1600Monday = DateTime.utc(2026, 10, 19, 16);
      const List<AvailabilitySlot> tuesday = <AvailabilitySlot>[
        AvailabilitySlot(dow: 2, startMin: 0, endMin: 120),
      ];
      const List<AvailabilitySlot> monday = <AvailabilitySlot>[
        AvailabilitySlot(dow: 1, startMin: 0, endMin: 120),
      ];
      expect(buddyOverlapsAvailability(tuesday, utc1600Monday, 60), isTrue);
      expect(buddyOverlapsAvailability(monday, utc1600Monday, 60), isFalse);
    });
  });

  // ---------------------------------------------------------------- 打分

  group('ruleScoreFor 与融合', () {
    test('sport 全命中 = 1.0（0.3 + 0.4 + 0.2 + 0.1），且被 clamp 到 [0,1]', () {
      final BuddyRuleScore score = buddyRuleScoreFor(
        section: BuddySection.sport,
        post: post(
          tags: const <String>['badminton', 'gym', 'gym'],
          durationMin: 60,
        ),
        me: profile(
          interestTags: const <String>['badminton', 'programming'],
          activityTags: const <String>['badminton', 'gym', 'gym'],
          preferredAreas: const <String>['体育馆'],
          availability: const <AvailabilitySlot>[
            AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          ],
        ),
        creatorProfile: profile(
          interestTags: const <String>['badminton', 'programming'],
          preferredAreas: const <String>['体育馆'],
        ),
      );
      expect(score.score, closeTo(1.0, 1e-12));
      expect(score.reason, isNotEmpty);
    });

    test('academic 全命中 = 0.8；daily 全命中 = 0.8', () {
      final BuddyRuleScore academic = buddyRuleScoreFor(
        section: BuddySection.academic,
        post: post(
          activity: BuddyActivity.study,
          tags: const <String>['self-study'],
        ),
        me: profile(
          department: '信息学院',
          interestTags: const <String>['programming', 'movie', 'reading'],
          activityTags: const <String>['self-study'],
        ),
        creatorProfile: profile(
          department: '信息学院',
          interestTags: const <String>['programming', 'movie', 'reading'],
        ),
      );
      expect(academic.score, closeTo(0.8, 1e-12));

      final BuddyRuleScore daily = buddyRuleScoreFor(
        section: BuddySection.daily,
        post: post(
          activity: BuddyActivity.meal,
          tags: const <String>['canteen'],
          durationMin: 60,
        ),
        me: profile(
          interestTags: const <String>['hotpot', 'movie', 'music', 'coffee'],
          preferredAreas: const <String>['二食堂'],
          availability: const <AvailabilitySlot>[
            AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          ],
        ),
        creatorProfile: profile(
          interestTags: const <String>['hotpot', 'movie', 'music', 'coffee'],
          preferredAreas: const <String>['二食堂'],
        ),
      );
      expect(daily.score, closeTo(0.8, 1e-12));
    });

    test('共同 activityTags 取自「我的活动标签 ∩ 帖子的 tags」（文档未逐字指定，已上报）', () {
      final BuddyRuleScore score = buddyRuleScoreFor(
        section: BuddySection.sport,
        post: post(tags: const <String>['badminton']),
        me: profile(activityTags: const <String>['badminton']),
        creatorProfile: profile(activityTags: const <String>['gym']),
      );
      expect(score.signals.commonActivityTags, <String>['badminton']);
      expect(score.reason, contains('共同活动：羽毛球'));
    });

    test('buddyClamp01 与融合公式（§3.4）', () {
      expect(buddyClamp01(-0.5), 0);
      expect(buddyClamp01(1.5), 1);
      expect(buddyClamp01(0.42), closeTo(0.42, 1e-12));

      // 模式 C（rule）：ruleScore × 1.0
      expect(
        buddyFinalScore(
            mode: BuddyMatchMode.rule, ruleScore: 0.5, baseScore: 1),
        closeTo(0.5, 1e-12),
      );
      // 模式 A/B：base × 0.70 + rule × 0.30（towerScore 恒为 None，§3.4）
      expect(
        buddyFinalScore(
            mode: BuddyMatchMode.hash, ruleScore: 0.5, baseScore: 1),
        closeTo(0.85, 1e-12),
      );
      expect(
        buddyFinalScore(
            mode: BuddyMatchMode.vector, ruleScore: 0.5, baseScore: 1),
        closeTo(0.85, 1e-12),
      );
      // 叠加反馈后 clamp
      expect(
        buddyFinalScore(
          mode: BuddyMatchMode.hash,
          ruleScore: 0.5,
          baseScore: 1,
          feedbackAdjustment: -0.3,
        ),
        closeTo(0.55, 1e-12),
      );
      expect(
        buddyFinalScore(
          mode: BuddyMatchMode.rule,
          ruleScore: 1,
          feedbackAdjustment: 0.5,
        ),
        1,
      );
    });
  });

  // ---------------------------------------------------------------- 反馈

  group('§3.6 反馈与衰减', () {
    final DateTime now = DateTime.utc(2026, 10, 17, 4);

    test('反馈权重逐字对齐 matching.py:367-371', () {
      expect(buddyFeedbackActionWeights[BuddyMatchFeedbackAction.like], 0.20);
      expect(
          buddyFeedbackActionWeights[BuddyMatchFeedbackAction.dislike], -0.30);
      expect(buddyFeedbackActionWeights[BuddyMatchFeedbackAction.skip], -0.05);
      expect(buddyFeedbackHalflifeDays, 30);
    });

    test('buddyExpNeg 精度（纯 dart:core 实现，无 dart:math）', () {
      expect(buddyExpNeg(0), 1);
      expect(buddyExpNeg(1), closeTo(0.36787944117144233, 1e-12));
      expect(buddyExpNeg(2), closeTo(0.1353352832366127, 1e-12));
      expect(buddyExpNeg(-5), 1, reason: 'x <= 0 视为 1');
    });

    test('衰减：刚发生的 like = +0.20；30 天前的 like ≈ +0.0736', () {
      final Map<String, double> fresh = buddyFeedbackAdjustment(
        <BuddyMatchFeedback>[
          BuddyMatchFeedback(
            userId: 'u-me',
            targetPostId: 'bp-1',
            section: BuddySection.sport,
            action: BuddyMatchFeedbackAction.like,
            createdAt: now,
          ),
        ],
        now,
      );
      expect(fresh['bp-1'], closeTo(0.20, 1e-12));

      final Map<String, double> old = buddyFeedbackAdjustment(
        <BuddyMatchFeedback>[
          BuddyMatchFeedback(
            userId: 'u-me',
            targetPostId: 'bp-1',
            section: BuddySection.sport,
            action: BuddyMatchFeedbackAction.like,
            createdAt: now.subtract(const Duration(days: 30)),
          ),
        ],
        now,
      );
      expect(old['bp-1'], closeTo(0.20 * 0.36787944117144233, 1e-9));
    });

    test('dislike / skip 为负；同一帖子多次反馈取最后一次', () {
      final Map<String, double> adjustments = buddyFeedbackAdjustment(
        <BuddyMatchFeedback>[
          BuddyMatchFeedback(
            userId: 'u-me',
            targetPostId: 'bp-1',
            section: BuddySection.sport,
            action: BuddyMatchFeedbackAction.like,
            createdAt: now,
          ),
          BuddyMatchFeedback(
            userId: 'u-me',
            targetPostId: 'bp-1',
            section: BuddySection.sport,
            action: BuddyMatchFeedbackAction.dislike,
            createdAt: now,
          ),
        ],
        now,
      );
      expect(adjustments, hasLength(1));
      expect(adjustments['bp-1'], closeTo(-0.30, 1e-12));

      final Map<String, double> skip = buddyFeedbackAdjustment(
        <BuddyMatchFeedback>[
          BuddyMatchFeedback(
            userId: 'u-me',
            targetPostId: 'bp-2',
            section: BuddySection.daily,
            action: BuddyMatchFeedbackAction.skip,
            createdAt: now,
          ),
        ],
        now,
      );
      expect(skip['bp-2'], closeTo(-0.05, 1e-12));
    });
  });

  // ---------------------------------------------------------------- 模式

  group('matchMode 的诚实展示（§5.7）', () {
    test('wire 解析 + 未登记收敛', () {
      expect(BuddyMatchMode.fromWire('vector'), BuddyMatchMode.vector);
      expect(BuddyMatchMode.fromWire('HASH'), BuddyMatchMode.hash);
      expect(BuddyMatchMode.fromWire('rule'), BuddyMatchMode.rule);
      expect(BuddyMatchMode.fromWire('quantum'), BuddyMatchMode.unknown);
    });

    test('降级档的文案不得声称「智能推荐」', () {
      expect(BuddyMatchMode.vector.notice, contains('为你智能推荐'));
      expect(BuddyMatchMode.hash.notice, isNot(contains('为你智能推荐')));
      // rule 的文案里出现「不是智能推荐」这种诚实措辞是**允许且鼓励**的，
      // 禁止的是把降级档说成「为你智能推荐」。
      expect(BuddyMatchMode.rule.notice, isNot(contains('为你智能推荐')));
      expect(BuddyMatchMode.unknown.notice, isNot(contains('为你智能推荐')));
      expect(BuddyMatchMode.vector.isDegraded, isFalse);
      expect(BuddyMatchMode.hash.isDegraded, isTrue);
      expect(BuddyMatchMode.rule.isDegraded, isTrue);
    });

    test('推荐的理由必须非空（§1.1 G3：可解释）', () {
      expect(
        () => BuddyRecommendation(post: post(), score: 0.5, reason: ''),
        throwsA(isA<AssertionError>()),
      );
      final BuddyRecommendation ok = BuddyRecommendation(
        post: post(),
        score: 0.7234,
        reason: buddyFallbackReason,
      );
      expect(ok.reason, isNotEmpty);
      expect(ok.percent, 72);
    });

    test('buddyRound3 保留 3 位小数（对齐 matching.py:466）', () {
      expect(buddyRound3(0.7234), closeTo(0.723, 1e-12));
      expect(buddyRound3(0.7236), closeTo(0.724, 1e-12));
    });
  });
}
