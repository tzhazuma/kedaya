import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/buddy_fixtures.dart';
import 'package:kedaya/data/mock/mock_buddy_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_application.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/features/buddy/application/buddy_providers.dart';

/// `buddy` application 层的测试：**只替换 domain port**，不碰 UI、不碰网络。
///
/// 覆盖三态（loading / data / empty / error）、三板块分栏切换、
/// 翻页失败保留列表、以及写操作后的 provider 失效。
void main() {
  final DateTime fixedNow = DateTime.utc(2026, 10, 17, 4);

  ProviderContainer containerWith(MockBuddyRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[buddyRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    return container;
  }

  MockBuddyRepository repo({
    MockControls? controls,
    List<BuddyPost>? posts,
    BuddyProfile? profile,
  }) => MockBuddyRepository(
    controls: controls ?? MockControls(latency: Duration.zero),
    clock: () => fixedNow,
    posts: posts,
    profile: profile,
  );

  List<BuddyPost> seedPosts(int count) => <BuddyPost>[
    for (int i = 0; i < count; i++)
      BuddyPost(
        id: 'bp-seed-$i',
        activity: BuddyActivity.sport,
        title: '活动 $i',
        location: '体育馆',
        // 用 buddy_fixtures 的上海本地时间助手：种子活动落在「周一 19:00 起」，
        // 与 fixtures 的可用时段一致，因此列表与推荐两侧的期望都稳定。
        startsAt: buddyShanghaiInstant(fixedNow, dayOffset: 2, hour: 19)
            .add(Duration(minutes: i * 5)),
        capacity: 4,
        creator: const BuddyCreator(id: 'u-2001', nickname: '鸭鸭一号'),
        createdAt: fixedNow,
      ),
  ];

  /// 等到状态不再是 loading（依赖失效后的重建是异步的）。
  Future<BuddyListState> settle(ProviderContainer container) async {
    for (int i = 0; i < 50; i++) {
      final AsyncValue<BuddyListState> value = container.read(
        buddyListControllerProvider,
      );
      if (value.hasValue && !value.isLoading) return value.requireValue;
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(buddyListControllerProvider).requireValue;
  }

  group('三态', () {
    test('loading -> data：默认板块是 sport，3 条（FULL/CLOSED 不计）', () async {
      final ProviderContainer container = containerWith(repo());

      expect(container.read(buddyListControllerProvider).isLoading, isTrue);
      expect(container.read(buddySectionFilterProvider), BuddySection.sport);

      final BuddyListState state = await container.read(
        buddyListControllerProvider.future,
      );
      expect(
        state.posts.map((BuddyPost post) => post.id),
        <String>['bp-1001', 'bp-1006', 'bp-1010'],
      );
      expect(state.total, 3);
      expect(state.hasMore, isFalse);
      expect(state.isEmpty, isFalse);
    });

    test('empty：空结果时 isEmpty 为 true（UI 渲染空态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final ProviderContainer container = containerWith(repo(controls: controls));

      final BuddyListState state = await container.read(
        buddyListControllerProvider.future,
      );
      expect(state.isEmpty, isTrue);
      expect(state.posts, isEmpty);
    });

    test('error：上游故障抛出 ApiException（UI 渲染错误态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container = containerWith(repo(controls: controls));

      await expectLater(
        container.read(buddyListControllerProvider.future),
        throwsA(isA<ApiException>()),
      );
      final Object? error = container.read(buddyListControllerProvider).error;
      expect(error, isA<ApiException>());
      expect((error! as ApiException).code, ApiErrorCode.upstreamUnavailable);
    });
  });

  group('三板块分栏', () {
    test('筛选在首次加载时就生效；切换板块会重新加载', () async {
      final ProviderContainer container = containerWith(repo());

      final BuddyListState sport = await container.read(
        buddyListControllerProvider.future,
      );
      expect(sport.posts, hasLength(3));

      container.read(buddySectionFilterProvider.notifier).select(BuddySection.academic);
      final BuddyListState academic = await settle(container);
      expect(academic.section, BuddySection.academic);
      expect(academic.posts.map((BuddyPost post) => post.id), <String>['bp-1002']);

      container.read(buddySectionFilterProvider.notifier).select(BuddySection.daily);
      final BuddyListState daily = await settle(container);
      expect(daily.posts.map((BuddyPost post) => post.id), <String>['bp-1003', 'bp-1005']);

      container.read(buddySectionFilterProvider.notifier).select(BuddySection.sport);
      final BuddyListState back = await settle(container);
      expect(back.posts, hasLength(3));
    });

    test('unknown 板块会被过滤器拒绝（不做 dating）', () async {
      final ProviderContainer container = containerWith(repo());
      await container.read(buddyListControllerProvider.future);

      container
          .read(buddySectionFilterProvider.notifier)
          .select(BuddySection.unknown);
      expect(container.read(buddySectionFilterProvider), BuddySection.sport);
    });
  });

  group('翻页', () {
    test('loadMore 追加下一页；翻页失败保留已有列表', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final ProviderContainer container = containerWith(
        repo(controls: controls, posts: seedPosts(12)),
      );

      BuddyListState state = await container.read(
        buddyListControllerProvider.future,
      );
      expect(state.posts, hasLength(10));
      expect(state.hasMore, isTrue);

      controls.failureMode = MockFailureMode.upstreamUnavailable;
      await container.read(buddyListControllerProvider.notifier).loadMore();
      state = container.read(buddyListControllerProvider).requireValue;
      expect(state.posts, hasLength(10), reason: '翻页失败不能打死整页');
      expect(state.loadMoreError, isA<ApiException>());
      expect(state.isLoadingMore, isFalse);

      controls.failureMode = MockFailureMode.none;
      await container.read(buddyListControllerProvider.notifier).loadMore();
      state = container.read(buddyListControllerProvider).requireValue;
      expect(state.posts, hasLength(12));
      expect(state.hasMore, isFalse);
      expect(state.loadMoreError, isNull);
    });

    test('没有下一页时 loadMore 是空操作', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyListState before = await container.read(
        buddyListControllerProvider.future,
      );
      await container.read(buddyListControllerProvider.notifier).loadMore();
      final BuddyListState after = container.read(
        buddyListControllerProvider,
      ).requireValue;
      expect(after.posts, hasLength(before.posts.length));
    });
  });

  group('详情 provider', () {
    test('按 id 取；不存在时抛 ApiException(NOT_FOUND)', () async {
      final ProviderContainer container = containerWith(repo());

      final BuddyPost post = await container.read(buddyPostProvider('bp-1001').future);
      expect(post.id, 'bp-1001');
      expect(post.section, BuddySection.sport);

      await expectLater(
        container.read(buddyPostProvider('bp-nope').future),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.notFound,
          ),
        ),
      );
    });
  });

  group('写操作与 provider 失效', () {
    test('join 后我的申请列表被失效重取', () async {
      final ProviderContainer container = containerWith(repo());

      final List<BuddyApplication> before = await container.read(
        buddyMyApplicationsProvider.future,
      );
      expect(before.map((BuddyApplication item) => item.postId), isNot(contains('bp-1003')));

      await container.read(buddyActionsProvider).join(
        const BuddyJoinCommand(postId: 'bp-1003'),
      );

      final List<BuddyApplication> after = await container.read(
        buddyMyApplicationsProvider.future,
      );
      expect(after.map((BuddyApplication item) => item.postId), contains('bp-1003'));
    });

    test('createPost 后列表被失效重取，新活动出现在当前板块', () async {
      final ProviderContainer container = containerWith(repo());
      await container.read(buddyListControllerProvider.future);

      final BuddyPost created = await container.read(buddyActionsProvider).createPost(
        CreateBuddyPostCommand(
          activity: BuddyActivity.sport,
          title: '新活动',
          location: '体育馆',
          startsAt: fixedNow.add(const Duration(days: 1)),
          capacity: 4,
          tags: const <String>['badminton'],
        ),
      );

      final BuddyListState state = await container.read(
        buddyListControllerProvider.future,
      );
      expect(state.posts.map((BuddyPost post) => post.id), contains(created.id));
      expect(state.total, 4);
    });

    test('closePost 后详情被失效重取', () async {
      final ProviderContainer container = containerWith(repo());
      expect(
        (await container.read(buddyPostProvider('bp-1005').future)).status,
        BuddyPostStatus.open,
      );

      await container.read(buddyActionsProvider).closePost('bp-1005');

      expect(
        (await container.read(buddyPostProvider('bp-1005').future)).status,
        BuddyPostStatus.closed,
      );
    });

    test('submitFeedback **不**失效列表（避免"点一下内容就没了"）', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyListState before = await container.read(
        buddyListControllerProvider.future,
      );

      await container.read(buddyActionsProvider).submitFeedback(
        BuddyMatchFeedback(
          userId: buddyMockCurrentUserId,
          targetPostId: 'bp-1001',
          section: BuddySection.sport,
          action: BuddyMatchFeedbackAction.like,
          createdAt: fixedNow,
        ),
      );

      final AsyncValue<BuddyListState> after = container.read(
        buddyListControllerProvider,
      );
      expect(after.isLoading, isFalse);
      expect(after.requireValue.posts, hasLength(before.posts.length));
    });

    test('saveProfile 后资料 provider 被失效重取；非法资料抛错', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyProfile initial = await container.read(buddyProfileProvider.future);
      expect(initial.matchEnabled, isFalse);

      await container.read(buddyActionsProvider).saveProfile(
        initial.copyWith(matchEnabled: true),
      );
      final BuddyProfile saved = await container.read(buddyProfileProvider.future);
      expect(saved.matchEnabled, isTrue);
      expect(saved.isRecommendable, isTrue);

      await expectLater(
        container.read(buddyActionsProvider).saveProfile(
          initial.copyWith(interestTags: const <String>['quidditch']),
        ),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.validationFailed,
          ),
        ),
      );
    });

    test('deleteProfile 后资料回到空白', () async {
      final ProviderContainer container = containerWith(repo());
      await container.read(buddyProfileProvider.future);

      await container.read(buddyActionsProvider).deleteProfile();

      final BuddyProfile profile = await container.read(buddyProfileProvider.future);
      expect(profile.matchEnabled, isFalse);
      expect(profile.hasAnySignal, isFalse);
    });

    test('decide 后发起人视角的申请列表被失效重取', () async {
      final ProviderContainer container = containerWith(repo());
      final List<BuddyApplication> received = await container.read(
        buddyPostApplicationsProvider('bp-1005').future,
      );
      expect(received.single.status, BuddyApplicationStatus.pending);

      await container.read(buddyActionsProvider).decide(
        const BuddyDecideCommand(
          postId: 'bp-1005',
          applicationId: 'ba-2001',
          decision: BuddyDecision.accepted,
        ),
      );

      final List<BuddyApplication> after = await container.read(
        buddyPostApplicationsProvider('bp-1005').future,
      );
      expect(after.single.status, BuddyApplicationStatus.accepted);
    });

    test('leave 撤回后状态回到 WITHDRAWN', () async {
      final ProviderContainer container = containerWith(repo());
      final BuddyApplication withdrawn = await container
          .read(buddyActionsProvider)
          .leave('bp-1006');
      expect(withdrawn.status, BuddyApplicationStatus.withdrawn);

      final List<BuddyApplication> mine = await container.read(
        buddyMyApplicationsProvider.future,
      );
      expect(
        mine.firstWhere((BuddyApplication item) => item.postId == 'bp-1006').status,
        BuddyApplicationStatus.withdrawn,
      );
    });
  });

  group('Result 语义（不抛异常的路径）', () {
    test('port 直接返回 Err 时不抛异常', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.notFound;
      final MockBuddyRepository repository = repo(controls: controls);
      final Result<BuddyPost> result = await repository.getPost('bp-1001');
      expect(result.isErr, isTrue);
      expect(result.errorOrNull!.code, ApiErrorCode.notFound);
      expect(result.valueOrNull, isNull);
    });
  });
}
