import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/application/consent_controller.dart';
import 'package:kedaya/domain/models/wellbeing_booking.dart';
import 'package:kedaya/features/wellbeing/application/wellbeing_providers.dart';
import 'package:kedaya/features/wellbeing/data/wellbeing_bookings_repository.dart';
import 'package:kedaya/features/wellbeing/domain/wellbeing_crisis.dart';
import 'package:kedaya/features/wellbeing/presentation/components/wellbeing_crisis_card.dart';
import 'package:kedaya/features/wellbeing/presentation/pages/wellbeing_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

void main() {
  group('同意门', () {
    test('同意门未通过时不加载本机预约', () async {
      final _FakeWellbeingRepository repository =
          _FakeWellbeingRepository(seed: <WellbeingBooking>[_booking()]);
      final ProviderContainer container = _container(repository);

      final List<WellbeingBooking> items =
          await container.read(wellbeingBookingsProvider.future);

      expect(items, isEmpty);
      expect(repository.loadCalls, 0);

      // 未同意也可以清空本机记录；清空不读取数据。
      await container.read(wellbeingBookingsProvider.notifier).clearAll();
      expect(repository.items, isEmpty);
      expect(repository.loadCalls, 0);
    });

    test('同意后才读取本机预约', () async {
      final _FakeWellbeingRepository repository =
          _FakeWellbeingRepository(seed: <WellbeingBooking>[_booking()]);
      final ProviderContainer container = _container(repository);

      await container
          .read(consentControllerProvider.notifier)
          .grant(wellbeingModuleId);

      final List<WellbeingBooking> items =
          await container.read(wellbeingBookingsProvider.future);

      expect(repository.loadCalls, greaterThan(0));
      expect(items, hasLength(1));
      expect(items.single.id, 'local-1');
    });

    testWidgets('首屏热线卡在同意门之前也显示，且此时仍未读本机数据', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final _FakeWellbeingRepository repository = _FakeWellbeingRepository(
        seed: <WellbeingBooking>[_booking()],
      );
      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            appRuntimeProvider.overrideWithValue(runtime),
            wellbeingBookingsRepositoryProvider.overrideWithValue(repository),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const WellbeingPage(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text(wellbeingCrisisHeadline), findsOneWidget);
      expect(
        find.text(wellbeingCrisisFallback.displayLabel),
        findsOneWidget,
      );
      expect(find.text('我同意，继续'), findsOneWidget);
      expect(find.textContaining('数据只存本机、随时可删'), findsOneWidget);
      expect(find.textContaining('不做诊断、不做治疗'), findsWidgets);
      expect(repository.loadCalls, 0);

      await tester.tap(find.text('我同意，继续'));
      await tester.pumpAndSettle();

      expect(find.text('预约一次谈话'), findsOneWidget);
      expect(repository.loadCalls, greaterThan(0));
    });
  });

  group('预约校验与提交流程', () {
    test('时间段必选；话题超过 200 字会被拒绝', () {
      const WellbeingBookingDraft missingTime = WellbeingBookingDraft(
        mode: WellbeingTalkMode.inPerson,
      );
      final Map<WellbeingBookingField, String> problems =
          missingTime.validate();
      expect(problems[WellbeingBookingField.timeWindow], isNotNull);
      expect(missingTime.isValid, isFalse);

      final WellbeingBookingDraft tooLong = WellbeingBookingDraft(
        timeWindow: WellbeingTimeWindow.today,
        mode: WellbeingTalkMode.online,
        topic: List<String>.filled(201, '想').join(),
      );
      expect(
        tooLong.validate()[WellbeingBookingField.topic],
        isNotNull,
      );

      const WellbeingBookingDraft valid = WellbeingBookingDraft(
        timeWindow: WellbeingTimeWindow.tomorrow,
        mode: WellbeingTalkMode.phone,
      );
      expect(valid.isValid, isTrue);
    });

    test('提交后进入本机列表，状态是「已提交（演示）」', () async {
      final _FakeWellbeingRepository repository = _FakeWellbeingRepository();
      final ProviderContainer container = _container(repository);
      await container
          .read(consentControllerProvider.notifier)
          .grant(wellbeingModuleId);
      await container.read(wellbeingBookingsProvider.future);

      const WellbeingBookingDraft draft = WellbeingBookingDraft(
        timeWindow: WellbeingTimeWindow.today,
        mode: WellbeingTalkMode.inPerson,
        topic: '最近有点累',
      );
      final WellbeingBooking booking = await container
          .read(wellbeingBookingsProvider.notifier)
          .submit(draft);

      expect(booking.status.label, '已提交（演示）');
      expect(
        container.read(wellbeingBookingsProvider).valueOrNull,
        hasLength(1),
      );
      expect(repository.items.single.topic, '最近有点累');
    });

    test('清空后列表为空', () async {
      final _FakeWellbeingRepository repository =
          _FakeWellbeingRepository(seed: <WellbeingBooking>[_booking()]);
      final ProviderContainer container = _container(repository);
      await container
          .read(consentControllerProvider.notifier)
          .grant(wellbeingModuleId);
      final List<WellbeingBooking> before =
          await container.read(wellbeingBookingsProvider.future);
      expect(before, hasLength(1));

      await container.read(wellbeingBookingsProvider.notifier).clearAll();

      expect(
        container.read(wellbeingBookingsProvider).valueOrNull,
        isEmpty,
      );
      expect(repository.items, isEmpty);
    });
  });

  group('热线兜底', () {
    test('兜底常量存在且文案固定', () {
      expect(
        wellbeingCrisisHeadline,
        '如果你现在有伤害自己的想法，请立刻联系',
      );
      expect(
        wellbeingCrisisFallback.displayLabel,
        '校园心理中心 021-XXXXXXXX（示例）',
      );
      expect(wellbeingCrisisPhoneLabel, wellbeingCrisisFallback.displayLabel);
      expect(wellbeingCrisisFallback.phone, '021-XXXXXXXX');
      expect(wellbeingCrisisVerifyNote, '上线前必须逐个拨通核实');
    });

    testWidgets('热线卡不依赖任何数据也能渲染', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: WellbeingCrisisCard()),
          ),
        ),
      );

      expect(find.text(wellbeingCrisisHeadline), findsOneWidget);
      expect(
        find.text(wellbeingCrisisFallback.displayLabel),
        findsOneWidget,
      );
      expect(
        find.textContaining(wellbeingCrisisVerifyNote),
        findsOneWidget,
      );
    });
  });
}

