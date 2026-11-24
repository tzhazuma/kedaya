import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/deadline_item.dart';
import 'package:kedaya/features/deadlines/application/deadlines_providers.dart';
import 'package:kedaya/features/deadlines/data/in_memory_deadline_repository.dart';

DeadlineItem _item({
  String id = 'd1',
  String title = '作业 1',
  String? source = '课程作业',
  String? note = '第 3 章',
  bool completed = false,
}) =>
    DeadlineItem(
      id: id,
      title: title,
      kind: DeadlineKind.homework,
      dueAt: DateTime(2026, 3, 10, 23, 59),
      source: source,
      note: note,
      completed: completed,
    );

void main() {
  group('仓库 update', () {
    test('覆盖字段但保留 id 与 completed', () async {
      final InMemoryDeadlineRepository repo = InMemoryDeadlineRepository(
        items: <DeadlineItem>[_item(completed: true)],
      );
      final DeadlineItem updated = await repo.update(
        'd1',
        DeadlineDraft(
          title: '作业 2',
          kind: DeadlineKind.exam,
          dueAt: DateTime(2026, 3, 12, 9),
          source: '期中',
          note: '带计算器',
        ),
      );
      expect(updated.id, 'd1');
      expect(updated.completed, isTrue);
      expect(updated.title, '作业 2');
      expect(updated.kind, DeadlineKind.exam);
      expect(updated.dueAt, DateTime(2026, 3, 12, 9));
    });

    test('清空来源与备注时真的写回 null（copyWith 的 null 是“保留”）', () async {
      final InMemoryDeadlineRepository repo = InMemoryDeadlineRepository(
        items: <DeadlineItem>[_item()],
      );
      final DeadlineItem updated = await repo.update(
        'd1',
        DeadlineDraft(
          title: '作业 1',
          kind: DeadlineKind.homework,
          dueAt: DateTime(2026, 3, 10, 23, 59),
          source: '',
          note: '   ',
        ),
      );
      expect(updated.source, isNull);
      expect(updated.note, isNull);
    });

    test('id 不存在时抛 StateError', () async {
      final InMemoryDeadlineRepository repo = InMemoryDeadlineRepository();
      expect(
        () => repo.update(
          'nope',
          DeadlineDraft(
            title: 'x',
            kind: DeadlineKind.other,
            dueAt: DateTime(2026, 3, 1),
          ),
        ),
        throwsStateError,
      );
    });
  });

  group('控制器 updateItem', () {
    test('更新后列表立即反映新标题', () async {
      final InMemoryDeadlineRepository repo = InMemoryDeadlineRepository(
        items: <DeadlineItem>[_item()],
      );
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          deadlineRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);

      await container.read(deadlinesControllerProvider.future);
      await container.read(deadlinesControllerProvider.notifier).updateItem(
            'd1',
            DeadlineDraft(
              title: '作业 1（改）',
              kind: DeadlineKind.homework,
              dueAt: DateTime(2026, 3, 11, 23, 59),
            ),
          );

      // invalidateSelf 之后需要等一次重建，否则读到的是 AsyncLoading。
      final List<DeadlineItem> items =
          await container.read(deadlinesControllerProvider.future);
      expect(items.single.title, '作业 1（改）');
      expect(items.single.dueAt, DateTime(2026, 3, 11, 23, 59));
    });
  });
}
