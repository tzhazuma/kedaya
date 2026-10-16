import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_forum_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/forum.dart';
import 'package:kedaya/features/forum/application/forum_providers.dart';

/// 论坛 application 层的测试：**只替换 domain port**，不碰 UI、不碰网络。
///
/// 覆盖三态（loading / error / empty）、版块筛选、翻页失败保留列表、
/// 以及写操作后的 provider 失效。
void main() {
  ProviderContainer containerWith(MockForumRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[forumRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    return container;
  }

  MockForumRepository repo({MockControls? controls}) =>
      MockForumRepository(controls: controls ?? MockControls(latency: Duration.zero));

  List<ForumPost> seedPosts(int count) => <ForumPost>[
    for (int i = 0; i < count; i++)
      ForumPost(
        id: 'fp-seed-$i',
        boardId: 'fb-campus',
        boardName: '校园生活',
        title: '主题 $i',
        body: '正文 $i',
        author: const RealAuthor(userId: 'u-1', name: '鸭鸭一号'),
        createdAt: DateTime.utc(2026, 10, 16, 12).subtract(Duration(hours: i)),
      ),
  ];

  /// 等到状态不再是 loading（依赖失效后的重建是异步的）。
  Future<ForumListState> settle(ProviderContainer container) async {
    for (int i = 0; i < 50; i++) {
      final AsyncValue<ForumListState> value = container.read(forumListControllerProvider);
      if (value.hasValue && !value.isLoading) return value.requireValue;
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(forumListControllerProvider).requireValue;
  }

  group('三态', () {
    test('loading -> data：初态是 loading，加载成功后有 6 条（HIDDEN 不计）', () async {
      final ProviderContainer container = containerWith(repo());

      expect(container.read(forumListControllerProvider).isLoading, isTrue);

      final ForumListState state = await container.read(
        forumListControllerProvider.future,
      );

      expect(state.posts, hasLength(6));
      expect(state.isEmpty, isFalse);
      expect(state.total, 6);
      expect(state.hasMore, isFalse);
      expect(container.read(forumListControllerProvider).hasValue, isTrue);
    });

    test('empty：空结果时 isEmpty 为 true（UI 渲染空态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final ProviderContainer container = containerWith(repo(controls: controls));

      final ForumListState state = await container.read(
        forumListControllerProvider.future,
      );

      expect(state.isEmpty, isTrue);
      expect(state.posts, isEmpty);
    });

    test('error：上游故障抛出 ApiException（UI 渲染错误态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container = containerWith(repo(controls: controls));

      await expectLater(
        container.read(forumListControllerProvider.future),
        throwsA(isA<ApiException>()),
      );

      final Object? error = container.read(forumListControllerProvider).error;
      expect(error, isA<ApiException>());
      expect((error! as ApiException).code, ApiErrorCode.upstreamUnavailable);
    });
  });

  group('版块筛选', () {
    test('筛选条件在首次加载时就生效', () async {
      final ProviderContainer container = containerWith(repo());
      container.read(forumBoardFilterProvider.notifier).select('fb-study');

      final ForumListState state = await container.read(
        forumListControllerProvider.future,
      );

      expect(state.boardId, 'fb-study');
      expect(state.posts.map((ForumPost post) => post.id), <String>['fp-1002', 'fp-1005']);
    });

    test('切换版块会重新加载列表', () async {
      final ProviderContainer container = containerWith(repo());

      final ForumListState all = await container.read(forumListControllerProvider.future);
      expect(all.posts, hasLength(6));

      container.read(forumBoardFilterProvider.notifier).select('fb-campus');
      final ForumListState campus = await settle(container);
      expect(campus.posts, hasLength(3));

      container.read(forumBoardFilterProvider.notifier).select(null);
      final ForumListState backToAll = await settle(container);
      expect(backToAll.posts, hasLength(6));
    });

    test('版块列表 provider 暴露 4 个版块', () async {
      final ProviderContainer container = containerWith(repo());

      final List<ForumBoard> boards = await container.read(forumBoardsProvider.future);
      expect(boards, hasLength(4));
    });
  });

  group('翻页', () {
    test('loadMore：追加下一页；翻页失败时保留已有列表', () async {
      final MockControls controls = MockControls(latency: Duration.zero);
      final ProviderContainer container = containerWith(
        MockForumRepository(seed: seedPosts(12), controls: controls),
      );

      ForumListState state = await container.read(forumListControllerProvider.future);
      expect(state.posts, hasLength(10));
      expect(state.hasMore, isTrue);

      // 翻页失败：保留已加载的 10 条，只把错误挂在状态上。
      controls.failureMode = MockFailureMode.upstreamUnavailable;
      await container.read(forumListControllerProvider.notifier).loadMore();
      state = container.read(forumListControllerProvider).requireValue;
      expect(state.posts, hasLength(10));
      expect(state.loadMoreError, isA<ApiException>());
      expect(state.isLoadingMore, isFalse);

      // 恢复后翻页成功。
      controls.failureMode = MockFailureMode.none;
      await container.read(forumListControllerProvider.notifier).loadMore();
      state = container.read(forumListControllerProvider).requireValue;
      expect(state.posts, hasLength(12));
      expect(state.hasMore, isFalse);
      expect(state.loadMoreError, isNull);
    });
  });

  group('回复列表与写操作', () {
    test('回复列表：初始 2 条，回复成功后失效重取为 3 条', () async {
      final ProviderContainer container = containerWith(repo());

      ForumReplyListState replies = await container.read(
        forumRepliesProvider('fp-1001').future,
      );
      expect(replies.replies, hasLength(2));

      await container.read(forumActionsProvider).reply(
        const CreateForumReplyCommand(postId: 'fp-1001', body: '新回复'),
      );

      replies = await container.read(forumRepliesProvider('fp-1001').future);
      expect(replies.replies, hasLength(3));
      expect(replies.replies.last.body, '新回复');

      // 主题详情也被失效重取，replyCount 同步。
      final ForumPost post = await container.read(forumPostProvider('fp-1001').future);
      expect(post.replyCount, 3);
    });

    test('发帖：写成功后列表被失效重取，新帖出现在列表里', () async {
      final ProviderContainer container = containerWith(repo());

      await container.read(forumListControllerProvider.future);
      final ForumPost created = await container
          .read(forumActionsProvider)
          .createPost(
            const CreateForumPostCommand(
              boardId: 'fb-club',
              title: '新帖',
              body: '正文',
              anonymous: true,
            ),
          );

      expect(created.anonymous, isTrue);

      final ForumListState state = await container.read(
        forumListControllerProvider.future,
      );
      expect(
        state.posts.any((ForumPost post) => post.id == created.id),
        isTrue,
      );
      expect(state.total, 7);
    });

    test('举报：同一用户第二次举报抛出 CONFLICT（去重）', () async {
      final ProviderContainer container = containerWith(repo());
      final ForumActions actions = container.read(forumActionsProvider);

      const CreateForumReportCommand command = CreateForumReportCommand(
        targetType: ForumReportTargetType.post,
        targetId: 'fp-1004',
        reason: ForumReportReason.spam,
      );

      final ForumReport first = await actions.report(command);
      expect(first.status, ForumReportStatus.pending);

      await expectLater(
        actions.report(command),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.conflict,
          ),
        ),
      );
    });

    test('举报失败不会把帖子从列表里弄没（不失效读 provider）', () async {
      final ProviderContainer container = containerWith(repo());
      await container.read(forumListControllerProvider.future);
      final ForumActions actions = container.read(forumActionsProvider);

      await expectLater(
        actions.report(
          const CreateForumReportCommand(
            targetType: ForumReportTargetType.post,
            targetId: 'fp-nope',
            reason: ForumReportReason.other,
          ),
        ),
        throwsA(isA<ApiException>()),
      );

      final ForumListState state = container.read(forumListControllerProvider).requireValue;
      expect(state.posts, hasLength(6));
      expect(container.read(forumListControllerProvider).isLoading, isFalse);
    });
  });
}
