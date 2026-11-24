import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/deadline_item.dart';
import '../data/in_memory_deadline_repository.dart';

/// 「现在」的注入点。
///
/// 剩余时间、逾期判定、筛选「已逾期」与统计条都依赖它；
/// 测试里 override 成固定时刻，就能对「已逾期 N 天」做确定性断言。
final deadlinesClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// DDL 仓库（当前是 feature 内的本机内存演示数据）。
///
/// 演示数据按注入的 `now` 生成，因此测试固定时刻后连默认列表都是确定的。
final deadlineRepositoryProvider = Provider<DeadlineRepository>((ref) {
  final DateTime now = ref.watch(deadlinesClockProvider)();
  return InMemoryDeadlineRepository(items: demoDeadlines(now));
});

/// 列表筛选（全部 / 未完成 / 已逾期 / 已完成）。
///
/// 筛选在客户端对已取回的数据即时生效：切换 chip 不会重新读仓库。
final deadlineFilterProvider =
    StateProvider<DeadlineFilter>((ref) => DeadlineFilter.all);

/// 全部 DDL（**已按截止时间升序**）。
final deadlinesControllerProvider =
    AsyncNotifierProvider<DeadlinesController, List<DeadlineItem>>(
  DeadlinesController.new,
);

final class DeadlinesController extends AsyncNotifier<List<DeadlineItem>> {
  @override
  Future<List<DeadlineItem>> build() => _load();

  /// 手动刷新（下拉刷新 / 「刷新」按钮）。
  Future<void> refresh() async {
    state = const AsyncLoading<List<DeadlineItem>>();
    state = await AsyncValue.guard<List<DeadlineItem>>(_load);
  }

  /// 新增一条；失败时把异常抛给调用方（页面负责提示）。
  Future<DeadlineItem> add(DeadlineDraft draft) async {
    final DeadlineItem created =
        await ref.read(deadlineRepositoryProvider).add(draft);
    // 失效读 provider 而不是本地拼接状态：排序与统计只在一个地方算。
    ref.invalidateSelf();
    return created;
  }

  /// 勾选 / 取消勾选完成。
  Future<void> setCompleted(String id, bool completed) async {
    await ref.read(deadlineRepositoryProvider).setCompleted(id, completed);
    ref.invalidateSelf();
  }

  /// 删除（页面在调用前已做二次确认）。
  Future<void> delete(String id) async {
    await ref.read(deadlineRepositoryProvider).delete(id);
    ref.invalidateSelf();
  }

  Future<List<DeadlineItem>> _load() async {
    final List<DeadlineItem> items =
        await ref.read(deadlineRepositoryProvider).list();
    return sortDeadlines(items);
  }
}
