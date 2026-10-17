import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/buddy_fixtures.dart';
import 'package:kedaya/data/mock/mock_buddy_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/features/buddy/application/buddy_providers.dart';

/// 推荐页 application 层的测试（规格 §5.7 / §1.1 G3）。
///
/// 重点：**理由一定被带出来**、**matchMode 一定被暴露**、
/// **打开匹配开关后推荐立刻从「按时间排序」变成可解释的规则分**。
void main() {
  final DateTime fixedNow = DateTime.utc(2026, 10, 17, 4);

  ProviderContainer containerWith(MockBuddyRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        buddyRepositoryProvider.overrideWithValue(repository)
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  /// 默认资料 = fixtures 那份 + **打开匹配开关**（否则走的是「按时间排序」降级路径）。
  BuddyProfile matchingProfile() =>
      mockBuddyProfile().copyWith(matchEnabled: true);

  MockBuddyRepository repo({
    MockControls? controls,
    BuddyProfile? profile,
    List<BuddyPost>? posts,
  }) =>
      MockBuddyRepository(
        controls: controls ?? MockControls(latency: Duration.zero),
        clock: () => fixedNow,
        profile: profile ?? matchingProfile(),
        posts: posts,
      );

  List<BuddyPost> seedPosts(int count) => <BuddyPost>[
        for (int i = 0; i < count; i++)
          BuddyPost(
            id: 'bp-seed-$i',
            activity: BuddyActivity.sport,
            title: '活动 $i',
            location: '体育馆',
            startsAt: buddyShanghaiInstant(fixedNow, dayOffset: 2, hour: 19)
                .add(Duration(minutes: i * 5)),
            durationMin: 60,
            capacity: 4,
            creator: const BuddyCreator(id: 'u-2001', nickname: '鸭鸭一号'),
            createdAt: fixedNow,
          ),
      ];

  Future<BuddyRecommendState> settle(ProviderContainer container) async {
    for (int i = 0; i < 50; i++) {
      final AsyncValue<BuddyRecommendState> value = container.read(
        buddyRecommendControllerProvider,
      );
      if (value.hasValue && !value.isLoading) return value.requireValue;
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(buddyRecommendControllerProvider).requireValue;
  }

  group('三态', () {
    test('loading -> data：每条推荐都带非空理由与 matchMode', () async {
      final ProviderContainer container = containerWith(repo());

      expect(
          container.read(buddyRecommendControllerProvider).isLoading, isTrue);

      final BuddyRecommendState state = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(state.matchMode, BuddyMatchMode.rule);
      expect(state.items, isNotEmpty);
      for (final BuddyRecommendation item in state.items) {
        expect(item.reason, isNotEmpty, reason: '§1.1 G3：推荐必须可解释');
        expect(item.post.section, BuddySection.sport);
      }
    });

    test('empty：空结果 → isEmpty（UI 渲染空态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      final BuddyRecommendState state = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(state.isEmpty, isTrue);
      expect(state.matchMode, BuddyMatchMode.rule);
    });

    test('error：上游故障抛出 ApiException', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      await expectLater(
        container.read(buddyRecommendControllerProvider.future),
        throwsA(isA<ApiException>()),
      );
      expect(
        (container.read(buddyRecommendControllerProvider).error!
                as ApiException)
            .code,
        ApiErrorCode.upstreamUnavailable,
      );
    });
  });

  group('板块切换与翻页', () {
    test('切换板块重新推荐', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyRecommendState sport = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(sport.section, BuddySection.sport);

      container
          .read(buddySectionFilterProvider.notifier)
          .select(BuddySection.academic);
      final BuddyRecommendState academic = await settle(container);
      expect(academic.section, BuddySection.academic);
      expect(
        academic.items.every(
          (BuddyRecommendation item) =>
              item.post.section == BuddySection.academic,
        ),
        isTrue,
      );
    });

    test('loadMore：追加下一页；失败时保留已有推荐', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final ProviderContainer container = containerWith(
        repo(controls: controls, posts: seedPosts(12)),
      );

      BuddyRecommendState state = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(state.items, hasLength(10));
      expect(state.hasMore, isTrue);

      controls.failureMode = MockFailureMode.upstreamUnavailable;
      await container
          .read(buddyRecommendControllerProvider.notifier)
          .loadMore();
      state = container.read(buddyRecommendControllerProvider).requireValue;
      expect(state.items, hasLength(10));
      expect(state.loadMoreError, isA<ApiException>());

      controls.failureMode = MockFailureMode.none;
      await container
          .read(buddyRecommendControllerProvider.notifier)
          .loadMore();
      state = container.read(buddyRecommendControllerProvider).requireValue;
      expect(state.items, hasLength(12));
      expect(state.hasMore, isFalse);
    });
  });

  group('资料与推荐联动（规格 §5.7 / §6.3）', () {
    test('未开启匹配 → 「按时间排序」；打开开关后立刻变成可解释的规则分', () async {
      final ProviderContainer container = containerWith(
        repo(profile: mockBuddyProfile()),
      );

      final BuddyRecommendState before = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(before.matchMode, BuddyMatchMode.rule);
      expect(
        before.items.every(
          (BuddyRecommendation item) => item.reason == buddyTimeSortedReason,
        ),
        isTrue,
      );
      expect(before.items.every((BuddyRecommendation item) => item.score == 0),
          isTrue);

      final BuddyProfile profile =
          await container.read(buddyProfileProvider.future);
      await container
          .read(buddyActionsProvider)
          .saveProfile(profile.copyWith(matchEnabled: true));

      final BuddyRecommendState after = await settle(container);
      expect(after.items, isNotEmpty);
      expect(
        after.items.every(
          (BuddyRecommendation item) => item.reason != buddyTimeSortedReason,
        ),
        isTrue,
        reason: '开启匹配后必须给出真实的匹配理由',
      );
      expect(after.items.first.post.id, 'bp-1010');
      expect(after.items.first.reason, contains('运动水平相同'));
      expect(after.items.first.score, greaterThan(0));
    });

    test('反馈后 refresh 能反映分数变化（§5.8：下次推荐立刻反映）', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyRecommendState before = await container.read(
        buddyRecommendControllerProvider.future,
      );
      final double beforeScore = before.items.first.score;
      expect(before.items.first.post.id, 'bp-1010');

      await container.read(buddyActionsProvider).submitFeedback(
            BuddyMatchFeedback(
              userId: buddyMockCurrentUserId,
              targetPostId: 'bp-1010',
              section: BuddySection.sport,
              action: BuddyMatchFeedbackAction.dislike,
              createdAt: fixedNow,
            ),
          );

      await container.read(buddyRecommendControllerProvider.notifier).refresh();
      final BuddyRecommendState after = container
          .read(
            buddyRecommendControllerProvider,
          )
          .requireValue;
      expect(after.items.first.score, lessThan(beforeScore));
      expect(after.items.first.score, closeTo(0.45, 1e-9));
    });

    test('删除匹配资料后回到「按时间排序」的诚实降级', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyRecommendState scored = await container.read(
        buddyRecommendControllerProvider.future,
      );
      expect(scored.items.first.reason, isNot(buddyTimeSortedReason));

      await container.read(buddyActionsProvider).deleteProfile();

      final BuddyRecommendState after = await settle(container);
      expect(after.matchMode, BuddyMatchMode.rule);
      expect(
        after.items.every(
          (BuddyRecommendation item) => item.reason == buddyTimeSortedReason,
        ),
        isTrue,
      );
    });
  });
}
