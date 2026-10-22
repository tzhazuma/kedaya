import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/result.dart';
import '../../../domain/models/teabreak.dart';
import '../../../domain/ports/teabreak_port.dart';

/// 把 `Result` 的失败分支转成可抛的 [ApiException]（presentation 只认这个）。
T _require<T>(Result<T> result) => switch (result) {
      Ok<T>(:final T value) => value,
      Err<T>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };

/// 「现在」的注入点。
///
/// 时效判定、排序、倒计时文案全都依赖它；测试里 override 成固定时刻，
/// 就能对「还有 X 分钟结束」这类文案做确定性断言。
final teabreakClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 茶歇列表（**已按契约排序**）。
final teabreakListControllerProvider =
    AsyncNotifierProvider<TeabreakListController, List<Teabreak>>(
  TeabreakListController.new,
);

final class TeabreakListController extends AsyncNotifier<List<Teabreak>> {
  @override
  Future<List<Teabreak>> build() => _fetch();

  /// 手动刷新（下拉刷新 / 「刷新」按钮）。
  Future<void> refresh() async {
    state = const AsyncLoading<List<Teabreak>>();
    state = await AsyncValue.guard<List<Teabreak>>(_fetch);
  }

  Future<List<Teabreak>> _fetch() async {
    final TeabreakPort port = ref.read(teabreakRepositoryProvider);
    final List<Teabreak> items =
        _require<List<Teabreak>>(await port.list());
    // 排序是纯领域函数：这里只负责注入 `now`，不含任何排序规则副本。
    return sortTeabreaks(items, ref.read(teabreakClockProvider)());
  }
}

/// 写操作集合（确认还有 / 新建）。
///
/// 与 `wildlife` 的 `WildlifeActions` 同构：只拿端口 + 一个失效回调，
/// 因此 application 层对象可以在测试里直接构造，不依赖 Riverpod 内部类型。
final teabreakActionsProvider = Provider<TeabreakActions>((ref) {
  final TeabreakPort port = ref.watch(teabreakRepositoryProvider);
  return TeabreakActions(
    port: port,
    onMutated: () => ref.invalidate(teabreakListControllerProvider),
  );
});

final class TeabreakActions {
  const TeabreakActions({required this.port, required this.onMutated});

  final TeabreakPort port;

  /// 写成功后的通知（用于失效读 provider，避免本地拼接状态）。
  final void Function() onMutated;

  /// 「确认还有」。
  Future<void> confirm(String id) async {
    _require<Unit>(await port.confirm(id));
    // 契约的判定标准是「最近一次确认」，因此列表必须重新取（顺序也会变）。
    onMutated();
  }

  /// 报一条茶歇；失败时抛出带具体问题文案的 [ApiException]。
  Future<Teabreak> create(TeabreakDraft draft) async {
    final Teabreak created = _require<Teabreak>(await port.create(draft));
    onMutated();
    return created;
  }
}
