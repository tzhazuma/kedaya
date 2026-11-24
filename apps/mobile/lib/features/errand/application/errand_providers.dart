import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/errand_task.dart';
import '../data/errand_repository.dart';
import '../domain/errand_board.dart';

/// 「现在」的注入点：倒计时与演示数据的相对时间都从这里取。
final errandClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本机内存仓库（**直接 new**，不经过 AppRuntime）。
final errandLocalRepositoryProvider = Provider<ErrandRepository>((ref) {
  final DateTime Function() clock = ref.watch(errandClockProvider);
  return ErrandRepository(clock: clock);
});

final errandTasksProvider =
    NotifierProvider<ErrandTasksController, List<ErrandTask>>(
  ErrandTasksController.new,
);

/// 读 provider 暴露的是仓库快照；所有写操作都经过这里，页面不需要自己刷新。
final class ErrandTasksController extends Notifier<List<ErrandTask>> {
  @override
  List<ErrandTask> build() {
    final ErrandRepository repository =
        ref.watch(errandLocalRepositoryProvider);
    return repository.snapshot();
  }

  ErrandTask create(ErrandDraft draft) {
    final ErrandRepository repository = ref.read(errandLocalRepositoryProvider);
    final ErrandTask created = repository.create(draft);
    state = repository.snapshot();
    return created;
  }

  ErrandTask accept(String id) {
    final ErrandRepository repository = ref.read(errandLocalRepositoryProvider);
    final ErrandTask accepted = repository.accept(id);
    state = repository.snapshot();
    return accepted;
  }

  ErrandTask complete(String id) {
    final ErrandRepository repository = ref.read(errandLocalRepositoryProvider);
    final ErrandTask completed = repository.complete(id);
    state = repository.snapshot();
    return completed;
  }
}

/// 某个 Tab 的任务（已排序）。
final errandTasksByTabProvider =
    Provider.family<List<ErrandTask>, ErrandTab>((ref, ErrandTab tab) {
  return errandsForTab(ref.watch(errandTasksProvider), tab);
});

/// 单条任务；不存在时返回 `null`（页面给空态，而不是抛错）。
final errandTaskProvider =
    Provider.family<ErrandTask?, String>((ref, String id) {
  final List<ErrandTask> tasks = ref.watch(errandTasksProvider);
  for (final ErrandTask task in tasks) {
    if (task.id == id) return task;
  }
  return null;
});
