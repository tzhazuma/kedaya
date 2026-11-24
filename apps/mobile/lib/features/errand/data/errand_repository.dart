/// 跑腿的**本机内存仓库**（演示用）。
///
/// 不经过 `AppRuntime`、不联网：接单 / 完成只改内存中的 [ErrandTask]，
/// 页面必须明确告诉用户「不会真的通知对方」。
library;

import '../../../domain/models/errand_task.dart';

/// 演示用「当前用户」id（只用于标记 requesterId / runnerId）。
const String errandCurrentUserId = 'u-me';

/// 仓库层错误（页面只展示 [message]）。
final class ErrandException implements Exception {
  const ErrandException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 发布草稿。报酬是**整数分**，与契约一致。
final class ErrandDraft {
  const ErrandDraft({
    required this.deliveryAddress,
    required this.rewardFen,
    this.pickupAddress = '',
    this.note = '',
    this.deadline,
  });

  final String pickupAddress;
  final String deliveryAddress;
  final int rewardFen;
  final String note;
  final DateTime? deadline;
}

/// 发布校验问题（产品口径：送达点非空、报酬 ≥ 0）。
enum ErrandDraftProblem {
  deliveryRequired,
  rewardNegative,
}

List<ErrandDraftProblem> validateErrandDraft(ErrandDraft draft) {
  final List<ErrandDraftProblem> problems = <ErrandDraftProblem>[];
  if (draft.deliveryAddress.trim().isEmpty) {
    problems.add(ErrandDraftProblem.deliveryRequired);
  }
  if (draft.rewardFen < 0) {
    problems.add(ErrandDraftProblem.rewardNegative);
  }
  return problems;
}

String describeErrandDraftProblem(ErrandDraftProblem problem) =>
    switch (problem) {
      ErrandDraftProblem.deliveryRequired => '送达点不能为空，接单的人需要知道送到哪。',
      ErrandDraftProblem.rewardNegative => '报酬不能是负数。',
    };

/// 内存仓库。
final class ErrandRepository {
  factory ErrandRepository({
    DateTime Function()? clock,
    List<ErrandTask>? seed,
  }) {
    final DateTime Function() resolvedClock = clock ?? DateTime.now;
    final List<ErrandTask> initial =
        seed ?? buildErrandSeedTasks(resolvedClock());
    return ErrandRepository._(resolvedClock, initial);
  }

  ErrandRepository._(this._clock, Iterable<ErrandTask> seed)
      : _tasks = <String, ErrandTask>{
          for (final ErrandTask task in seed) task.id: task,
        };

  final DateTime Function() _clock;
  final Map<String, ErrandTask> _tasks;
  int _sequence = 9100;

  int get length => _tasks.length;

  /// 最新创建的在前（Tab 内的进一步排序由 `errandsForTab` 负责）。
  List<ErrandTask> snapshot() {
    final List<ErrandTask> tasks = _tasks.values.toList(growable: false);
    tasks.sort(
      (ErrandTask a, ErrandTask b) => b.createdAt.compareTo(a.createdAt),
    );
    return List<ErrandTask>.unmodifiable(tasks);
  }

  ErrandTask? byId(String id) => _tasks[id];

  /// 发布一条跑腿。校验失败抛 [ErrandException]。
  ErrandTask create(ErrandDraft draft) {
    final List<ErrandDraftProblem> problems = validateErrandDraft(draft);
    if (problems.isNotEmpty) {
      throw ErrandException(
        problems.map(describeErrandDraftProblem).join(' '),
      );
    }

    final String pickup = draft.pickupAddress.trim();
    final String delivery = draft.deliveryAddress.trim();
    final String note = draft.note.trim();
    final ErrandTask task = ErrandTask(
      id: 'er-${_sequence++}',
      title: pickup.isEmpty ? '送到 $delivery' : '$pickup → $delivery',
      rewardFen: draft.rewardFen,
      status: ErrandStatus.open,
      createdAt: _clock(),
      note: note.isEmpty ? null : note,
      pickupAddress: pickup.isEmpty ? null : pickup,
      deliveryAddress: delivery,
      requesterId: errandCurrentUserId,
      deadline: draft.deadline,
    );
    _tasks[task.id] = task;
    return task;
  }

