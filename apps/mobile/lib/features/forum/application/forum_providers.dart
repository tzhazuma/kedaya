import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/forum.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/forum_port.dart';

/// 主题列表状态。
///
/// 与 `groupbuy` 一样刻意把"翻页失败"与"整页错误"分开：已经有数据时，
/// 翻页失败不该把列表打回错误态（用户会丢失已看到的内容）。
final class ForumListState {
  const ForumListState({
    required this.posts,
    this.boardId,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<ForumPost> posts;

  /// 当前筛选的版块；null = 全部版块。
  final String? boardId;

  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;

  /// 翻页失败的原因；列表本身仍然可用。
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => posts.isEmpty;

  ForumListState copyWith({
    List<ForumPost>? posts,
    String? boardId,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
    bool clearBoardId = false,
  }) =>
      ForumListState(
        posts: posts ?? this.posts,
        boardId: clearBoardId ? null : (boardId ?? this.boardId),
        nextCursor: nextCursor ?? this.nextCursor,
        total: total ?? this.total,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      );

  /// 追加下一页（游标分页）。
  ForumListState append(ForumListState next) => ForumListState(
        posts: <ForumPost>[...posts, ...next.posts],
        boardId: next.boardId ?? boardId,
        nextCursor: next.nextCursor,
        total: next.total ?? total,
      );
}

/// 版块筛选（UI 的 chip 选中项）。
final forumBoardFilterProvider = NotifierProvider<ForumBoardFilter, String?>(
  ForumBoardFilter.new,
);

final class ForumBoardFilter extends Notifier<String?> {
  @override
  String? build() => null;

  /// null = 全部版块。
  void select(String? boardId) => state = boardId;
}

/// 版块列表（只读，用于筛选 chip）。
final forumBoardsProvider = FutureProvider<List<ForumBoard>>((ref) async {
  final ForumPort port = ref.watch(forumRepositoryProvider);
  final Result<List<ForumBoard>> result = await port.listBoards();
  return switch (result) {
    Ok<List<ForumBoard>>(:final List<ForumBoard> value) => value,
    Err<List<ForumBoard>>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 主题列表控制器（application 层：编排用例，不含 IO）。
final forumListControllerProvider =
    AsyncNotifierProvider<ForumListController, ForumListState>(
        ForumListController.new);

final class ForumListController extends AsyncNotifier<ForumListState> {
  static const int pageSize = 10;

  @override
  Future<ForumListState> build() {
    // 版块切换即重新加载：筛选是 build 的入参，因此三态会自然回到 loading。
    final String? boardId = ref.watch(forumBoardFilterProvider);
    return _fetch(ForumPostQuery(boardId: boardId, limit: pageSize));
  }

  Future<void> refresh() async {
    final String? boardId = ref.read(forumBoardFilterProvider);
    state = const AsyncLoading<ForumListState>();
    state = await AsyncValue.guard<ForumListState>(
      () => _fetch(ForumPostQuery(boardId: boardId, limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final ForumListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<ForumListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final ForumListState next = await _fetch(
        ForumPostQuery(
          boardId: current.boardId,
          cursor: current.nextCursor,
          limit: pageSize,
        ),
      );
      state = AsyncData<ForumListState>(current.append(next));
    } on Object catch (error) {
      // 保留已有列表，只挂上翻页错误。
      state = AsyncData<ForumListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<ForumListState> _fetch(ForumPostQuery query) async {
    final ForumPort port = ref.read(forumRepositoryProvider);
    final Result<Page<ForumPost>> result = await port.listPosts(query);
    return switch (result) {
      Ok<Page<ForumPost>>(:final Page<ForumPost> value) => ForumListState(
          posts: value.items,
          boardId: query.boardId,
          nextCursor: value.nextCursor,
          total: value.total,
        ),
      Err<Page<ForumPost>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 主题详情（按 id 取）。
final forumPostProvider = FutureProvider.family<ForumPost, String>((
  ref,
  String postId,
) async {
  final ForumPort port = ref.watch(forumRepositoryProvider);
  final Result<ForumPost> result = await port.getPost(postId);
  return switch (result) {
    Ok<ForumPost>(:final ForumPost value) => value,
    Err<ForumPost>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 回复列表状态（同样区分"翻页失败"与"整页错误"）。
final class ForumReplyListState {
  const ForumReplyListState({
    required this.replies,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<ForumReply> replies;
  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => replies.isEmpty;

  ForumReplyListState copyWith({
    List<ForumReply>? replies,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) =>
      ForumReplyListState(
        replies: replies ?? this.replies,
        nextCursor: nextCursor ?? this.nextCursor,
        total: total ?? this.total,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      );

  ForumReplyListState append(ForumReplyListState next) => ForumReplyListState(
        replies: <ForumReply>[...replies, ...next.replies],
        nextCursor: next.nextCursor,
        total: next.total ?? total,
      );
}

/// 某个主题的回复列表（family 参数 = postId）。
final forumRepliesProvider = AsyncNotifierProvider.family<
    ForumReplyListController, ForumReplyListState, String>(
  ForumReplyListController.new,
);

final class ForumReplyListController
    extends FamilyAsyncNotifier<ForumReplyListState, String> {
  static const int pageSize = 20;

  @override
  Future<ForumReplyListState> build(String postId) =>
      _fetch(ForumReplyQuery(postId: postId, limit: pageSize));

  Future<void> refresh() async {
    state = const AsyncLoading<ForumReplyListState>();
    state = await AsyncValue.guard<ForumReplyListState>(
      () => _fetch(ForumReplyQuery(postId: arg, limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final ForumReplyListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<ForumReplyListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final ForumReplyListState next = await _fetch(
        ForumReplyQuery(
            postId: arg, cursor: current.nextCursor, limit: pageSize),
      );
      state = AsyncData<ForumReplyListState>(current.append(next));
    } on Object catch (error) {
      state = AsyncData<ForumReplyListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<ForumReplyListState> _fetch(ForumReplyQuery query) async {
    final ForumPort port = ref.read(forumRepositoryProvider);
    final Result<Page<ForumReply>> result = await port.listReplies(query);
    return switch (result) {
      Ok<Page<ForumReply>>(:final Page<ForumReply> value) =>
        ForumReplyListState(
          replies: value.items,
          nextCursor: value.nextCursor,
          total: value.total,
        ),
      Err<Page<ForumReply>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 论坛写操作（发帖 / 回复 / 举报）。
///
/// 与 `groupbuy` 一致：**不持有 `Ref`**，只拿端口 + 失效回调，
/// 因此这个对象能在测试里直接构造，也不依赖 Riverpod 的内部类型。
final forumActionsProvider = Provider<ForumActions>((ref) {
  final ForumPort port = ref.watch(forumRepositoryProvider);
  return ForumActions(
    port: port,
    onPostMutated: (String postId) {
      ref.invalidate(forumListControllerProvider);
      ref.invalidate(forumPostProvider(postId));
    },
    onReplyCreated: (String postId) {
      ref.invalidate(forumRepliesProvider(postId));
      ref.invalidate(forumPostProvider(postId));
    },
  );
});

final class ForumActions {
  const ForumActions({
    required this.port,
    required this.onPostMutated,
    required this.onReplyCreated,
  });

  final ForumPort port;

  /// 主题被创建/被举报后的通知（用于失效读 provider）。
  final void Function(String postId) onPostMutated;

  /// 新回复成功后的通知。
  final void Function(String postId) onReplyCreated;

  /// 发帖。成功后失效列表，让新帖按后端排序出现。
  Future<ForumPost> createPost(CreateForumPostCommand command) async {
    final ForumPost post = _requireSuccess(await port.createPost(command));
    onPostMutated(post.id);
    return post;
  }

  /// 回复。
  Future<ForumReply> reply(CreateForumReplyCommand command) async {
    final ForumReply reply = _requireSuccess(await port.createReply(command));
    onReplyCreated(command.postId);
    return reply;
  }

  /// 举报（契约 §11.2 的 action 名 `report`）。
  ///
  /// 举报成功**不**失效帖子 provider：被举报内容在阈值达成前仍然可见，
  /// 强制刷新只会让用户以为自己的操作把帖子弄没了。
  Future<ForumReport> report(CreateForumReportCommand command) async {
    final Result<ForumReport> result = await port.report(command);
    final ForumReport? report = result.valueOrNull;
    if (report == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    return report;
  }

  T _requireSuccess<T>(Result<T> result) {
    final T? value = result.valueOrNull;
    if (value == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    return value;
  }
}
