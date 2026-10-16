import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/groupbuy_order.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/ports/groupbuy_port.dart';

/// 拼单列表状态。
///
/// 刻意把"加载更多失败"与"整页错误"分开：已经有数据时，翻页失败不应该把
/// 列表打回错误态（用户会丢失已看到的内容）。
final class GroupbuyListState {
  const GroupbuyListState({
    required this.orders,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<GroupbuyOrder> orders;
  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;

  /// 翻页失败的原因；列表本身仍然可用。
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => orders.isEmpty;

  GroupbuyListState copyWith({
    List<GroupbuyOrder>? orders,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) => GroupbuyListState(
    orders: orders ?? this.orders,
    nextCursor: nextCursor ?? this.nextCursor,
    total: total ?? this.total,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    loadMoreError: clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
  );

  /// 追加下一页（游标分页）。
  GroupbuyListState append(GroupbuyListState next) => GroupbuyListState(
    orders: <GroupbuyOrder>[...orders, ...next.orders],
    nextCursor: next.nextCursor,
    total: next.total ?? total,
  );
}

/// 拼单列表控制器（application 层：编排用例，不含 IO）。
final groupbuyListControllerProvider =
    AsyncNotifierProvider<GroupbuyListController, GroupbuyListState>(
      GroupbuyListController.new,
    );

final class GroupbuyListController extends AsyncNotifier<GroupbuyListState> {
  static const int pageSize = 10;

  @override
  Future<GroupbuyListState> build() => _fetch(const GroupbuyQuery(limit: pageSize));

  Future<void> refresh() async {
    state = const AsyncLoading<GroupbuyListState>();
    state = await AsyncValue.guard<GroupbuyListState>(
      () => _fetch(const GroupbuyQuery(limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final GroupbuyListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<GroupbuyListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final GroupbuyListState next = await _fetch(
        GroupbuyQuery(cursor: current.nextCursor, limit: pageSize),
      );
      state = AsyncData<GroupbuyListState>(current.append(next));
    } on Object catch (error) {
      // 保留已有列表，只挂上翻页错误。
      state = AsyncData<GroupbuyListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<GroupbuyListState> _fetch(GroupbuyQuery query) async {
    final GroupbuyPort port = ref.read(groupbuyRepositoryProvider);
    final Result<Page<GroupbuyOrder>> result = await port.listOrders(query);
    return switch (result) {
      Ok<Page<GroupbuyOrder>>(:final Page<GroupbuyOrder> value) => GroupbuyListState(
        orders: value.items,
        nextCursor: value.nextCursor,
        total: value.total,
      ),
      Err<Page<GroupbuyOrder>>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };
  }
}

/// 拼单详情（按 id 取）。
final groupbuyDetailProvider = FutureProvider.family<GroupbuyOrder, String>((
  ref,
  String orderId,
) async {
  final GroupbuyPort port = ref.watch(groupbuyRepositoryProvider);
  final Result<GroupbuyOrder> result = await port.getOrder(orderId);
  return switch (result) {
    Ok<GroupbuyOrder>(:final GroupbuyOrder value) => value,
    Err<GroupbuyOrder>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };
});

/// 拼单写操作（参团 / 取消）。
///
/// 刻意**不持有 `Ref`**：只拿端口 + 一个失效回调，于是 application 层的对象
/// 不依赖 Riverpod 的内部类型，也能在测试里直接构造。
final groupbuyActionsProvider = Provider<GroupbuyActions>((ref) {
  final GroupbuyPort port = ref.watch(groupbuyRepositoryProvider);
  return GroupbuyActions(
    port: port,
    onMutated: (String orderId) {
      // 写成功后失效读 provider —— 让列表与详情重新拉取，避免本地拼接状态。
      ref.invalidate(groupbuyListControllerProvider);
      ref.invalidate(groupbuyDetailProvider(orderId));
    },
  );
});

final class GroupbuyActions {
  const GroupbuyActions({required this.port, required this.onMutated});

  final GroupbuyPort port;

  /// 写成功后的通知（用于失效读 provider）。
  final void Function(String orderId) onMutated;

  Future<GroupbuyOrder> join(String orderId, {int quantity = 1}) async =>
      _requireSuccess(await port.joinOrder(orderId, quantity: quantity), orderId);

  Future<GroupbuyOrder> cancel(String orderId) async =>
      _requireSuccess(await port.cancelOrder(orderId), orderId);

  GroupbuyOrder _requireSuccess(Result<GroupbuyOrder> result, String orderId) {
    final GroupbuyOrder? order = result.valueOrNull;
    if (order == null) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    onMutated(orderId);
    return order;
  }
}