  /// 接单：只有 `open` 可以接。
  ErrandTask accept(String id) {
    final ErrandTask task = _require(id);
    if (task.status != ErrandStatus.open) {
      throw const ErrandException('这条跑腿已经被接单了。');
    }
    final ErrandTask accepted = task.copyWith(
      status: ErrandStatus.accepted,
      runnerId: errandCurrentUserId,
    );
    _tasks[id] = accepted;
    return accepted;
  }

  /// 完成：`accepted` / `delivered` 可以完成。
  ErrandTask complete(String id) {
    final ErrandTask task = _require(id);
    if (task.status != ErrandStatus.accepted &&
        task.status != ErrandStatus.delivered) {
      throw const ErrandException('只有已接单的跑腿可以标记完成。');
    }
    final ErrandTask completed = task.copyWith(
      status: ErrandStatus.completed,
    );
    _tasks[id] = completed;
    return completed;
  }

  ErrandTask _require(String id) {
    final ErrandTask? task = _tasks[id];
    if (task == null) {
      throw const ErrandException('这条跑腿不存在，可能已经被删除。');
    }
    return task;
  }
}

/// 演示数据（全部相对 [now] 生成，过几天打开也不会全变成「已截止」）。
List<ErrandTask> buildErrandSeedTasks(DateTime now) => <ErrandTask>[
      ErrandTask(
        id: 'er-2001',
        title: '3 号快递柜 → 6 号宿舍楼 302',
        rewardFen: 500,
        status: ErrandStatus.open,
        createdAt: now.subtract(const Duration(minutes: 40)),
        note: '两个小包裹，取件码接单后发。',
        pickupAddress: '3 号快递柜',
        deliveryAddress: '6 号宿舍楼 302',
        requesterId: 'u-3001',
        deadline: now.add(const Duration(hours: 3)),
      ),
      ErrandTask(
        id: 'er-2002',
        title: '二食堂一楼 → 图书馆 4 楼研讨间',
        rewardFen: 300,
        status: ErrandStatus.open,
        createdAt: now.subtract(const Duration(minutes: 15)),
        note: '番茄鸡蛋盖饭，不要香菜。',
        pickupAddress: '二食堂一楼',
        deliveryAddress: '图书馆 4 楼研讨间',
        requesterId: 'u-3002',
        deadline: now.add(const Duration(minutes: 90)),
      ),
      ErrandTask(
        id: 'er-2003',
        title: '教学中心打印店 → 信息学院 5 楼 508',
        rewardFen: 800,
        status: ErrandStatus.open,
        createdAt: now.subtract(const Duration(hours: 3)),
        note: '装订好的论文两本，轻拿轻放。',
        pickupAddress: '教学中心打印店',
        deliveryAddress: '信息学院 5 楼 508',
        requesterId: 'u-3003',
        deadline: now.add(const Duration(hours: 20)),
      ),
      ErrandTask(
        id: 'er-2004',
        title: '菜鸟驿站 → 1 号宿舍楼 101',
        rewardFen: 450,
        status: ErrandStatus.accepted,
        createdAt: now.subtract(const Duration(hours: 1)),
        note: '一个中号纸箱，不重。',
        pickupAddress: '菜鸟驿站',
        deliveryAddress: '1 号宿舍楼 101',
        requesterId: 'u-3004',
        runnerId: errandCurrentUserId,
        deadline: now.add(const Duration(hours: 2)),
      ),
      ErrandTask(
        id: 'er-2005',
        title: '一食堂 → 2 号宿舍楼 205',
        rewardFen: 200,
        status: ErrandStatus.completed,
        createdAt: now.subtract(const Duration(days: 2)),
        note: '一份牛肉面，汤和面分开放。',
        pickupAddress: '一食堂',
        deliveryAddress: '2 号宿舍楼 205',
        requesterId: 'u-3005',
        runnerId: errandCurrentUserId,
        deadline: now.subtract(const Duration(days: 1)),
      ),
    ];
