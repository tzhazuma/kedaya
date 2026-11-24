import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/takeout_report.dart';

/// 「现在」的注入点：排序、相对时间与新增默认值都依赖它。
///
/// 测试里 override 成固定时刻，`demoTakeoutReports` 与相对时间断言就都是
/// 确定性的。
final takeoutGuardClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本 feature 的内存仓库（不经过 `AppRuntime`，也不发任何网络请求）。
final takeoutGuardRepositoryProvider =
    Provider<InMemoryTakeoutGuardRepository>((ref) {
  final DateTime Function() clock = ref.watch(takeoutGuardClockProvider);
  return InMemoryTakeoutGuardRepository(
    seed: demoTakeoutReports(clock()),
    clock: clock,
  );
});

/// 当前列表（仓库快照，已按时间倒序）。
final takeoutReportsProvider =
    NotifierProvider<TakeoutReportsController, List<TakeoutReport>>(
  TakeoutReportsController.new,
);

final class TakeoutReportsController extends Notifier<List<TakeoutReport>> {
  @override
  List<TakeoutReport> build() {
    final InMemoryTakeoutGuardRepository repository =
        ref.watch(takeoutGuardRepositoryProvider);
    return repository.list();
  }

  /// 新增；规则校验不通过时仓库抛 [ArgumentError]（页面会先本地校验）。
  TakeoutReport add(TakeoutReportDraft draft) {
    final InMemoryTakeoutGuardRepository repository =
        ref.read(takeoutGuardRepositoryProvider);
    final TakeoutReport created = repository.add(draft);
    state = repository.list();
    return created;
  }

  /// 标记「已解决」；返回更新后的条目（找不到时返回 null）。
  TakeoutReport? resolve(String id) {
    final InMemoryTakeoutGuardRepository repository =
        ref.read(takeoutGuardRepositoryProvider);
    final TakeoutReport? updated = repository.resolve(id);
    state = repository.list();
    return updated;
  }

  /// 删除单条；返回是否真的删掉了。
  bool delete(String id) {
    final InMemoryTakeoutGuardRepository repository =
        ref.read(takeoutGuardRepositoryProvider);
    final bool removed = repository.delete(id);
    state = repository.list();
    return removed;
  }
}

/// 列表筛选：`null` 表示「全部」。
final takeoutGuardStatusFilterProvider =
    NotifierProvider<TakeoutStatusFilterController, TakeoutReportStatus?>(
  TakeoutStatusFilterController.new,
);

final class TakeoutStatusFilterController
    extends Notifier<TakeoutReportStatus?> {
  @override
  TakeoutReportStatus? build() => null;

  void select(TakeoutReportStatus? status) => state = status;
}

/// 页面实际渲染的列表（排序 + 状态筛选）。
final visibleTakeoutReportsProvider = Provider<List<TakeoutReport>>((ref) {
  return filterTakeoutReports(
    ref.watch(takeoutReportsProvider),
    status: ref.watch(takeoutGuardStatusFilterProvider),
  );
});

/// 按发生时间倒序；同一时刻用写入时间、id 稳定排序。
List<TakeoutReport> sortTakeoutReports(Iterable<TakeoutReport> reports) {
  final List<TakeoutReport> sorted = List<TakeoutReport>.of(reports);
  sorted.sort((TakeoutReport a, TakeoutReport b) {
    final int byOccurred = b.occurredAt.compareTo(a.occurredAt);
    if (byOccurred != 0) return byOccurred;
    final int byCreated = b.createdAt.compareTo(a.createdAt);
    if (byCreated != 0) return byCreated;
    return a.id.compareTo(b.id);
  });
  return List<TakeoutReport>.unmodifiable(sorted);
}

/// 状态筛选（`null` = 全部）。
List<TakeoutReport> filterTakeoutReports(
  Iterable<TakeoutReport> reports, {
  TakeoutReportStatus? status,
}) {
  final Iterable<TakeoutReport> filtered = status == null
      ? reports
      : reports.where((TakeoutReport report) => report.status == status);
  return List<TakeoutReport>.unmodifiable(filtered);
}

/// 内存仓库：排序 / 状态流转 / 删除的唯一真相。
///
/// 所有写操作都同步完成；`add` 会再跑一次 [validateTakeoutDraft]，
/// 因此即使绕过页面直接调用仓库，空地点 / 超长备注也进不来。
final class InMemoryTakeoutGuardRepository {
  InMemoryTakeoutGuardRepository({
    List<TakeoutReport>? seed,
    DateTime Function()? clock,
  })  : _clock = clock ?? DateTime.now,
        _reports = <String, TakeoutReport>{
          for (final TakeoutReport report in seed ?? const <TakeoutReport>[])
            report.id: report,
        };

  final DateTime Function() _clock;
  final Map<String, TakeoutReport> _reports;
  int _nextId = 1;

  List<TakeoutReport> list() => sortTakeoutReports(_reports.values);

  TakeoutReport? findById(String id) => _reports[id];

  int get length => _reports.length;

  TakeoutReport add(TakeoutReportDraft draft) {
    final DateTime now = _clock();
    final List<TakeoutDraftProblem> problems = validateTakeoutDraft(draft, now);
    if (problems.isNotEmpty) {
      throw ArgumentError(
        '报备内容不合法：'
        '${problems.map(describeTakeoutDraftProblem).join('；')}',
      );
    }

    final TakeoutReport report = TakeoutReport(
      id: 'tg-local-${_nextId++}',
      occurredAt: draft.occurredAt,
      location: draft.location.trim(),
      platform: draft.platform,
      meal: draft.meal.trim(),
      note: draft.note.trim(),
      contactedBuildingManager: draft.contactedBuildingManager,
      status: TakeoutReportStatus.pending,
      createdAt: now,
    );
    _reports[report.id] = report;
    return report;
  }

  TakeoutReport? resolve(String id) {
    final TakeoutReport? report = _reports[id];
    if (report == null) return null;
    if (report.isResolved) return report;

    final TakeoutReport updated =
        report.copyWith(status: TakeoutReportStatus.resolved);
    _reports[id] = updated;
    return updated;
  }

  bool delete(String id) => _reports.remove(id) != null;
}

/// 演示数据：相对 `now` 生成，保证「2 小时前」这类文案永远成立。
List<TakeoutReport> demoTakeoutReports(DateTime now) => <TakeoutReport>[
      TakeoutReport(
        id: 'tg-demo-1',
        occurredAt: now.subtract(const Duration(hours: 2, minutes: 10)),
        location: '3 号楼外卖架',
        platform: TakeoutPlatform.meituan,
        meal: '黄焖鸡米饭',
        note: '18:40 放在架子上，19:10 下来已经没了。楼管说可以帮忙调监控。',
        contactedBuildingManager: true,
        status: TakeoutReportStatus.pending,
        createdAt: now.subtract(const Duration(hours: 1, minutes: 55)),
      ),
      TakeoutReport(
        id: 'tg-demo-2',
        occurredAt: now.subtract(const Duration(days: 1, hours: 3)),
        location: '图书馆西门取餐点',
        platform: TakeoutPlatform.eleme,
        meal: '鸡胸肉沙拉',
        note: '取餐点没有编号，可能是别人拿错了。已经和楼管确认过。',
        contactedBuildingManager: true,
        status: TakeoutReportStatus.resolved,
        createdAt: now.subtract(const Duration(days: 1, hours: 2)),
      ),
    ];
