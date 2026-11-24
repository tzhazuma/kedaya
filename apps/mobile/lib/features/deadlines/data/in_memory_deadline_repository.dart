import '../../../domain/models/deadline_item.dart';

/// DDL 仓库（feature 内的最小接口）。
///
/// 真实数据需要从各教学平台聚合；当前实现是**本机内存列表**，
/// 页面必须写明「DDL 不写入课程表」并把它当成本机记录。
abstract interface class DeadlineRepository {
  /// 全部条目（未排序；排序由 application 层负责）。
  Future<List<DeadlineItem>> list();

  /// 新增一条；返回写入后的条目。
  Future<DeadlineItem> add(DeadlineDraft draft);

  /// 勾选 / 取消勾选完成。
  Future<DeadlineItem> setCompleted(String id, bool completed);

  /// 删除（调用方负责二次确认）。
  Future<void> delete(String id);
}

/// 本机内存实现：不读写网络与磁盘，进程退出即丢失。
final class InMemoryDeadlineRepository implements DeadlineRepository {
  InMemoryDeadlineRepository({List<DeadlineItem>? items})
      : _items = List<DeadlineItem>.of(
          items ?? const <DeadlineItem>[],
          growable: true,
        );

  final List<DeadlineItem> _items;

  int _nextId = 1;

  @override
  Future<List<DeadlineItem>> list() async =>
      List<DeadlineItem>.unmodifiable(_items);

  @override
  Future<DeadlineItem> add(DeadlineDraft draft) async {
    final DeadlineItem item = DeadlineItem(
      id: _newId(),
      title: draft.normalizedTitle,
      kind: draft.kind,
      dueAt: draft.dueAt,
      source: draft.normalizedSource,
      note: draft.normalizedNote,
    );
    _items.add(item);
    return item;
  }

  @override
  Future<DeadlineItem> setCompleted(String id, bool completed) async {
    final int index = _indexOf(id);
    final DeadlineItem next = _items[index].copyWith(completed: completed);
    _items[index] = next;
    return next;
  }

  @override
  Future<void> delete(String id) async {
    _items.removeAt(_indexOf(id));
  }

  int _indexOf(String id) {
    final int index = _items.indexWhere((DeadlineItem item) => item.id == id);
    if (index < 0) {
      throw StateError('找不到 DDL "$id"（可能已经被删除）');
    }
    return index;
  }

  String _newId() {
    String candidate = 'ddl-new-$_nextId';
    while (_items.any((DeadlineItem item) => item.id == candidate)) {
      _nextId++;
      candidate = 'ddl-new-$_nextId';
    }
    _nextId++;
    return candidate;
  }

  /// 测试用：当前条数。
  int get debugLength => _items.length;

  /// 测试用：按 id 取条目（不存在返回 `null`）。
  DeadlineItem? debugById(String id) {
    for (final DeadlineItem item in _items) {
      if (item.id == id) return item;
    }
    return null;
  }
}

/// 演示数据：围绕注入的 [now] 生成（今天 / 已逾期 / 已完成 / 几天后都有）。
///
/// 用固定时刻做测试时，这份数据也随之确定；真实运行时它只是让列表不空。
List<DeadlineItem> demoDeadlines(DateTime now) {
  final DateTime local = now.toLocal();
  DateTime at(int dayOffset, int hour, int minute) => DateTime(
        local.year,
        local.month,
        local.day + dayOffset,
        hour,
        minute,
      );

  return <DeadlineItem>[
    DeadlineItem(
      id: 'ddl-demo-01',
      title: '程序分析作业 4：CHA 与过程间常量传播',
      kind: DeadlineKind.homework,
      dueAt: at(0, 23, 59),
      source: '程序分析 · 张涛',
      note: '提交 PDF 到教学网，迟交扣 10%',
    ),
    DeadlineItem(
      id: 'ddl-demo-02',
      title: '编译原理期中考试',
      kind: DeadlineKind.exam,
      dueAt: at(3, 14, 0),
      source: '教务通知',
      note: '信息学院 1-101，带学生证',
    ),
    DeadlineItem(
      id: 'ddl-demo-03',
      title: '金融科技竞赛组队报名',
      kind: DeadlineKind.registration,
      dueAt: at(-1, 18, 0),
      source: '金融科技竞赛',
      note: '3 人一队，报名表在群里',
    ),
    DeadlineItem(
      id: 'ddl-demo-04',
      title: '嵌入式系统实验报告',
      kind: DeadlineKind.homework,
      dueAt: at(-2, 23, 59),
      source: '嵌入式系统 · 周成',
      completed: true,
    ),
    DeadlineItem(
      id: 'ddl-demo-05',
      title: '宿舍电费缴纳',
      kind: DeadlineKind.other,
      dueAt: at(6, 10, 0),
      source: '宿舍管理',
    ),
  ];
}
