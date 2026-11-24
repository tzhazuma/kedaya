import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/errand_task.dart';
import 'package:kedaya/features/errand/data/errand_repository.dart';
import 'package:kedaya/features/errand/domain/errand_board.dart';

void main() {
  final DateTime now = DateTime(2026, 11, 24, 12);

  ErrandRepository repository() =>
      ErrandRepository(clock: () => now, seed: buildErrandSeedTasks(now));

  ErrandTask task({
    required String id,
    required ErrandStatus status,
    DateTime? deadline,
    DateTime? createdAt,
  }) =>
      ErrandTask(
        id: id,
        title: id,
        rewardFen: 100,
        status: status,
        createdAt: createdAt ?? now,
        deliveryAddress: '送达点',
        deadline: deadline,
      );

  group('状态流转', () {
    test('接单：open → accepted，并记录接单人', () {
      final ErrandRepository repo = repository();
      expect(repo.byId('er-2001')!.status, ErrandStatus.open);

      final ErrandTask accepted = repo.accept('er-2001');

      expect(accepted.status, ErrandStatus.accepted);
      expect(accepted.runnerId, errandCurrentUserId);
      expect(repo.byId('er-2001')!.status, ErrandStatus.accepted);
    });

    test('完成：accepted → completed', () {
      final ErrandRepository repo = repository();
      repo.accept('er-2001');

      final ErrandTask completed = repo.complete('er-2001');

      expect(completed.status, ErrandStatus.completed);
      expect(repo.byId('er-2001')!.status, ErrandStatus.completed);
    });

    test('不能跳过接单直接完成「待接单」任务', () {
      final ErrandRepository repo = repository();

      expect(
        () => repo.complete('er-2001'),
        throwsA(isA<ErrandException>()),
      );
      expect(repo.byId('er-2001')!.status, ErrandStatus.open);
    });

    test('已完成的任务不能重复完成', () {
      final ErrandRepository repo = repository();

      expect(
        () => repo.complete('er-2005'),
        throwsA(isA<ErrandException>()),
      );
      expect(repo.byId('er-2005')!.status, ErrandStatus.completed);
    });

    test('发布：新任务进入待接单，报酬为 0 也合法', () {
      final ErrandRepository repo = repository();

      final ErrandTask created = repo.create(
        const ErrandDraft(deliveryAddress: '7 号宿舍楼 101', rewardFen: 0),
      );

      expect(created.status, ErrandStatus.open);
      expect(created.rewardFen, 0);
      expect(created.deliveryAddress, '7 号宿舍楼 101');
      expect(repo.length, 6);
      expect(errandTabOf(repo.byId(created.id)!.status), ErrandTab.open);
    });

    test('发布校验：送达点为空、报酬为负都会被拒绝', () {
      expect(
        validateErrandDraft(
          const ErrandDraft(deliveryAddress: '   ', rewardFen: 100),
        ),
        contains(ErrandDraftProblem.deliveryRequired),
      );
      expect(
        validateErrandDraft(
          const ErrandDraft(deliveryAddress: '1 号楼', rewardFen: -1),
        ),
        contains(ErrandDraftProblem.rewardNegative),
      );
      expect(
        () => repository().create(
          const ErrandDraft(deliveryAddress: '', rewardFen: 100),
        ),
        throwsA(isA<ErrandException>()),
      );
    });
  });

  group('tab 归类', () {
    test('open / accepted / delivered / completed 分别落到三个 Tab', () {
      final List<ErrandTask> tasks = <ErrandTask>[
        task(id: 'open', status: ErrandStatus.open),
        task(id: 'accepted', status: ErrandStatus.accepted),
        task(id: 'delivered', status: ErrandStatus.delivered),
        task(id: 'completed', status: ErrandStatus.completed),
      ];

      expect(
        errandsForTab(tasks, ErrandTab.open).map((ErrandTask t) => t.id),
        <String>['open'],
      );
      expect(
        errandsForTab(tasks, ErrandTab.inProgress)
            .map((ErrandTask t) => t.id)
            .toSet(),
        <String>{'accepted', 'delivered'},
      );
      expect(
        errandsForTab(tasks, ErrandTab.completed).map((ErrandTask t) => t.id),
        <String>['completed'],
      );
    });

    test('cancelled / unknown 不进入任何 Tab', () {
      expect(errandTabOf(ErrandStatus.cancelled), isNull);
      expect(errandTabOf(ErrandStatus.unknown), isNull);

      final List<ErrandTask> tasks = <ErrandTask>[
        task(id: 'cancelled', status: ErrandStatus.cancelled),
        task(id: 'unknown', status: ErrandStatus.unknown),
      ];
      for (final ErrandTab tab in ErrandTab.values) {
        expect(errandsForTab(tasks, tab), isEmpty);
      }
    });

    test('待接单按截止时间升序，无截止的排在最后', () {
      final List<ErrandTask> tasks = <ErrandTask>[
        task(
          id: 'late',
          status: ErrandStatus.open,
          deadline: now.add(const Duration(hours: 5)),
        ),
        task(
          id: 'none',
          status: ErrandStatus.open,
          deadline: null,
          createdAt: now.add(const Duration(hours: 1)),
        ),
        task(
          id: 'soon',
          status: ErrandStatus.open,
          deadline: now.add(const Duration(hours: 1)),
        ),
      ];

      expect(
        errandsForTab(tasks, ErrandTab.open).map((ErrandTask t) => t.id),
        <String>['soon', 'late', 'none'],
      );
    });

    test('演示数据同时覆盖三个 Tab', () {
      final ErrandRepository repo = repository();
      for (final ErrandTab tab in ErrandTab.values) {
        expect(
          errandsForTab(repo.snapshot(), tab),
          isNotEmpty,
          reason: '${tab.label} 应该有演示数据',
        );
      }
    });

    test('相对倒计时：分钟 / 小时 / 已截止 / 不设截止', () {
      expect(
        errandDeadlineText(now.add(const Duration(minutes: 23)), now),
        '还有 23 分钟截止',
      );
      expect(
        errandDeadlineText(
          now.add(const Duration(minutes: 59, seconds: 30)),
          now,
        ),
        '还有 60 分钟截止',
      );
      expect(
        errandDeadlineText(now.add(const Duration(hours: 2)), now),
        '还有 2 小时截止',
      );
      expect(
        errandDeadlineText(now.subtract(const Duration(minutes: 1)), now),
        '已截止',
      );
      expect(errandDeadlineText(null, now), '不设截止');
    });
  });
}
