import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/buddy_fixtures.dart';
import 'package:kedaya/data/mock/mock_buddy_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/domain/models/result.dart';

/// `MockBuddyRepository.recommend` 的行为测试：
/// **硬过滤 F1–F7 + 可解释理由 + 反馈的 section 隔离**（规格 §3.3 / §3.6 / §5.7）。
void main() {
  final DateTime fixedNow = DateTime.utc(2026, 10, 17, 4);

  /// 与 fixtures 一致、但**打开了匹配开关**的资料。
  BuddyProfile matchingProfile() =>
      mockBuddyProfile().copyWith(matchEnabled: true);

  MockBuddyRepository repo({
    BuddyProfile? profile,
    List<BuddyPost>? posts,
    MockControls? controls,
  }) =>
      MockBuddyRepository(
        controls: controls ?? MockControls(latency: Duration.zero),
        clock: () => fixedNow,
        profile: profile ?? matchingProfile(),
        posts: posts,
      );

  BuddyPost customPost({
    required String id,
    int dayOffset = 2,
    int hour = 20,
    int? durationMin = 60,
    BuddySkillLevel? minSkillLevel,
    List<String> tags = const <String>[],
    BuddyActivity activity = BuddyActivity.sport,
    String creatorId = 'u-9999',
  }) =>
      BuddyPost(
        id: id,
        activity: activity,
        title: '自定义活动 $id',
        location: '体育馆',
        startsAt:
            buddyShanghaiInstant(fixedNow, dayOffset: dayOffset, hour: hour),
        durationMin: durationMin,
        capacity: 4,
        joinedCount: 1,
        minSkillLevel: minSkillLevel,
        tags: tags,
        creator: BuddyCreator(id: creatorId, nickname: creatorId),
        createdAt: fixedNow,
      );

  List<String> idsOf(BuddyRecommendationPage page) => page.items
      .map((BuddyRecommendation item) => item.post.id)
      .toList(growable: false);

  group('未开启匹配资料：不报错，降级为「按时间排序」（规格 §5.7）', () {
    test('matchMode = rule、score = 0、reason = 按时间排序', () async {
      final BuddyRecommendationPage page = (await repo(
        profile: mockBuddyProfile(),
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;

      expect(page.matchMode, BuddyMatchMode.rule);
      expect(idsOf(page), <String>['bp-1001', 'bp-1006', 'bp-1010']);
      for (final BuddyRecommendation item in page.items) {
        expect(item.score, 0);
        expect(item.reason, buddyTimeSortedReason);
      }
    });

    test('完全没有资料（已删除）时同样不报错', () async {
      final MockBuddyRepository repository = MockBuddyRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => fixedNow,
      );
      await repository.deleteMyProfile();
      final BuddyRecommendationPage page = (await repository.recommend(
        const BuddyRecommendQuery(section: BuddySection.academic),
      ))
          .unwrap;
      expect(page.matchMode, BuddyMatchMode.rule);
      expect(page.items, isNotEmpty);
      expect(page.items.first.reason, buddyTimeSortedReason);
    });
  });

  group('开启匹配后：硬过滤 F1–F7 + 软打分', () {
    test('sport：只留下最匹配的那条，分数与理由都可解释', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.sport),
      ))
          .unwrap;

      expect(page.matchMode, BuddyMatchMode.rule, reason: 'mock 无向量能力 → 规则降级档');
      expect(page.matchMode.notice, isNot(contains('为你智能推荐')));
      expect(idsOf(page), <String>['bp-1010']);

      final BuddyRecommendation top = page.items.first;
      // 0.3（水平相同）+ 0.15（共同活动×1）+ 0.20（共同兴趣×2）+ 0.1（同区域）
      expect(top.score, closeTo(0.75, 1e-9));
      expect(top.reason, '运动水平相同、共同活动：羽毛球、共同兴趣：编程,羽毛球');
      expect(top.percent, 75);
    });

    test('academic：同院系 + 共同兴趣 + 共同活动', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.academic),
      ))
          .unwrap;

      expect(idsOf(page), <String>['bp-1002']);
      final BuddyRecommendation top = page.items.first;
      expect(top.score, closeTo(0.70, 1e-9));
      expect(top.reason, '同院系、共同兴趣：编程,电影、共同活动：自习');
    });

    test('daily：共同兴趣 + 时间合适', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.daily),
      ))
          .unwrap;

      expect(idsOf(page), <String>['bp-1003']);
      final BuddyRecommendation top = page.items.first;
      expect(top.score, closeTo(0.35, 1e-9));
      expect(top.reason, '共同兴趣：电影、时间合适');
    });

    test('F3：不推荐自己发的活动（bp-1005 是我发的）', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.daily),
      ))
          .unwrap;
      expect(idsOf(page), isNot(contains('bp-1005')));
    });

    test('F4：已申请（PENDING / ACCEPTED）的不再推荐', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.sport),
      ))
          .unwrap;
      // bp-1001 上我有一条 ACCEPTED；bp-1006 上我有一条 PENDING。
      expect(idsOf(page), isNot(contains('bp-1001')));
      expect(idsOf(page), isNot(contains('bp-1006')));
    });

    test('F1/F2：FULL / EXPIRED / CLOSED / CANCELLED 永不出现在推荐里', () async {
      for (final BuddySection section in buddyMatchableSections) {
        final BuddyRecommendationPage page = (await repo().recommend(
          BuddyRecommendQuery(section: section),
        ))
            .unwrap;
        expect(idsOf(page), isNot(contains('bp-1004')), reason: 'FULL');
        expect(idsOf(page), isNot(contains('bp-1007')), reason: 'EXPIRED');
        expect(idsOf(page), isNot(contains('bp-1008')), reason: 'CLOSED');
        expect(idsOf(page), isNot(contains('bp-1009')), reason: 'CANCELLED');
      }
    });

    test('F6：minSkillLevel 高于我的水平 → 排除', () async {
      final BuddyRecommendationPage page = (await repo(
        posts: <BuddyPost>[
          customPost(id: 'bp-hard', minSkillLevel: BuddySkillLevel.competitive),
          customPost(
              id: 'bp-ok', minSkillLevel: BuddySkillLevel.beginner, hour: 19),
        ],
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;

      expect(idsOf(page), <String>['bp-ok']);
    });

    test('F7：活动时间落在我的可用时段之外 → 排除', () async {
      final BuddyRecommendationPage page = (await repo(
        posts: <BuddyPost>[
          // 周一 20:00（我在 19:00–22:00 有空）→ 通过
          customPost(id: 'bp-in', dayOffset: 2, hour: 20),
          // 周一 03:00 → 不在任何时段里 → 排除
          customPost(id: 'bp-out', dayOffset: 2, hour: 3),
        ],
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;

      expect(idsOf(page), <String>['bp-in']);
    });

    test('F7 的宽松：我没填任何时段时不做时段约束（否则推荐恒空）', () async {
      final BuddyRecommendationPage page = (await repo(
        profile: matchingProfile()
            .copyWith(availability: const <AvailabilitySlot>[]),
        posts: <BuddyPost>[customPost(id: 'bp-anytime', dayOffset: 2, hour: 3)],
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;

      expect(idsOf(page), <String>['bp-anytime']);
    });

    test('排序：分数降序，同分按开始时间升序', () async {
      final BuddyRecommendationPage page = (await repo(
        posts: <BuddyPost>[
          customPost(id: 'bp-late', dayOffset: 3, hour: 20),
          customPost(id: 'bp-early', dayOffset: 2, hour: 20),
        ],
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;

      expect(idsOf(page), <String>['bp-early', 'bp-late']);
      expect(page.items[0].score, page.items[1].score);
    });
  });

  group('反馈：影响分数，且按 section 隔离（规格 §3.6 / §8.2 T6）', () {
    test('dislike 让该帖分数下降 0.30', () async {
      final MockBuddyRepository repository = repo();
      final double before = (await repository.recommend(
        const BuddyRecommendQuery(section: BuddySection.sport),
      ))
          .unwrap
          .items
          .first
          .score;

      await repository.submitFeedback(
        BuddyMatchFeedback(
          userId: buddyMockCurrentUserId,
          targetPostId: 'bp-1010',
          section: BuddySection.sport,
          action: BuddyMatchFeedbackAction.dislike,
          createdAt: fixedNow,
        ),
      );

      final double after = (await repository.recommend(
        const BuddyRecommendQuery(section: BuddySection.sport),
      ))
          .unwrap
          .items
          .first
          .score;

      expect(before, closeTo(0.75, 1e-9));
      expect(after, closeTo(0.45, 1e-9));
      expect(after, lessThan(before));
    });

    test('like 让分数上升（并 clamp 到 1.0）', () async {
      final MockBuddyRepository repository = repo();
      await repository.submitFeedback(
        BuddyMatchFeedback(
          userId: buddyMockCurrentUserId,
          targetPostId: 'bp-1010',
          section: BuddySection.sport,
          action: BuddyMatchFeedbackAction.like,
          createdAt: fixedNow,
        ),
      );
      final double score = (await repository.recommend(
        const BuddyRecommendQuery(section: BuddySection.sport),
      ))
          .unwrap
          .items
          .first
          .score;
      expect(score, closeTo(0.95, 1e-9));
    });

    test('section 隔离：daily 的 dislike 不影响 sport 的分数', () async {
      final MockBuddyRepository repository = repo();
      await repository.submitFeedback(
        BuddyMatchFeedback(
          userId: buddyMockCurrentUserId,
          targetPostId: 'bp-1003',
          section: BuddySection.daily,
          action: BuddyMatchFeedbackAction.dislike,
          createdAt: fixedNow,
        ),
      );

      // sport 不受影响
      expect(
        (await repository.recommend(
          const BuddyRecommendQuery(section: BuddySection.sport),
        ))
            .unwrap
            .items
            .first
            .score,
        closeTo(0.75, 1e-9),
      );
      // daily 生效
      expect(
        (await repository.recommend(
          const BuddyRecommendQuery(section: BuddySection.daily),
        ))
            .unwrap
            .items
            .first
            .score,
        closeTo(0.05, 1e-9),
      );
    });
  });

  group('推荐查询的校验与分页', () {
    test('section 必须是三个真实板块之一', () async {
      final Result<BuddyRecommendationPage> result = await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.unknown),
      );
      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
    });

    test('limit 收敛到 1–50', () async {
      final BuddyRecommendationPage page = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.sport, limit: 500),
      ))
          .unwrap;
      expect(page.items, hasLength(1));

      final BuddyRecommendationPage one = (await repo().recommend(
        const BuddyRecommendQuery(section: BuddySection.sport, limit: 0),
      ))
          .unwrap;
      expect(one.items, hasLength(1));
    });

    test('空结果开关 → 空推荐（仍是 rule 模式）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final BuddyRecommendationPage page = (await repo(
        controls: controls,
      ).recommend(const BuddyRecommendQuery(section: BuddySection.sport)))
          .unwrap;
      expect(page.items, isEmpty);
      expect(page.matchMode, BuddyMatchMode.rule);
    });
  });
}
