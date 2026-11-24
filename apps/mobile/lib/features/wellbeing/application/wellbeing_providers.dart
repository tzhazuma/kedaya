import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../application/consent_controller.dart';
import '../../../domain/models/wellbeing_booking.dart';
import '../data/wellbeing_bookings_repository.dart';

/// 契约 §4 的模块 id（同意门与 `KedayaModule` 注册表共用）。
const String wellbeingModuleId = 'wellbeing';

/// 本机预约仓库。测试可 override 成带计数器的假实现。
final wellbeingBookingsRepositoryProvider =
    Provider<WellbeingBookingsRepository>(
  (ref) => LocalWellbeingBookingsRepository(ref.watch(localCacheProvider)),
);

/// 我的预约（**只读本机**）。
///
/// 数据加载顺序被刻意写成两步：
///   1. 先 `await` 二次同意状态；
///   2. 只有已同意时才调用仓库的 `load()`。
///
/// 因此「未同意」时不仅界面看不到列表，仓库连一次读取都不会发生。
final wellbeingBookingsProvider =
    AsyncNotifierProvider<WellbeingBookingsController, List<WellbeingBooking>>(
  WellbeingBookingsController.new,
);

final class WellbeingBookingsController
    extends AsyncNotifier<List<WellbeingBooking>> {
  @override
  Future<List<WellbeingBooking>> build() async {
    final Set<String> granted =
        await ref.watch(consentControllerProvider.future);
    if (!granted.contains(wellbeingModuleId)) {
      return const <WellbeingBooking>[];
    }
    return _readLocal();
  }

  List<WellbeingBooking> _readLocal() {
    final List<WellbeingBooking> items =
        ref.read(wellbeingBookingsRepositoryProvider).load();
    final List<WellbeingBooking> sorted = <WellbeingBooking>[...items]..sort(
        (WellbeingBooking a, WellbeingBooking b) =>
            b.createdAt.compareTo(a.createdAt),
      );
    return List<WellbeingBooking>.unmodifiable(sorted);
  }

  /// 手动刷新。未同意时只把状态置空，仍然不读仓库。
  Future<void> refresh() async {
    state = const AsyncLoading<List<WellbeingBooking>>();
    state = await AsyncValue.guard<List<WellbeingBooking>>(() async {
      final Set<String> granted =
          await ref.read(consentControllerProvider.future);
      if (!granted.contains(wellbeingModuleId)) {
        return const <WellbeingBooking>[];
      }
      return _readLocal();
    });
  }

  /// 提交一条本机预约。状态固定为「已提交（演示）」。
  Future<WellbeingBooking> submit(WellbeingBookingDraft draft) async {
    final Map<WellbeingBookingField, String> problems = draft.validate();
    if (problems.isNotEmpty) {
      throw ArgumentError(problems.values.join('；'));
    }

    final Set<String> granted =
        await ref.read(consentControllerProvider.future);
    if (!granted.contains(wellbeingModuleId)) {
      throw StateError('尚未同意「心理支持」的隐私说明');
    }

    final DateTime now = ref.read(clockProvider)();
    final List<WellbeingBooking> current = state.valueOrNull ?? _readLocal();
    final WellbeingBooking booking = draft.toBooking(
      id: 'local-${now.microsecondsSinceEpoch}-${current.length}',
      createdAt: now,
    );
    final List<WellbeingBooking> next = <WellbeingBooking>[
      booking,
      ...current,
    ];
    await ref.read(wellbeingBookingsRepositoryProvider).save(next);
    state = AsyncData<List<WellbeingBooking>>(next);
    return booking;
  }

  /// 清空本机记录。**不要求当前仍同意**：删除必须永远可行。
  Future<void> clearAll() async {
    await ref.read(wellbeingBookingsRepositoryProvider).clear();
    state = const AsyncData<List<WellbeingBooking>>(<WellbeingBooking>[]);
  }
}
