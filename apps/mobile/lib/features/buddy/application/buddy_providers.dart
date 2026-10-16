import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/buddy.dart';
import '../../../domain/models/buddy_application.dart';
import '../../../domain/models/buddy_matching.dart';
import '../../../domain/models/buddy_profile.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/buddy_port.dart';

/// 活动列表状态。
///
/// 与 `groupbuy` / `forum` / `wildlife` 一致：刻意把「翻页失败」与「整页错误」
/// 分开 —— 已经有数据时，翻页失败不该把列表打回错误态（用户会丢失已看到的内容）。
final class BuddyListState {
  const BuddyListState({
    required this.posts,
    required this.section,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<BuddyPost> posts;

  /// 当前板块（三板块分栏的选中项）。
  final BuddySection section;

  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;

  /// 翻页失败的原因；列表本身仍然可用。
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => posts.isEmpty;

  BuddyListState copyWith({
    List<BuddyPost>? posts,
    BuddySection? section,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) => BuddyListState(
    posts: posts ?? this.posts,
    section: section ?? this.section,
    nextCursor: nextCursor ?? this.nextCursor,
    total: total ?? this.total,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    loadMoreError: clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
  );

  /// 追加下一页（游标分页）。
  BuddyListState append(BuddyListState next) => BuddyListState(
    posts: <BuddyPost>[...posts, ...next.posts],
    section: next.section,
    nextCursor: next.nextCursor,
    total: next.total ?? total,
  );
}

/// 三板块分栏的选中项（列表页与推荐页共用）。
final buddySectionFilterProvider = NotifierProvider<BuddySectionFilter, BuddySection>(
  BuddySectionFilter.new,
);

final class BuddySectionFilter extends Notifier<BuddySection> {
  @override
  BuddySection build() => BuddySection.sport;

  /// 只会接受三个真实板块之一（[BuddySection.unknown] 被忽略）。
  void select(BuddySection section) {
    if (!section.isMatchable) return;
    state = section;
  }
}

/// 活动列表控制器（application 层：编排用例，不含 IO）。
final buddyListControllerProvider =
    AsyncNotifierProvider<BuddyListController, BuddyListState>(BuddyListController.new);

final class BuddyListController extends AsyncNotifier<BuddyListState> {
  static const int pageSize = 10;

  @override
  Future<BuddyListState> build() {
    // 板块切换即重新加载：筛选是 build 的入参，因此三态会自然回到 loading。
    final BuddySection section = ref.watch(buddySectionFilterProvider);
    return _fetch(BuddyPostQuery(section: section, limit: pageSize));
  }

  Future<void> refresh() async {
    final BuddySection section = ref.read(buddySectionFilterProvider);
    state = const AsyncLoading<BuddyListState>();
    state = await AsyncValue.guard<BuddyListState>(
      () => _fetch(BuddyPostQuery(section: section, limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final BuddyListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<BuddyListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final BuddyListState next = await _fetch(
        BuddyPostQuery(
          section: current.section,
          cursor: current.nextCursor,
          limit: pageSize,
        ),
      );
      state = AsyncData<BuddyListState>(current.append(next));
    } on Object catch (error) {
      // 保留已有列表，只挂上翻页错误。
      state = AsyncData<BuddyListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<BuddyListState> _fetch(BuddyPostQuery query) async {
    final BuddyPort port = ref.read(buddyRepositoryProvider);
    final Result<Page<BuddyPost>> result = await port.listPosts(query);
    return switch (result) {
      Ok<Page<BuddyPost>>(:final Page<BuddyPost> value) => BuddyListState(
        posts: value.items,
        section: query.section ?? BuddySection.sport,
        nextCursor: value.nextCursor,
        total: value.total,
      ),
      Err<Page<BuddyPost>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 活动详情（按 id 取）。
final buddyPostProvider = FutureProvider.family<BuddyPost, String>((
  ref,
  String postId,
) async {
  final BuddyPort port = ref.watch(buddyRepositoryProvider);
  final Result<BuddyPost> result = await port.getPost(postId);
  return switch (result) {
    Ok<BuddyPost>(:final BuddyPost value) => value,
    Err<BuddyPost>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 我的匹配资料。
final buddyProfileProvider = FutureProvider<BuddyProfile>((ref) async {
  final BuddyPort port = ref.watch(buddyRepositoryProvider);
  final Result<BuddyProfile> result = await port.getMyProfile();
  return switch (result) {
    Ok<BuddyProfile>(:final BuddyProfile value) => value,
    Err<BuddyProfile>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 我作为**申请人**的申请列表（`GET /buddy/applications`）。
final buddyMyApplicationsProvider = FutureProvider<List<BuddyApplication>>((ref) async {
  final BuddyPort port = ref.watch(buddyRepositoryProvider);
  final Result<List<BuddyApplication>> result = await port.listApplications();
  return switch (result) {
    Ok<List<BuddyApplication>>(:final List<BuddyApplication> value) => value,
    Err<List<BuddyApplication>>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 某个帖子收到的申请（**仅发起人**可见，规格 §6.1）。
final buddyPostApplicationsProvider =
    FutureProvider.family<List<BuddyApplication>, String>((ref, String postId) async {
      final BuddyPort port = ref.watch(buddyRepositoryProvider);
      final Result<List<BuddyApplication>> result = await port.listApplications(
        postId: postId,
      );
      return switch (result) {
        Ok<List<BuddyApplication>>(:final List<BuddyApplication> value) => value,
        Err<List<BuddyApplication>>(:final ApiError error, :final String? traceId) =>
          throw ApiException(error, traceId: traceId),
      };
    });

// ------------------------------------------------------------------ 推荐

/// 推荐页状态（**理由必须展示**，规格 §1.1 G3）。
final class BuddyRecommendState {
  const BuddyRecommendState({
    required this.items,
    required this.matchMode,
    required this.section,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<BuddyRecommendation> items;

  /// **必须暴露**给 UI（规格 §5.7）：`rule` 模式下不得声称"智能推荐"。
  final BuddyMatchMode matchMode;

  final BuddySection section;
  final String? nextCursor;
  final bool isLoadingMore;
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => items.isEmpty;

  BuddyRecommendState copyWith({
    List<BuddyRecommendation>? items,
    BuddyMatchMode? matchMode,
    BuddySection? section,
    String? nextCursor,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) => BuddyRecommendState(
    items: items ?? this.items,
    matchMode: matchMode ?? this.matchMode,
    section: section ?? this.section,
    nextCursor: nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    loadMoreError: clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
  );

  BuddyRecommendState append(BuddyRecommendState next) => BuddyRecommendState(
    items: <BuddyRecommendation>[...items, ...next.items],
    matchMode: next.matchMode,
    section: next.section,
    nextCursor: next.nextCursor,
  );
}

/// 推荐控制器。
final buddyRecommendControllerProvider =
    AsyncNotifierProvider<BuddyRecommendController, BuddyRecommendState>(
      BuddyRecommendController.new,
    );

final class BuddyRecommendController extends AsyncNotifier<BuddyRecommendState> {
  static const int pageSize = 10;

  @override
  Future<BuddyRecommendState> build() {
    final BuddySection section = ref.watch(buddySectionFilterProvider);
    // 匹配资料变化（例如刚打开匹配开关）时自动重新推荐。
    // 规格 §5.7：未开启匹配资料时**不报错**，而是返回 rule 模式 + 「按时间排序」。
    ref.watch(buddyProfileProvider);
    return _fetch(BuddyRecommendQuery(section: section, limit: pageSize));
  }

  Future<void> refresh() async {
    final BuddySection section = ref.read(buddySectionFilterProvider);
    state = const AsyncLoading<BuddyRecommendState>();
    state = await AsyncValue.guard<BuddyRecommendState>(
      () => _fetch(BuddyRecommendQuery(section: section, limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final BuddyRecommendState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<BuddyRecommendState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final BuddyRecommendState next = await _fetch(
        BuddyRecommendQuery(
          section: current.section,
          cursor: current.nextCursor,
          limit: pageSize,
        ),
      );
      state = AsyncData<BuddyRecommendState>(current.append(next));
    } on Object catch (error) {
      state = AsyncData<BuddyRecommendState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<BuddyRecommendState> _fetch(BuddyRecommendQuery query) async {
    final BuddyPort port = ref.read(buddyRepositoryProvider);
    final Result<BuddyRecommendationPage> result = await port.recommend(query);
    return switch (result) {
      Ok<BuddyRecommendationPage>(:final BuddyRecommendationPage value) =>
        BuddyRecommendState(
          items: value.items,
          matchMode: value.matchMode,
          section: query.section,
          nextCursor: value.nextCursor,
        ),
      Err<BuddyRecommendationPage>(
        :final ApiError error,
        :final String? traceId,
      ) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

// ------------------------------------------------------------------ 写操作

/// 找搭子的写操作（发布 / 申请 / 撤回 / 审批 / 关闭 / 反馈 / 匹配资料）。
///
/// 与 `groupbuy` / `forum` 一致：**不持有 `Ref`**，只拿端口 + 失效回调，
/// 因此这个对象能在测试里直接构造，也不依赖 Riverpod 的内部类型。
final buddyActionsProvider = Provider<BuddyActions>((ref) {
  final BuddyPort port = ref.watch(buddyRepositoryProvider);
  return BuddyActions(
    port: port,
    onListMutated: () {
      ref.invalidate(buddyListControllerProvider);
      ref.invalidate(buddyRecommendControllerProvider);
    },
    onPostMutated: (String postId) {
      ref.invalidate(buddyPostProvider(postId));
      ref.invalidate(buddyListControllerProvider);
      ref.invalidate(buddyRecommendControllerProvider);
    },
    onApplicationsMutated: (String postId) {
      ref.invalidate(buddyPostApplicationsProvider(postId));
      ref.invalidate(buddyMyApplicationsProvider);
      ref.invalidate(buddyPostProvider(postId));
    },
    onProfileMutated: () {
      ref.invalidate(buddyProfileProvider);
      ref.invalidate(buddyRecommendControllerProvider);
    },
  );
});

final class BuddyActions {
  const BuddyActions({
    required this.port,
    required this.onListMutated,
    required this.onPostMutated,
    required this.onApplicationsMutated,
    required this.onProfileMutated,
  });

  final BuddyPort port;

  /// 列表整体失效（发布后）。
  final void Function() onListMutated;

  /// 单个帖子被改动（关闭 / 反馈）。
  final void Function(String postId) onPostMutated;

  /// 申请被改动（申请 / 撤回 / 审批）。
  final void Function(String postId) onApplicationsMutated;

  /// 匹配资料被改动（保存 / 删除 / 开关）。
  final void Function() onProfileMutated;

  /// 发布活动。
  Future<BuddyPost> createPost(CreateBuddyPostCommand command) async {
    final BuddyPost post = _requireSuccess(await port.createPost(command));
    onListMutated();
    return post;
  }

  /// 申请加入（**不**占名额，规格 §5.5）。
  Future<BuddyApplication> join(BuddyJoinCommand command) async {
    final BuddyApplication application = _requireSuccess(await port.join(command));
    onApplicationsMutated(command.postId);
    return application;
  }

  /// 撤回申请。
  Future<BuddyApplication> leave(String postId) async {
    final BuddyApplication application = _requireSuccess(await port.leave(postId));
    onApplicationsMutated(postId);
    return application;
  }

  /// 发起人审批。
  Future<BuddyApplication> decide(BuddyDecideCommand command) async {
    final BuddyApplication application = _requireSuccess(await port.decide(command));
    onApplicationsMutated(command.postId);
    return application;
  }

  /// 发起人关闭活动。
  Future<BuddyPost> closePost(String postId) async {
    final BuddyPost post = _requireSuccess(await port.closePost(postId));
    onPostMutated(postId);
    return post;
  }

  /// 提交 like / dislike / skip。
  ///
  /// **不**失效列表 provider：反馈只是给算法用的信号，立刻把列表重排会让
  /// 用户以为"我点了一下就把内容弄没了"（与 `forum` 的举报同理）。
  /// 下一次进入推荐页时自然反映（服务端会 `DEL` 缓存，规格 §5.8）。
  Future<BuddyMatchFeedback> submitFeedback(BuddyMatchFeedback feedback) async {
    final Result<BuddyMatchFeedback> result = await port.submitFeedback(feedback);
    final BuddyMatchFeedback? stored = result.valueOrNull;
    if (stored == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    return stored;
  }

  /// 保存匹配资料（`PUT`，整体替换）。
  Future<BuddyProfile> saveProfile(BuddyProfile profile) async {
    final BuddyProfile saved = _requireSuccess(await port.saveMyProfile(profile));
    onProfileMutated();
    return saved;
  }

  /// 删除匹配资料（硬删，规格 §6.3「可随时撤回」）。
  Future<void> deleteProfile() async {
    final Result<Unit> result = await port.deleteMyProfile();
    if (result.isErr) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    onProfileMutated();
  }

  T _requireSuccess<T>(Result<T> result) {
    final T? value = result.valueOrNull;
    if (value == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    return value;
  }
}
