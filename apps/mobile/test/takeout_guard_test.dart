import 'package:flutter_test/flutter_test.dart';

import 'package:kedaya/domain/models/takeout_report.dart';
import 'package:kedaya/features/takeout_guard/application/takeout_guard_providers.dart';

void main() {
  // 固定时刻：所有相对时间与演示数据都以它为基准。
  final DateTime now = DateTime(2026, 11, 24, 12, 0);

  TakeoutReport report(
    String id, {
    required DateTime occurredAt,
    TakeoutReportStatus status = TakeoutReportStatus.pending,
    String meal = '黄焖鸡米饭',
  }) =>
      TakeoutReport(
        id: id,
        occurredAt: occurredAt,
        location: '3 号楼外卖架',
        platform: TakeoutPlatform.meituan,
        meal: meal,
        status: status,
        createdAt: occurredAt,
      );

  TakeoutReportDraft draft({
    DateTime? occurredAt,
    String location = '3 号楼外卖架',
    String meal = '黄焖鸡米饭',
    String note = '',
    TakeoutPlatform platform = TakeoutPlatform.meituan,
  }) =>
      TakeoutReportDraft(
        occurredAt: occurredAt ?? now.subtract(const Duration(hours: 1)),
        location: location,
        platform: platform,
        meal: meal,
        note: note,
      );

  group('仓库排序', () {
    test('按发生时间倒序，与插入顺序无关', () {
      final InMemoryTakeoutGuardRepository repository =
          InMemoryTakeoutGuardRepository(
        seed: <TakeoutReport>[
          report('old', occurredAt: now.subtract(const Duration(hours: 5))),
          report('new', occurredAt: now.subtract(const Duration(hours: 1))),
          report('mid', occurredAt: now.subtract(const Duration(hours: 3))),
        ],
        clock: () => now,
      );

      expect(
        repository.list().map((TakeoutReport report) => report.id).toList(),
        <String>['new', 'mid', 'old'],
      );
    });

    test('新增默认待跟进，并插到正确的倒序位置', () {
      final InMemoryTakeoutGuardRepository repository =
          InMemoryTakeoutGuardRepository(
        seed: <TakeoutReport>[
          report('old', occurredAt: now.subtract(const Duration(hours: 5))),
        ],
        clock: () => now,
      );

      final TakeoutReport created = repository.add(
        draft(
          occurredAt: now.subtract(const Duration(hours: 2)),
          meal: '鸡胸肉沙拉',
        ),
      );

      expect(created.status, TakeoutReportStatus.pending);
      expect(created.meal, '鸡胸肉沙拉');
      expect(
        repository.list().map((TakeoutReport report) => report.id).toList(),
        <String>[created.id, 'old'],
      );
    });
  });

  group('状态流转', () {
    test('标记已解决后不再出现在「待跟进」筛选里', () {
      final InMemoryTakeoutGuardRepository repository =
          InMemoryTakeoutGuardRepository(
        seed: <TakeoutReport>[
          report(
            'pending',
            occurredAt: now.subtract(const Duration(hours: 1)),
          ),
          report(
            'resolved',
            occurredAt: now.subtract(const Duration(hours: 2)),
            status: TakeoutReportStatus.resolved,
          ),
        ],
        clock: () => now,
      );

      expect(
        filterTakeoutReports(
          repository.list(),
          status: TakeoutReportStatus.pending,
        ).map((TakeoutReport report) => report.id).toList(),
        <String>['pending'],
      );

      final TakeoutReport? updated = repository.resolve('pending');
      expect(updated?.status, TakeoutReportStatus.resolved);

      expect(
        filterTakeoutReports(
          repository.list(),
          status: TakeoutReportStatus.pending,
        ),
        isEmpty,
      );
      expect(
        filterTakeoutReports(
          repository.list(),
          status: TakeoutReportStatus.resolved,
        ).map((TakeoutReport report) => report.id).toList(),
        containsAll(<String>['pending', 'resolved']),
      );
    });
  });

  group('删除', () {
    test('删除后列表不再包含该条', () {
      final InMemoryTakeoutGuardRepository repository =
          InMemoryTakeoutGuardRepository(
        seed: <TakeoutReport>[
          report('a', occurredAt: now.subtract(const Duration(hours: 1))),
          report('b', occurredAt: now.subtract(const Duration(hours: 2))),
        ],
        clock: () => now,
      );

      expect(repository.delete('a'), isTrue);
      expect(repository.length, 1);
      expect(
        repository.list().map((TakeoutReport report) => report.id).toList(),
        <String>['b'],
      );
      expect(repository.delete('missing'), isFalse);
    });
  });

  group('新增校验', () {
    test('空地点与空餐品都会被拒', () {
      final List<TakeoutDraftProblem> problems = validateTakeoutDraft(
        draft(location: '  ', meal: ''),
        now,
      );

      expect(
        problems,
        containsAll(<TakeoutDraftProblem>[
          TakeoutDraftProblem.emptyLocation,
          TakeoutDraftProblem.emptyMeal,
        ]),
      );
    });

    test('备注超过 200 字被拒', () {
      final String tooLong =
          List<String>.filled(takeoutNoteMax + 1, '字').join();
      final List<TakeoutDraftProblem> problems = validateTakeoutDraft(
        draft(note: tooLong),
        now,
      );

      expect(problems, contains(TakeoutDraftProblem.noteTooLong));
    });

    test('时间晚于现在被拒', () {
      final List<TakeoutDraftProblem> problems = validateTakeoutDraft(
        draft(occurredAt: now.add(const Duration(minutes: 10))),
        now,
      );

      expect(problems, contains(TakeoutDraftProblem.futureTime));
    });

    test('仓库直接拒收不合法草稿', () {
      final InMemoryTakeoutGuardRepository repository =
          InMemoryTakeoutGuardRepository(clock: () => now);

      expect(
        () => repository.add(draft(meal: '')),
        throwsArgumentError,
      );
      expect(repository.length, 0);
    });
  });
}