ProviderContainer _container(WellbeingBookingsRepository repository) {
  final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      appRuntimeProvider.overrideWithValue(runtime),
      wellbeingBookingsRepositoryProvider.overrideWithValue(repository),
      clockProvider.overrideWithValue(() => DateTime(2026, 11, 24, 9, 30)),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(runtime.dispose);
  return container;
}

WellbeingBooking _booking() => WellbeingBooking(
      id: 'local-1',
      createdAt: DateTime(2026, 11, 24, 8),
      timeWindow: WellbeingTimeWindow.today,
      mode: WellbeingTalkMode.inPerson,
      topic: '最近有点累',
    );

final class _FakeWellbeingRepository implements WellbeingBookingsRepository {
  _FakeWellbeingRepository(
      {List<WellbeingBooking> seed = const <WellbeingBooking>[]})
      : _items = <WellbeingBooking>[...seed];

  final List<WellbeingBooking> _items;
  int loadCalls = 0;

  List<WellbeingBooking> get items =>
      List<WellbeingBooking>.unmodifiable(_items);

  @override
  List<WellbeingBooking> load() {
    loadCalls++;
    return List<WellbeingBooking>.unmodifiable(_items);
  }

  @override
  Future<void> save(List<WellbeingBooking> bookings) async {
    _items
      ..clear()
      ..addAll(bookings);
  }

  @override
  Future<void> clear() async {
    _items.clear();
  }
}
