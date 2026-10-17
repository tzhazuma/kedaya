import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../application/session_controller.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/faq.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/faq_port.dart';
import '../../../domain/ports/local_cache_port.dart';

/// 设备本地投票者 id 的缓存键（未登录时用它做「有用」的幂等键）。
const String faqDeviceVoterCacheKey = 'faq.deviceVoterId';

/// 分类 + 搜索的筛选条件（不含分页游标 —— 游标属于加载过程，不属于筛选条件）。
final class FaqFilter {
  const FaqFilter({this.category, this.keyword = ''});

  /// null = 全部分类。
  final String? category;

  final String keyword;

  bool get isSearching => keyword.trim().isNotEmpty;

  FaqFilter withCategory(String? next) =>
      FaqFilter(category: next, keyword: keyword);

  FaqFilter withKeyword(String next) =>
      FaqFilter(category: category, keyword: next);

  @override
  bool operator ==(Object other) =>
      other is FaqFilter &&
      other.category == category &&
      other.keyword == keyword;

  @override
  int get hashCode => Object.hash(category, keyword);

  @override
  String toString() => 'FaqFilter(category=$category, keyword="$keyword")';
}

/// 未登录时的设备本地 id。
///
/// 契约 §8 要求启动路径上的读取是**同步**的，所以这里直接读 [LocalCachePort.readJson]
/// （它本来就是同步契约）；首次生成后异步落盘，保证下次冷启动拿到同一个 id ——
/// 否则"同一用户重复点只算一次"在未登录场景下会失效。
final faqDeviceVoterIdProvider = Provider<String>((ref) {
  final LocalCachePort cache = ref.watch(localCacheProvider);
  final Object? stored = cache.readJson(faqDeviceVoterCacheKey);
  if (stored is String && stored.isNotEmpty) return stored;
  final String generated =
      'dev-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
  unawaited(cache.writeJson(faqDeviceVoterCacheKey, generated));
  return generated;
});

/// 「有用」投票者标识（幂等键）。
///
/// 已登录 → `u:<userId>`；未登录 → `d:<deviceId>`（契约 §2.8：检索无需登录）。
/// 两种前缀不会混淆，因此未登录时投的票不会被算到之后登录的某个人头上。
final faqVoterProvider = Provider<String>((ref) {
  final String? userId =
      ref.watch(sessionControllerProvider).valueOrNull?.user.userId;
  final String deviceId = ref.watch(faqDeviceVoterIdProvider);
  return FaqVoter.resolve(userId: userId, deviceId: deviceId).key;
});

/// 分类 / 关键词筛选。
final faqFilterProvider = NotifierProvider<FaqFilterNotifier, FaqFilter>(
  FaqFilterNotifier.new,
);

final class FaqFilterNotifier extends Notifier<FaqFilter> {
  @override
  FaqFilter build() => const FaqFilter();

  void selectCategory(String? category) => state = state.withCategory(category);

  void setKeyword(String keyword) => state = state.withKeyword(keyword);

  void clear() => state = const FaqFilter();
}

