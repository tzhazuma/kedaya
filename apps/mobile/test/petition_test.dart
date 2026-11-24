import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:kedaya/domain/models/petition_ticket.dart';
import 'package:kedaya/domain/ports/local_cache_port.dart';
import 'package:kedaya/features/petition/application/petition_providers.dart';
import 'package:kedaya/features/petition/application/petition_store.dart';
import 'package:kedaya/features/petition/presentation/components/petition_widgets.dart';
import 'package:kedaya/features/petition/presentation/pages/petition_compose_page.dart';
import 'package:kedaya/features/petition/presentation/pages/petition_detail_page.dart';
import 'package:kedaya/features/petition/presentation/pages/petition_page.dart';
import 'package:kedaya/features/petition/presentation/petition_paths.dart';
import 'package:kedaya/features/petition/presentation/petition_routes.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// `petition`（建议与诉求）的规则层 + 页面测试。
///
/// 重点不是「页面能打开」，而是四条产品规则：
///   1. 空标题 / 超长正文 / 未选类别一定被拦下；
///   2. 时间线只能按「已提交 → 处理中 → 已回复」推进；
///   3. 只有「已提交」可以撤回；
///   4. 匿名时联系方式字段不显示，本机也不保存。
void main() {
  final DateTime t0 = DateTime.utc(2026, 11, 20, 8);
  final DateTime t1 = t0.add(const Duration(hours: 6));
  final DateTime t2 = t0.add(const Duration(days: 1));

  PetitionTicket makeTicket({
    String id = 'p-1',
    PetitionCategory category = PetitionCategory.teaching,
    String title = '希望教学楼 3 楼的饮水机维修',
    String body = '3 楼东侧的饮水机已经坏了三天，希望尽快维修。',
    bool anonymous = false,
    String? contact,
    DateTime? submittedAt,
    DateTime? processingAt,
    DateTime? repliedAt,
    String? reply,
  }) =>
      PetitionTicket(
        id: id,
        category: category,
        title: title,
        body: body,
        anonymous: anonymous,
        contact: contact,
        submittedAt: submittedAt ?? t0,
        processingAt: processingAt,
        repliedAt: repliedAt,
        reply: reply,
      );

  PetitionTicket processingTicket({String id = 'p-processing'}) =>
      makeTicket(id: id).advanceTo(PetitionStatus.processing, t1);

  PetitionTicket repliedTicket({String id = 'p-replied'}) =>
      processingTicket(id: id).advanceTo(
        PetitionStatus.replied,
        t2,
        reply: '已转公共服务处，预计本周内处理。',
      );

  ProviderContainer makeContainer(_MemoryPetitionStore store) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        petitionStoreProvider.overrideWithValue(store),
        petitionClockProvider.overrideWithValue(() => t1),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<void> pumpPetitionApp(
    WidgetTester tester,
    _MemoryPetitionStore store, {
    String initialLocation = PetitionRoutes.list,
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final GoRouter router = GoRouter(
      initialLocation: initialLocation,
      routes: buildPetitionRoutes(),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          petitionStoreProvider.overrideWithValue(store),
          petitionClockProvider.overrideWithValue(() => t1),
        ],
        child: MaterialApp.router(
          theme: KedaYaTheme.light(),
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('提交校验', () {
    test('未选类别 / 空标题 / 超长正文都会被拦下', () {
      expect(
        validatePetitionDraft(
          const PetitionDraft(title: '标题', body: '正文'),
        ),
        contains(PetitionDraftProblem.categoryMissing),
      );
      expect(
        validatePetitionDraft(
          const PetitionDraft(
            category: PetitionCategory.teaching,
            title: '   ',
            body: '正文',
          ),
        ),
        contains(PetitionDraftProblem.titleEmpty),
      );
      expect(
        validatePetitionDraft(
          PetitionDraft(
            category: PetitionCategory.teaching,
            title: '标题',
            body: '长' * (petitionBodyMax + 1),
          ),
        ),
        contains(PetitionDraftProblem.bodyTooLong),
      );
    });

    test('正文恰好 1000 字可以通过；空正文会被拦下', () {
      expect(
        validatePetitionDraft(
          PetitionDraft(
            category: PetitionCategory.other,
            title: '标题',
            body: '长' * petitionBodyMax,
          ),
        ),
        isEmpty,
      );
      expect(
        validatePetitionDraft(
          const PetitionDraft(
            category: PetitionCategory.other,
            title: '标题',
            body: '   ',
          ),
        ),
        contains(PetitionDraftProblem.bodyEmpty),
      );
    });

    test('controller 拒绝不合法草稿，且不写盘', () async {
      final _MemoryPetitionStore store = _MemoryPetitionStore();
      final ProviderContainer container = makeContainer(store);

      await expectLater(
        container.read(petitionTicketsProvider.notifier).submit(
              const PetitionDraft(
                category: PetitionCategory.teaching,
                title: '',
                body: '正文',
              ),
            ),
        throwsA(isA<PetitionDraftException>()),
      );

      expect(store.writes, 0);
      expect(container.read(petitionTicketsProvider), isEmpty);
    });

    test('问题码都有可读提示', () {
      for (final PetitionDraftProblem problem in PetitionDraftProblem.values) {
        expect(describePetitionProblem(problem), isNotEmpty);
        expect(describePetitionProblem(problem), isNot(problem.wire));
      }
    });
  });

  group('状态流转时间线顺序', () {
    test('已提交：三步都在，只有第一步有时间', () {
      final PetitionTicket ticket = makeTicket();
      expect(ticket.status, PetitionStatus.submitted);

      final List<PetitionTimelineEntry> timeline = petitionTimeline(ticket);
      expect(
        timeline.map((PetitionTimelineEntry e) => e.status).toList(),
        <PetitionStatus>[
          PetitionStatus.submitted,
          PetitionStatus.processing,
          PetitionStatus.replied,
        ],
      );
      expect(timeline[0].at, t0);
      expect(timeline[0].happened, isTrue);
      expect(timeline[1].at, isNull);
      expect(timeline[2].at, isNull);
    });

    test('推进到已回复后每步都有时间且严格递增', () {
      final PetitionTicket ticket = repliedTicket();
      expect(ticket.status, PetitionStatus.replied);

      final List<PetitionTimelineEntry> timeline = petitionTimeline(ticket);
      expect(timeline.every((PetitionTimelineEntry e) => e.happened), isTrue);
      expect(timeline[0].at!.isBefore(timeline[1].at!), isTrue);
      expect(timeline[1].at!.isBefore(timeline[2].at!), isTrue);
      expect(ticket.reply, '已转公共服务处，预计本周内处理。');
    });

    test('不能跳过「处理中」直接回复', () {
      expect(
        () => makeTicket().advanceTo(
          PetitionStatus.replied,
          t2,
          reply: '跳格',
        ),
        throwsStateError,
      );
    });

    test('不能回退，也不能把时间改早', () {
      final PetitionTicket replied = repliedTicket();
      expect(
        () => replied.advanceTo(PetitionStatus.processing, t1),
        throwsStateError,
      );
      expect(
        () => makeTicket().advanceTo(
          PetitionStatus.processing,
          t0.subtract(const Duration(minutes: 1)),
        ),
        throwsArgumentError,
      );
    });

    test('构造时拒绝「有回复时间却没有处理时间」', () {
      expect(
        () => makeTicket(repliedAt: t2, reply: '跳格'),
        throwsArgumentError,
      );
    });
  });

  group('撤回仅对已提交生效', () {
    test('只有「已提交」的 canWithdraw 为 true', () {
      expect(makeTicket().canWithdraw, isTrue);
      expect(processingTicket().canWithdraw, isFalse);
      expect(repliedTicket().canWithdraw, isFalse);
    });

    test('撤回已提交记录：从列表与本机删除', () async {
      final _MemoryPetitionStore store =
          _MemoryPetitionStore(<PetitionTicket>[makeTicket()]);
      final ProviderContainer container = makeContainer(store);

      await container.read(petitionTicketsProvider.notifier).withdraw('p-1');

      expect(container.read(petitionTicketsProvider), isEmpty);
      expect(store.tickets, isEmpty);
      expect(store.writes, 1);
    });

    test('处理中 / 已回复不能撤回，且不写盘', () async {
      final _MemoryPetitionStore store = _MemoryPetitionStore(
        <PetitionTicket>[
          processingTicket(id: 'p-processing'),
          repliedTicket(id: 'p-replied'),
        ],
      );
      final ProviderContainer container = makeContainer(store);
      final PetitionTicketsController controller =
          container.read(petitionTicketsProvider.notifier);

      await expectLater(controller.withdraw('p-processing'), throwsStateError);
      await expectLater(controller.withdraw('p-replied'), throwsStateError);

      expect(container.read(petitionTicketsProvider), hasLength(2));
      expect(store.writes, 0);
    });

    test('不存在的 id 抛 StateError', () async {
      final _MemoryPetitionStore store = _MemoryPetitionStore();
      final ProviderContainer container = makeContainer(store);

      await expectLater(
        container.read(petitionTicketsProvider.notifier).withdraw('nope'),
        throwsStateError,
      );
      expect(store.writes, 0);
    });
  });

  group('匿名与联系方式', () {
    test('匿名记录在构造时丢弃联系方式（JSON 里也没有）', () {
      final PetitionTicket ticket = makeTicket(
        anonymous: true,
        contact: 'student@example.edu',
      );
      expect(ticket.contact, isNull);
      expect(ticket.toJson()['contact'], isNull);
    });

    testWidgets('匿名开关隐藏联系方式字段，关闭后恢复', (WidgetTester tester) async {
      await pumpPetitionApp(
        tester,
        _MemoryPetitionStore(),
        initialLocation: PetitionRoutes.compose,
      );

      expect(find.byKey(const Key('petition-contact')), findsOneWidget);

      await tester.tap(find.byKey(const Key('petition-anonymous')));
      await tester.pump();
      expect(find.byKey(const Key('petition-contact')), findsNothing);

      await tester.tap(find.byKey(const Key('petition-anonymous')));
      await tester.pump();
      expect(find.byKey(const Key('petition-contact')), findsOneWidget);
    });

    testWidgets('匿名提交后本机记录没有联系方式，列表能看到标题', (WidgetTester tester) async {
      final _MemoryPetitionStore store = _MemoryPetitionStore();
      await pumpPetitionApp(tester, store);

      await tester.tap(find.byKey(const Key('petition-new-button')));
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const Key('petition-category-teaching')),
      );
      await tester.pump();
      await tester.enterText(
        find.byKey(const Key('petition-title')),
        '希望延长图书馆开放时间',
      );
      await tester.enterText(
        find.byKey(const Key('petition-body')),
        '考试周希望把闭馆时间延后到 23:00。',
      );
      await tester.enterText(
        find.byKey(const Key('petition-contact')),
        'student@example.edu',
      );
      await tester.tap(find.byKey(const Key('petition-anonymous')));
      await tester.pump();

      await tester.scrollUntilVisible(
        find.byKey(const Key('petition-submit-button')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('petition-submit-button')));
      await tester.pumpAndSettle();

      expect(store.tickets, hasLength(1));
      expect(store.tickets.single.anonymous, isTrue);
      expect(store.tickets.single.contact, isNull);
      expect(find.byType(PetitionPage), findsOneWidget);
      expect(find.text('希望延长图书馆开放时间'), findsOneWidget);
    });
  });

  group('详情页', () {
    testWidgets('已回复：时间线顺序正确、回复可见、没有撤回按钮', (WidgetTester tester) async {
      final _MemoryPetitionStore store = _MemoryPetitionStore(
        <PetitionTicket>[repliedTicket(id: 'p-replied')],
      );
      await pumpPetitionApp(
        tester,
        store,
        initialLocation: PetitionRoutes.detail('p-replied'),
      );

      expect(find.byType(PetitionDetailPage), findsOneWidget);
      expect(find.byType(PetitionStatusBadge), findsOneWidget);
      expect(find.text('已转公共服务处，预计本周内处理。'), findsOneWidget);
      expect(
        find.byKey(const Key('petition-timeline-submitted')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('petition-timeline-processing')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('petition-timeline-replied')),
        findsOneWidget,
      );

      final double submittedY = tester
          .getTopLeft(find.byKey(const Key('petition-timeline-submitted')))
          .dy;
      final double processingY = tester
          .getTopLeft(find.byKey(const Key('petition-timeline-processing')))
          .dy;
      final double repliedY = tester
          .getTopLeft(find.byKey(const Key('petition-timeline-replied')))
          .dy;
      expect(submittedY < processingY, isTrue);
      expect(processingY < repliedY, isTrue);
      expect(
        find.byKey(const Key('petition-withdraw-button')),
        findsNothing,
      );
    });

    testWidgets('已提交：撤回需确认，撤回后回到列表并删除', (WidgetTester tester) async {
      final _MemoryPetitionStore store =
          _MemoryPetitionStore(<PetitionTicket>[makeTicket()]);
      await pumpPetitionApp(tester, store);

      await tester.tap(find.text('希望教学楼 3 楼的饮水机维修'));
      await tester.pumpAndSettle();
      expect(find.byType(PetitionDetailPage), findsOneWidget);
      expect(
        find.byKey(const Key('petition-withdraw-button')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('petition-withdraw-button')));
      await tester.pumpAndSettle();
      expect(find.text('撤回这条提交？'), findsOneWidget);

      await tester.tap(find.text('撤回'));
      await tester.pumpAndSettle();

      expect(store.tickets, isEmpty);
      expect(find.byType(PetitionPage), findsOneWidget);
      expect(find.text('还没有提交过建议'), findsOneWidget);
    });
  });

  group('排序与本机存储', () {
    test('按提交时间倒序，时间相同保持输入顺序', () {
      final PetitionTicket a = makeTicket(id: 'a', submittedAt: t0);
      final PetitionTicket b = makeTicket(id: 'b', submittedAt: t2);
      final PetitionTicket c = makeTicket(id: 'c', submittedAt: t2);

      expect(
        sortPetitionTickets(<PetitionTicket>[a, b, c])
            .map((PetitionTicket ticket) => ticket.id)
            .toList(),
        <String>['b', 'c', 'a'],
      );
    });

    test('写盘 → 读盘保持全部字段', () async {
      final _MemoryCache cache = _MemoryCache();
      final LocalPetitionStore store = LocalPetitionStore(cache);
      final PetitionTicket ticket = repliedTicket();

      await store.write(<PetitionTicket>[ticket]);

      expect(store.read(), <PetitionTicket>[ticket]);
    });

    test('单条损坏只丢一条，不清空整个列表', () async {
      final _MemoryCache cache = _MemoryCache();
      await cache.writeJson(petitionStorageKey, <String, Object?>{
        'version': 1,
        'tickets': <Object?>[
          makeTicket().toJson(),
          <String, Object?>{'id': 'broken'},
          <String, Object?>{
            ...makeTicket(id: 'p-2').toJson(),
            'category': 'unknown',
          },
        ],
      });

      final LocalPetitionStore store = LocalPetitionStore(cache);
      expect(
        store.read().map((PetitionTicket ticket) => ticket.id).toList(),
        <String>['p-1'],
      );
    });
  });

  group('路由', () {
    testWidgets('/petition 指向列表页', (WidgetTester tester) async {
      await pumpPetitionApp(tester, _MemoryPetitionStore());
      expect(find.byType(PetitionPage), findsOneWidget);
      expect(find.text('建议与诉求'), findsOneWidget);
      expect(find.text(petitionDemoNoticeText), findsOneWidget);
    });

    testWidgets('/petition/new 不会被 :id 吃掉', (WidgetTester tester) async {
      await pumpPetitionApp(
        tester,
        _MemoryPetitionStore(),
        initialLocation: PetitionRoutes.compose,
      );
      expect(find.byType(PetitionComposePage), findsOneWidget);
      expect(find.byType(PetitionDetailPage), findsNothing);
    });

    testWidgets('/petition/:id 指向详情页', (WidgetTester tester) async {
      await pumpPetitionApp(
        tester,
        _MemoryPetitionStore(<PetitionTicket>[makeTicket(id: 'p-1')]),
        initialLocation: PetitionRoutes.detail('p-1'),
      );
      expect(find.byType(PetitionDetailPage), findsOneWidget);
    });
  });
}

/// 内存版 `PetitionStore`：记录写盘次数，方便断言「校验失败时不写」。
final class _MemoryPetitionStore implements PetitionStore {
  _MemoryPetitionStore([
    List<PetitionTicket> seed = const <PetitionTicket>[],
  ]) : _tickets = List<PetitionTicket>.of(seed);

  List<PetitionTicket> _tickets;
  int writes = 0;

  List<PetitionTicket> get tickets =>
      List<PetitionTicket>.unmodifiable(_tickets);

  @override
  List<PetitionTicket> read() => List<PetitionTicket>.of(_tickets);

  @override
  Future<void> write(List<PetitionTicket> tickets) async {
    writes += 1;
    _tickets = List<PetitionTicket>.of(tickets);
  }
}

/// 内存版 `LocalCachePort`：只存 JSON，不碰 SharedPreferences。
final class _MemoryCache implements LocalCachePort {
  final Map<String, Object?> values = <String, Object?>{};

  @override
  Object? readJson(String key) => values[key];

  @override
  Future<void> writeJson(String key, Object? value) async {
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<void> clear() async {
    values.clear();
  }
}
