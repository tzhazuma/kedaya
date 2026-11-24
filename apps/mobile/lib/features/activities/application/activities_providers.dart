import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/activity.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/api_request.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/models/wechat_history.dart';
import '../../../domain/ports/activities_port.dart';

/// 可注入的“现在”（默认规则、倒计时、默认开始时间都依赖它）。
final activitiesClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 列表筛选条件（来源 / 状态；`null` = 全部）。
///
/// 筛选在客户端对已取回的数据即时生效：切换筛选不会重新打网络请求。
final activityFilterProvider =
    StateProvider<ActivityFilter>((ref) => const ActivityFilter());

/// 活动列表每页条数（测试可覆盖成小页，验证游标翻页）。
final activitiesPageSizeProvider = Provider<int>((ref) => defaultPageSize);

/// 提醒列表每页条数（同上）。
final activityRemindersPageSizeProvider =
    Provider<int>((ref) => defaultPageSize);

/// 活动列表状态。
///
/// 三个状态查询（默认 / dismissed / archived）各有自己的游标：
/// 默认查询返回 candidate + confirmed，另外两个必须显式查询。
/// [hasMore] 只要任一查询还有下一页就为真；[loadMore] 只继续未取完的分支。
final class ActivitiesListState {
  const ActivitiesListState({
    required this.items,
    this.nextCursor,
    this.dismissedCursor,
    this.archivedCursor,
    this.isLoadingMore = false,
    this.loadMoreError,
    this.refreshError,
  });

  final List<ActivityItem> items;

  /// 默认查询（candidate + confirmed）的下一页游标。
  final String? nextCursor;

  final String? dismissedCursor;
  final String? archivedCursor;

  final bool isLoadingMore;

  /// 翻页失败；已有列表仍然可用。
  final Object? loadMoreError;

  /// 下拉刷新失败；旧列表仍然可用。
  final Object? refreshError;

  bool get hasMore =>
      nextCursor != null || dismissedCursor != null || archivedCursor != null;

  bool get isEmpty => items.isEmpty;

  ActivitiesListState copyWith({
    List<ActivityItem>? items,
    String? nextCursor,
    String? dismissedCursor,
    String? archivedCursor,
    bool? isLoadingMore,
    Object? loadMoreError,
    Object? refreshError,
    bool clearLoadMoreError = false,
    bool clearRefreshError = false,
  }) =>
      ActivitiesListState(
        items: items ?? this.items,
        nextCursor: nextCursor ?? this.nextCursor,
        dismissedCursor: dismissedCursor ?? this.dismissedCursor,
        archivedCursor: archivedCursor ?? this.archivedCursor,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
        refreshError:
            clearRefreshError ? null : (refreshError ?? this.refreshError),
      );

  /// 追加下一页；游标以新页为准（null 表示该分支已取完）。
  ActivitiesListState append(ActivitiesListState next) {
    final Map<String, ActivityItem> byId = <String, ActivityItem>{
      for (final ActivityItem item in items) item.id: item,
    };
    for (final ActivityItem item in next.items) {
      byId[item.id] = item;
    }
    return ActivitiesListState(
      items: byId.values.toList(growable: false),
      nextCursor: next.nextCursor,
      dismissedCursor: next.dismissedCursor,
      archivedCursor: next.archivedCursor,
    );
  }
}

/// 活动列表（服务端顺序，筛选由 [filteredActivitiesProvider] 负责）。
final activitiesListControllerProvider =
    AsyncNotifierProvider<ActivitiesListController, ActivitiesListState>(
  ActivitiesListController.new,
);

