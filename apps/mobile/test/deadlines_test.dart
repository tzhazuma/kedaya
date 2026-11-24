import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/deadline_item.dart';
import 'package:kedaya/features/deadlines/application/deadlines_providers.dart';
import 'package:kedaya/features/deadlines/data/in_memory_deadline_repository.dart';
import 'package:kedaya/features/deadlines/presentation/pages/deadline_compose_page.dart';
import 'package:kedaya/features/deadlines/presentation/pages/deadlines_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// DDL 聚合（`deadlines`）的测试。
///
/// 固定时刻选 **2026-11-24（周二）10:00**：
/// 11-21 14:00 截止的那条恰好逾期 2 天；11-24 23:59 的那条还有 13 小时 59 分钟。
void main() {
  final DateTime now = DateTime(2026, 11, 24, 10, 0);

  DeadlineItem item({
    required String id,
    required String title,
    required DateTime dueAt,
    DeadlineKind kind = DeadlineKind.homework,
    bool completed = false,
    String? source,
  }) =>
      DeadlineItem(
        id: id,
        title: title,
        kind: kind,
        dueAt: dueAt,
        source: source,
        completed: completed,
      );

  /// 四条固定数据（**故意乱序**，用来验证页面自己会按截止时间重排）：
  /// 明天 → 今天 → 已逾期 → 已完成（最早）。
  List<DeadlineItem> baseItems() => <DeadlineItem>[
        item(
          id: 'ddl-a',
          title: '程序分析作业 4',
          dueAt: DateTime(2026, 11, 25, 23, 59),
          source: '程序分析 · 张涛',
        ),
        item(
          id: 'ddl-c',
          title: '金融科技竞赛组队报名',
          dueAt: DateTime(2026, 11, 24, 23, 59),
          kind: DeadlineKind.registration,
        ),
        item(
          id: 'ddl-b',
          title: '编译原理期中考试',
          dueAt: DateTime(2026, 11, 21, 14, 0),
          kind: DeadlineKind.exam,
          source: '教务通知',
        ),
        item(
          id: 'ddl-d',
          title: '嵌入式系统实验报告',
          dueAt: DateTime(2026, 11, 20, 23, 59),
          completed: true,
        ),
      ];

  Future<void> pumpDeadlines(
    WidgetTester tester, {
    required List<DeadlineItem> items,
    DateTime? clock,
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          deadlineRepositoryProvider.overrideWithValue(
            InMemoryDeadlineRepository(items: items),
          ),
          deadlinesClockProvider.overrideWithValue(() => clock ?? now),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const DeadlinesPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<InMemoryDeadlineRepository> pumpCompose(
    WidgetTester tester, {
    List<DeadlineItem> items = const <DeadlineItem>[],
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final InMemoryDeadlineRepository repository =
        InMemoryDeadlineRepository(items: items);
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          deadlineRepositoryProvider.overrideWithValue(repository),
          deadlinesClockProvider.overrideWithValue(() => now),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const DeadlineComposePage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return repository;
  }

  group('规则层', () {
    test('按截止时间升序排序，与输入顺序无关', () {
      final List<DeadlineItem> sorted = sortDeadlines(<DeadlineItem>[
        item(
          id: 'late',
          title: '程序分析作业 4',
          dueAt: DateTime(2026, 11, 25, 23, 59),
        ),
        item(
          id: 'early',
          title: '嵌入式系统实验报告',
          dueAt: DateTime(2026, 11, 20, 23, 59),
        ),
        item(
          id: 'mid',
          title: '编译原理期中考试',
          dueAt: DateTime(2026, 11, 21, 14, 0),
        ),
      ]);

      expect(
        sorted.map((DeadlineItem entry) => entry.id).toList(),
        <String>['early', 'mid', 'late'],
      );
    });

    test('逾期判定：过了截止才算；已完成不算；恰好截止不算', () {
      final DeadlineItem overdue = item(
        id: 'overdue',
        title: '编译原理期中考试',
        dueAt: DateTime(2026, 11, 21, 14, 0),
      );
      expect(overdue.isOverdueAt(now), isTrue);
      expect(overdue.overdueDaysAt(now), 2);
      expect(describeDeadlineCountdown(overdue, now), '已逾期 2 天');

      final DeadlineItem completed = overdue.copyWith(completed: true);
      expect(completed.isOverdueAt(now), isFalse);
      expect(completed.overdueDaysAt(now), 0);
      expect(describeDeadlineCountdown(completed, now), '已完成');

      final DeadlineItem exactlyDue = item(
        id: 'exact',
        title: '刚好截止',
        dueAt: now,
      );
      expect(exactlyDue.isOverdueAt(now), isFalse);
      expect(describeDeadlineCountdown(exactlyDue, now), '马上截止');

      // 不到 24 小时也按 1 天算，文案不会出现「已逾期 0 天」。
      final DeadlineItem minutesLate = item(
        id: 'late',
        title: '迟交 30 分钟',
        dueAt: now.subtract(const Duration(minutes: 30)),
      );
      expect(minutesLate.overdueDaysAt(now), 1);
      expect(describeDeadlineCountdown(minutesLate, now), '已逾期 1 天');
    });

    test('四种筛选各自只留对应条目', () {
      final List<DeadlineItem> sorted = sortDeadlines(baseItems());

      expect(
        filterDeadlines(sorted, DeadlineFilter.all, now).length,
        4,
      );
      expect(
        filterDeadlines(sorted, DeadlineFilter.unfinished, now)
            .map((DeadlineItem entry) => entry.id)
            .toList(),
        <String>['ddl-b', 'ddl-c', 'ddl-a'],
      );
      expect(
        filterDeadlines(sorted, DeadlineFilter.overdue, now)
            .map((DeadlineItem entry) => entry.id)
            .toList(),
        <String>['ddl-b'],
      );
      expect(
        filterDeadlines(sorted, DeadlineFilter.completed, now)
            .map((DeadlineItem entry) => entry.id)
            .toList(),
        <String>['ddl-d'],
      );
    });

    test('统计条：未完成数 + 最近一条；完成最近一条后数字随之变化', () {
      final DeadlineStats before = deadlineStats(baseItems(), now);
      expect(before.unfinishedCount, 3);
      expect(before.overdueCount, 1);
      expect(before.nearest?.id, 'ddl-b');
      expect(before.summaryAt(now), '未完成 3 条 · 最近一条已逾期 2 天');

      final List<DeadlineItem> after = baseItems()
          .map((DeadlineItem entry) =>
              entry.id == 'ddl-b' ? entry.copyWith(completed: true) : entry)
          .toList(growable: false);
      final DeadlineStats next = deadlineStats(after, now);
      expect(next.unfinishedCount, 2);
      expect(next.overdueCount, 0);
      expect(next.nearest?.id, 'ddl-c');
      expect(
        next.summaryAt(now),
        '未完成 2 条 · 最近一条还有 13 小时 59 分钟',
      );
    });
  });

  group('列表页', () {
    testWidgets('按截止时间升序渲染，逾期条目显示「已逾期 N 天」', (WidgetTester tester) async {
      await pumpDeadlines(tester, items: baseItems());

      final List<String> titles = <String>[
        '嵌入式系统实验报告',
        '编译原理期中考试',
        '金融科技竞赛组队报名',
        '程序分析作业 4',
      ];
      for (int index = 1; index < titles.length; index++) {
        expect(
          tester.getTopLeft(find.text(titles[index])).dy,
          greaterThan(tester.getTopLeft(find.text(titles[index - 1])).dy),
          reason: '${titles[index]} 应排在 ${titles[index - 1]} 之后',
        );
      }

      expect(find.text('已逾期 2 天'), findsOneWidget);
      expect(find.text('截止 11月21日 14:00'), findsOneWidget);
      expect(find.text('来源：教务通知'), findsOneWidget);
      // 统计条不受筛选影响，先看默认值。
      expect(find.text('未完成 3 条 · 最近一条已逾期 2 天'), findsOneWidget);
    });

    testWidgets('筛选 chips：全部 / 未完成 / 已逾期 / 已完成', (WidgetTester tester) async {
      await pumpDeadlines(tester, items: baseItems());

      await tester.tap(find.widgetWithText(ChoiceChip, '已逾期'));
      await tester.pumpAndSettle();
      expect(find.text('编译原理期中考试'), findsOneWidget);
      expect(find.text('嵌入式系统实验报告'), findsNothing);
      expect(find.text('金融科技竞赛组队报名'), findsNothing);
      expect(find.text('程序分析作业 4'), findsNothing);

      await tester.tap(find.widgetWithText(ChoiceChip, '已完成'));
      await tester.pumpAndSettle();
      expect(find.text('嵌入式系统实验报告'), findsOneWidget);
      expect(find.text('编译原理期中考试'), findsNothing);

      await tester.tap(find.widgetWithText(ChoiceChip, '未完成'));
      await tester.pumpAndSettle();
      expect(find.text('编译原理期中考试'), findsOneWidget);
      expect(find.text('金融科技竞赛组队报名'), findsOneWidget);
      expect(find.text('程序分析作业 4'), findsOneWidget);
      expect(find.text('嵌入式系统实验报告'), findsNothing);

      await tester.tap(find.widgetWithText(ChoiceChip, '全部'));
      await tester.pumpAndSettle();
      expect(find.text('嵌入式系统实验报告'), findsOneWidget);
      expect(find.text('编译原理期中考试'), findsOneWidget);
      expect(find.text('金融科技竞赛组队报名'), findsOneWidget);
      expect(find.text('程序分析作业 4'), findsOneWidget);
    });

    testWidgets('勾选完成 → 统计条从「已逾期」变成「还有」', (WidgetTester tester) async {
      final InMemoryDeadlineRepository repository =
          InMemoryDeadlineRepository(items: baseItems());
      tester.view.physicalSize = const Size(1200, 3000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            deadlineRepositoryProvider.overrideWithValue(repository),
            deadlinesClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const DeadlinesPage(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('未完成 3 条 · 最近一条已逾期 2 天'), findsOneWidget);

      await tester.tap(
        find.descendant(
          of: find.byKey(const ValueKey<String>('deadline-ddl-b')),
          matching: find.byType(Checkbox),
        ),
      );
      await tester.pumpAndSettle();

      expect(repository.debugById('ddl-b')!.completed, isTrue);
      expect(
        find.text('未完成 2 条 · 最近一条还有 13 小时 59 分钟'),
        findsOneWidget,
      );
      expect(find.text('已逾期 2 天'), findsNothing);
    });

    testWidgets('删除必须二次确认；取消不删、确认才删', (WidgetTester tester) async {
      final InMemoryDeadlineRepository repository =
          InMemoryDeadlineRepository(items: baseItems());
      tester.view.physicalSize = const Size(1200, 3000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            deadlineRepositoryProvider.overrideWithValue(repository),
            deadlinesClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const DeadlinesPage(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // 第一张卡是已完成的那条（截止最早）。
      await tester.tap(find.byTooltip('删除').first);
      await tester.pumpAndSettle();
      expect(find.text('删除这条 DDL？'), findsOneWidget);

      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(repository.debugLength, 4);
      expect(find.text('嵌入式系统实验报告'), findsOneWidget);

      await tester.tap(find.byTooltip('删除').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('删除'));
      await tester.pumpAndSettle();

      expect(repository.debugLength, 3);
      expect(find.text('嵌入式系统实验报告'), findsNothing);
    });

    testWidgets('页首注明「DDL 不写入课程表」', (WidgetTester tester) async {
      await pumpDeadlines(tester, items: baseItems());

      expect(find.text('DDL 不写入课程表'), findsOneWidget);
    });
  });

  group('新增页', () {
    testWidgets('只填标题就能保存，默认截止是今天 23:59', (WidgetTester tester) async {
      final InMemoryDeadlineRepository repository = await pumpCompose(tester);

      await tester.enterText(
        find.byKey(const Key('deadline-title-field')),
        '程序分析作业 5：上下文敏感指针分析',
      );
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();

      expect(repository.debugLength, 1);
      final DeadlineItem created = repository.debugById('ddl-new-1')!;
      expect(created.title, '程序分析作业 5：上下文敏感指针分析');
      expect(created.kind, DeadlineKind.homework);
      expect(created.dueAt, DateTime(2026, 11, 24, 23, 59));
      expect(created.completed, isFalse);
    });

    testWidgets('标题为空 → 显示具体问题，且不写入', (WidgetTester tester) async {
      final InMemoryDeadlineRepository repository = await pumpCompose(tester);

      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();

      expect(find.textContaining('标题不能为空'), findsOneWidget);
      expect(find.textContaining('还有 1 处需要改一下'), findsOneWidget); // SnackBar
      expect(repository.debugLength, 0);
    });
  });
}