/// 分类导航（只读）。
final faqCategoriesProvider = FutureProvider<List<FaqCategory>>((ref) async {
  final FaqPort port = ref.watch(faqRepositoryProvider);
  final Result<List<FaqCategory>> result = await port.listCategories();
  return switch (result) {
    Ok<List<FaqCategory>>(:final List<FaqCategory> value) => value,
    Err<List<FaqCategory>>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 文章列表状态。
final class FaqListState {
  const FaqListState({
    required this.articles,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<FaqArticle> articles;
  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => articles.isEmpty;

  FaqListState copyWith({
    List<FaqArticle>? articles,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) =>
      FaqListState(
        articles: articles ?? this.articles,
        nextCursor: nextCursor ?? this.nextCursor,
        total: total ?? this.total,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      );

  FaqListState append(FaqListState next) => FaqListState(
        articles: <FaqArticle>[...articles, ...next.articles],
        nextCursor: next.nextCursor,
        total: next.total ?? total,
      );
}

/// 文章列表控制器（分类 / 搜索变化即重新加载，因此三态会自然回到 loading）。
final faqListControllerProvider =
    AsyncNotifierProvider<FaqListController, FaqListState>(
  FaqListController.new,
);

final class FaqListController extends AsyncNotifier<FaqListState> {
  static const int pageSize = 10;

  @override
  Future<FaqListState> build() {
    final FaqFilter filter = ref.watch(faqFilterProvider);
    return _fetch(
      FaqQuery(
          category: filter.category, keyword: filter.keyword, limit: pageSize),
    );
  }

  Future<void> refresh() async {
    final FaqFilter filter = ref.read(faqFilterProvider);
    state = const AsyncLoading<FaqListState>();
    state = await AsyncValue.guard<FaqListState>(
      () => _fetch(
        FaqQuery(
            category: filter.category,
            keyword: filter.keyword,
            limit: pageSize),
      ),
    );
  }

  Future<void> loadMore() async {
    final FaqListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<FaqListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    final FaqFilter filter = ref.read(faqFilterProvider);
    try {
      final FaqListState next = await _fetch(
        FaqQuery(
          category: filter.category,
          keyword: filter.keyword,
          cursor: current.nextCursor,
          limit: pageSize,
        ),
      );
      state = AsyncData<FaqListState>(current.append(next));
    } on Object catch (error) {
      state = AsyncData<FaqListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<FaqListState> _fetch(FaqQuery query) async {
    final FaqPort port = ref.read(faqRepositoryProvider);
    final Result<Page<FaqArticle>> result = await port.listArticles(query);
    return switch (result) {
      Ok<Page<FaqArticle>>(:final Page<FaqArticle> value) => FaqListState(
          articles: value.items,
          nextCursor: value.nextCursor,
          total: value.total,
        ),
      Err<Page<FaqArticle>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 本端已投过「有用」的文章（articleId -> 服务端返回的最新有用数）。
///
/// 为什么不是"投票后 `ref.invalidate` 整个列表"：那会把列表打回 loading，
/// 用户点一下「有用」整页闪一次，体验很差。这里改为**局部覆盖**：
/// 只替换这一条的计数，其余不动。键的存在本身就表示"我已标记有用"。
///
/// 只存 `int` 而不是整篇 `FaqArticle`：`services/api` 的 helpful 端点
/// 只回 `{ id, helpfulCount, counted }`，不回整篇文章。
final faqHelpfulOverridesProvider =
    NotifierProvider<FaqHelpfulOverrides, Map<String, int>>(
        FaqHelpfulOverrides.new);

final class FaqHelpfulOverrides extends Notifier<Map<String, int>> {
  @override
  Map<String, int> build() => const <String, int>{};

  void put(String articleId, int helpfulCount) =>
      state = <String, int>{...state, articleId: helpfulCount};

  bool hasVoted(String articleId) => state.containsKey(articleId);
}

/// 「有用」动作。
///
/// 与其它写操作一致：**不持有 `Ref`**，只拿端口 + voterId + 回调。
final faqHelpfulProvider = Provider<FaqHelpfulActions>((ref) {
  final FaqPort port = ref.watch(faqRepositoryProvider);
  final String voterId = ref.watch(faqVoterProvider);
  return FaqHelpfulActions(
    port: port,
    voterId: voterId,
    onVoted: (FaqHelpfulResult result) => ref
        .read(faqHelpfulOverridesProvider.notifier)
        .put(result.articleId, result.helpfulCount),
  );
});

final class FaqHelpfulActions {
  const FaqHelpfulActions({
    required this.port,
    required this.voterId,
    required this.onVoted,
  });

  final FaqPort port;

  /// 幂等键（见 [faqVoterProvider]）。
  final String voterId;

  /// 投票成功（含幂等命中）后的通知，用于局部覆盖该文章的计数。
  final void Function(FaqHelpfulResult result) onVoted;

  /// 标记「有用」。
  ///
  /// **幂等**：重复点击不会报错，也不会重复计数 —— 返回值的
  /// [FaqHelpfulResult.counted] 为 `false`，UI 据此提示"你已经标记过"。
  Future<FaqHelpfulResult> markHelpful(String articleId) async {
    final Result<FaqHelpfulResult> result = await port.markHelpful(
      articleId,
      voterId: voterId,
    );
    final FaqHelpfulResult? value = result.valueOrNull;
    if (value == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    onVoted(value);
    return value;
  }
}

/// 我的工单列表状态。
final class FaqTicketListState {
  const FaqTicketListState({required this.tickets, this.total});

  final List<FaqTicket> tickets;
  final int? total;

  bool get isEmpty => tickets.isEmpty;
}

final faqTicketsControllerProvider =
    AsyncNotifierProvider<FaqTicketsController, FaqTicketListState>(
  FaqTicketsController.new,
);

final class FaqTicketsController extends AsyncNotifier<FaqTicketListState> {
  static const int pageSize = 20;

  @override
  Future<FaqTicketListState> build() => _fetch();

  Future<void> refresh() async {
    state = const AsyncLoading<FaqTicketListState>();
    state = await AsyncValue.guard<FaqTicketListState>(_fetch);
  }

  Future<FaqTicketListState> _fetch() async {
    final FaqPort port = ref.read(faqRepositoryProvider);
    final Result<Page<FaqTicket>> result =
        await port.listMyTickets(limit: pageSize);
    return switch (result) {
      Ok<Page<FaqTicket>>(:final Page<FaqTicket> value) => FaqTicketListState(
          tickets: value.items,
          total: value.total,
        ),
      Err<Page<FaqTicket>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 提交工单（同样不持有 `Ref`）。
final faqTicketActionsProvider = Provider<FaqTicketActions>((ref) {
  final FaqPort port = ref.watch(faqRepositoryProvider);
  return FaqTicketActions(
    port: port,
    onSubmitted: () => ref.invalidate(faqTicketsControllerProvider),
  );
});

final class FaqTicketActions {
  const FaqTicketActions({required this.port, required this.onSubmitted});

  final FaqPort port;
  final void Function() onSubmitted;

  Future<FaqTicket> submit(SubmitFaqTicketCommand command) async {
    final Result<FaqTicket> result = await port.submitTicket(command);
    final FaqTicket? ticket = result.valueOrNull;
    if (ticket == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    onSubmitted();
    return ticket;
  }
}