final class ActivitiesListController
    extends AsyncNotifier<ActivitiesListState> {
  @override
  Future<ActivitiesListState> build() => _fetch(
        includeActive: true,
        includeDismissed: true,
        includeArchived: true,
      );

  /// 手动刷新（下拉刷新 / 「刷新」按钮）。
  ///
  /// 失败时**保留旧数据**：下拉刷新不该把已经看到的活动清空成错误页。
  Future<void> refresh() async {
    final ActivitiesListState? previous = state.valueOrNull;
    try {
      final ActivitiesListState next = await _fetch(
        includeActive: true,
        includeDismissed: true,
        includeArchived: true,
      );
      state = AsyncData<ActivitiesListState>(next);
    } on Object catch (error, stackTrace) {
      if (previous == null) {
        state = AsyncError<ActivitiesListState>(error, stackTrace);
      } else {
        state = AsyncData<ActivitiesListState>(
          previous.copyWith(refreshError: error),
        );
      }
    }
  }

  Future<void> loadMore() async {
    final ActivitiesListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData<ActivitiesListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final ActivitiesListState next = await _fetch(
        includeActive: current.nextCursor != null,
        activeCursor: current.nextCursor,
        includeDismissed: current.dismissedCursor != null,
        dismissedCursor: current.dismissedCursor,
        includeArchived: current.archivedCursor != null,
        archivedCursor: current.archivedCursor,
      );
      state = AsyncData<ActivitiesListState>(current.append(next));
    } on Object catch (error) {
      // 保留已有列表，只挂上翻页错误。
      state = AsyncData<ActivitiesListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<ActivitiesListState> _fetch({
    required bool includeActive,
    String? activeCursor,
    required bool includeDismissed,
    String? dismissedCursor,
    required bool includeArchived,
    String? archivedCursor,
  }) async {
    final ActivitiesPort port = ref.read(activitiesRepositoryProvider);
    final int limit = ref.read(activitiesPageSizeProvider);

    final Future<Page<ActivityItem>?> activeFuture = includeActive
        ? _load(port.list(cursor: activeCursor, limit: limit))
        : Future<Page<ActivityItem>?>.value();
    final Future<Page<ActivityItem>?> dismissedFuture = includeDismissed
        ? _load(port.list(
            status: ActivityStatus.dismissed,
            cursor: dismissedCursor,
            limit: limit,
          ))
        : Future<Page<ActivityItem>?>.value();
    final Future<Page<ActivityItem>?> archivedFuture = includeArchived
        ? _load(port.list(
            status: ActivityStatus.archived,
            cursor: archivedCursor,
            limit: limit,
          ))
        : Future<Page<ActivityItem>?>.value();

    final List<Page<ActivityItem>?> pages =
        await Future.wait<Page<ActivityItem>?>(<Future<Page<ActivityItem>?>>[
      activeFuture,
      dismissedFuture,
      archivedFuture,
    ]);

    final Map<String, ActivityItem> byId = <String, ActivityItem>{};
    for (final Page<ActivityItem>? page in pages) {
      if (page == null) continue;
      for (final ActivityItem item in page.items) {
        byId[item.id] = item;
      }
    }

    return ActivitiesListState(
      items: byId.values.toList(growable: false),
      nextCursor: pages[0]?.nextCursor,
      dismissedCursor: pages[1]?.nextCursor,
      archivedCursor: pages[2]?.nextCursor,
    );
  }

  Future<Page<ActivityItem>?> _load(
    Future<Result<Page<ActivityItem>>> pending,
  ) async =>
      _require<Page<ActivityItem>>(await pending);
}

/// 列表 + 当前筛选条件（`AsyncValue` 三态保持不变）。
final filteredActivitiesProvider =
    Provider<AsyncValue<List<ActivityItem>>>((ref) {
  final ActivityFilter filter = ref.watch(activityFilterProvider);
  return ref.watch(activitiesListControllerProvider).whenData(
      (ActivitiesListState state) => filterActivities(state.items, filter));
});

/// 活动详情。
final activityDetailProvider =
    FutureProvider.family<ActivityItem, String>((ref, String id) async {
  final ActivityItem item = _require<ActivityItem>(
    await ref.watch(activitiesRepositoryProvider).get(id),
  );
  return item;
});

/// 某活动的提醒列表状态（只有 confirmed 活动的页面会 watch 它）。
final class ActivityRemindersState {
  const ActivityRemindersState({
    required this.reminders,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<ActivityReminderItem> reminders;
  final String? nextCursor;
  final bool isLoadingMore;
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => reminders.isEmpty;

  ActivityRemindersState copyWith({
    List<ActivityReminderItem>? reminders,
    String? nextCursor,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) =>
      ActivityRemindersState(
        reminders: reminders ?? this.reminders,
        nextCursor: nextCursor ?? this.nextCursor,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      );

  ActivityRemindersState append(ActivityRemindersState next) {
    final Map<String, ActivityReminderItem> byId =
        <String, ActivityReminderItem>{
      for (final ActivityReminderItem reminder in reminders)
        reminder.id: reminder,
    };
    for (final ActivityReminderItem reminder in next.reminders) {
      byId[reminder.id] = reminder;
    }
    return ActivityRemindersState(
      reminders: byId.values.toList(growable: false),
      nextCursor: next.nextCursor,
    );
  }
}

/// 某活动的提醒列表（family 参数 = activityId）。
final activityRemindersProvider = AsyncNotifierProvider.family<
    ActivityRemindersController, ActivityRemindersState, String>(
  ActivityRemindersController.new,
);

final class ActivityRemindersController
    extends FamilyAsyncNotifier<ActivityRemindersState, String> {
  @override
  Future<ActivityRemindersState> build(String activityId) =>
      _fetch(activityId, cursor: null);

  Future<void> refresh() async {
    state = const AsyncLoading<ActivityRemindersState>();
    state = await AsyncValue.guard<ActivityRemindersState>(
      () => _fetch(arg, cursor: null),
    );
  }

  Future<void> loadMore() async {
    final ActivityRemindersState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData<ActivityRemindersState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final ActivityRemindersState next =
          await _fetch(arg, cursor: current.nextCursor);
      state = AsyncData<ActivityRemindersState>(current.append(next));
    } on Object catch (error) {
      state = AsyncData<ActivityRemindersState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<ActivityRemindersState> _fetch(
    String activityId, {
    required String? cursor,
  }) async {
    final Page<ActivityReminderItem> page =
        _require<Page<ActivityReminderItem>>(
      await ref.read(activitiesRepositoryProvider).listReminders(
            activityId: activityId,
            cursor: cursor,
            limit: ref.read(activityRemindersPageSizeProvider),
          ),
    );
    return ActivityRemindersState(
      reminders: page.items,
      nextCursor: page.nextCursor,
    );
  }
}

/// 写操作集合（只持端口 + 失效回调，测试里可直接构造）。
final activitiesActionsProvider = Provider<ActivityActions>((ref) {
  final ActivitiesPort port = ref.watch(activitiesRepositoryProvider);
  return ActivityActions(
    port: port,
    onMutated: (String? activityId) {
      ref.invalidate(activitiesListControllerProvider);
      if (activityId != null) {
        ref.invalidate(activityDetailProvider(activityId));
        ref.invalidate(activityRemindersProvider(activityId));
      }
    },
    onRemindersMutated: () {
      ref.invalidate(activityRemindersProvider);
      ref.invalidate(activitiesListControllerProvider);
    },
  );
});

final class ActivityActions {
  const ActivityActions({
    required this.port,
    required this.onMutated,
    required this.onRemindersMutated,
  });

  final ActivitiesPort port;

  /// 活动本身被改动（确认 / 忽略 / 创建 / 导入 / 编辑）。
  final void Function(String? activityId) onMutated;

  /// 提醒集合被改动（创建 / 删除 / 派发）。
  final void Function() onRemindersMutated;

  Future<ActivityItem> confirm(String id) async {
    final ActivityItem item = _require<ActivityItem>(await port.confirm(id));
    onMutated(item.id);
    onRemindersMutated();
    return item;
  }

  Future<ActivityItem> dismiss(String id) async {
    final ActivityItem item = _require<ActivityItem>(await port.dismiss(id));
    onMutated(item.id);
    onRemindersMutated();
    return item;
  }

  Future<ActivityItem> createManual(ActivityDraft draft) async {
    final ActivityItem item =
        _require<ActivityItem>(await port.createManual(draft));
    onMutated(item.id);
    return item;
  }

  Future<ActivityItem> patch(
    String id,
    Map<String, Object?> changes,
  ) async {
    final ActivityItem item =
        _require<ActivityItem>(await port.patch(id, changes));
    onMutated(item.id);
    return item;
  }

  Future<ActivityItem> importWechat(WechatImportDraft draft) async {
    final ActivityItem item =
        _require<ActivityItem>(await port.importWechat(draft));
    onMutated(item.id);
    return item;
  }

  /// 解析用户保存的公众号历史消息页。**不写入任何活动** ——
  /// 只是把一页页面变成候选列表，用户勾选后才逐篇走 [importWechat]。
  Future<WechatHistoryPage> parseWechatHistory(String savedPageHtml) async =>
      _require<WechatHistoryPage>(await port.listWechatHistory(savedPageHtml));

  Future<ActivityItem> promoteMail(String mailEventId) async {
    final ActivityItem item =
        _require<ActivityItem>(await port.promoteMail(mailEventId));
    onMutated(item.id);
    return item;
  }

  Future<ActivityReminderItem> addReminder(
    String activityId, {
    required ActivityReminderKind kind,
    required DateTime remindAt,
    ActivityReminderChannel channel = ActivityReminderChannel.inapp,
  }) async {
    final ActivityReminderItem reminder =
        _require<ActivityReminderItem>(await port.createReminder(
      activityId,
      kind: kind,
      remindAt: remindAt,
      channel: channel,
    ));
    onRemindersMutated();
    return reminder;
  }

  Future<void> deleteReminder(String reminderId) async {
    _requireOk(await port.deleteReminder(reminderId));
    onRemindersMutated();
  }

  Future<void> dispatchReminders() async {
    _requireOk(await port.dispatchReminders());
    onRemindersMutated();
  }
}

T _require<T>(Result<T> result) => switch (result) {
      Ok<T>(:final T value) => value,
      Err<T>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };

void _requireOk(Result<Unit> result) => _require<Unit>(result);
