import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_router.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/ports/platform_ports.dart';
import 'package:kedaya/features/activities/application/activities_providers.dart';
import 'package:kedaya/features/activities/presentation/pages/activities_page.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_compose_page.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_detail_page.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_import_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

final class _RecordingShare implements SharePort {
  final List<String> copied = <String>[];

  @override
  Future<void> copyToClipboard(String text) async => copied.add(text);

  @override
  Future<void> shareLink(Uri uri, {String? title}) async =>
      copied.add(uri.toString());

  @override
  Future<void> shareText(String text, {String? subject}) async =>
      copied.add(text);
}

final class _FailingShare implements SharePort {
  @override
  Future<void> copyToClipboard(String text) async =>
      throw StateError('clipboard unavailable');

  @override
  Future<void> shareLink(Uri uri, {String? title}) async =>
      throw StateError('share unavailable');

  @override
  Future<void> shareText(String text, {String? subject}) async =>
      throw StateError('share unavailable');
}

void main() {
  final DateTime now = DateTime.utc(2026, 11, 22);

  MockActivitiesRepository buildRepo() => MockActivitiesRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => now,
      );

  Future<void> pumpPage(
    WidgetTester tester,
    Widget page, {
    MockActivitiesRepository? repository,
    SharePort? share,
    ThemeData? theme,
    List<Override> overrides = const <Override>[],
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider
              .overrideWithValue(repository ?? buildRepo()),
          activitiesClockProvider.overrideWithValue(() => now),
          if (share != null) shareProvider.overrideWithValue(share),
          ...overrides,
        ],
        child: MaterialApp(
          theme: theme ?? KedaYaTheme.light(),
          home: page,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> pumpRoute(
    WidgetTester tester,
    String location, {
    MockActivitiesRepository? repository,
    SharePort? share,
    List<Override> overrides = const <Override>[],
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider
              .overrideWithValue(repository ?? buildRepo()),
          activitiesClockProvider.overrideWithValue(() => now),
          if (share != null) shareProvider.overrideWithValue(share),
          ...overrides,
        ],
        child: MaterialApp.router(
          theme: KedaYaTheme.light(),
          routerConfig: createAppRouter(initialLocation: location),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('列表页', () {
    testWidgets('来源与状态筛选是叠加的', (WidgetTester tester) async {
      await pumpPage(tester, const ActivitiesPage());

      expect(find.text('人工智能与教育创新论坛'), findsOneWidget);
      expect(find.text('旧书交换市集'), findsOneWidget);

      await tester.tap(find.widgetWithText(ChoiceChip, '公众号'));
      await tester.pumpAndSettle();
      expect(find.text('人工智能与教育创新论坛'), findsOneWidget);
      expect(find.text('社团招新路演'), findsOneWidget);
      expect(find.text('旧书交换市集'), findsNothing);

      await tester.tap(find.widgetWithText(ChoiceChip, '待确认'));
      await tester.pumpAndSettle();
      expect(find.text('人工智能与教育创新论坛'), findsNothing);
      expect(find.text('社团招新路演'), findsOneWidget);
      expect(find.text('校园讲座：可信 AI 的边界'), findsNothing);
    });

    testWidgets('筛选无结果时给出可行动的文案', (WidgetTester tester) async {
      await pumpPage(tester, const ActivitiesPage());

      await tester.tap(find.widgetWithText(ChoiceChip, '手动创建'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ChoiceChip, '待确认'));
      await tester.pumpAndSettle();

      expect(find.text('没有符合筛选的活动'), findsOneWidget);
      expect(find.textContaining('切换到全部来源'), findsOneWidget);
    });

    testWidgets('页首写明“待确认不会进日程、不会触发提醒”', (WidgetTester tester) async {
      await pumpPage(tester, const ActivitiesPage());
      expect(find.textContaining('待确认'), findsWidgets);
      expect(find.textContaining('不会进入日程'), findsWidgets);
    });

    testWidgets('列表跟随 nextCursor 加载更多', (WidgetTester tester) async {
      await pumpPage(
        tester,
        const ActivitiesPage(),
        overrides: <Override>[
          activitiesPageSizeProvider.overrideWithValue(2),
        ],
      );

      expect(find.text('社团招新路演'), findsNothing);

      await tester.scrollUntilVisible(
        find.byKey(const Key('activities-load-more')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('activities-load-more')));
      await tester.pumpAndSettle();

      expect(find.text('社团招新路演'), findsOneWidget);
    });

    testWidgets('刷新失败时保留旧列表并提示', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpPage(tester, const ActivitiesPage(), repository: repository);
      expect(find.text('人工智能与教育创新论坛'), findsOneWidget);

      repository.controls.failureMode = MockFailureMode.upstreamUnavailable;
      await tester.tap(find.byTooltip('刷新'));
      await tester.pumpAndSettle();

      expect(find.text('人工智能与教育创新论坛'), findsOneWidget);
      expect(find.textContaining('刷新失败'), findsOneWidget);
    });

    testWidgets('320px 宽度不溢出', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            appRuntimeProvider.overrideWithValue(runtime),
            activitiesRepositoryProvider.overrideWithValue(buildRepo()),
            activitiesClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const ActivitiesPage(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('校园活动'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('详情页', () {
    testWidgets('候选活动只显示确认/忽略，不显示提醒', (WidgetTester tester) async {
      await pumpPage(tester, const ActivityDetailPage(activityId: 'act-1002'));

      expect(find.text('待确认'), findsWidgets);
      expect(find.text('确认活动'), findsOneWidget);
      expect(find.text('忽略'), findsOneWidget);
      expect(find.textContaining('确认后才会创建提醒'), findsOneWidget);
      expect(find.text('报名截止提醒'), findsNothing);
      expect(find.textContaining('站内信'), findsNothing);
    });

    testWidgets('确认后状态变为已确认，并展示默认的报名截止/开始提醒', (WidgetTester tester) async {
      await pumpPage(tester, const ActivityDetailPage(activityId: 'act-1002'));

      await tester.tap(find.text('确认活动'));
      await tester.pumpAndSettle();

      expect(find.text('已确认'), findsWidgets);
      expect(find.text('确认活动'), findsNothing);
      expect(find.text('报名截止提醒'), findsOneWidget);
      expect(find.text('开始提醒'), findsOneWidget);
      expect(find.text('站内信'), findsNWidgets(2));
      expect(find.textContaining('提醒只在本应用内展示'), findsOneWidget);
      expect(find.textContaining('不会发送系统推送'), findsOneWidget);
    });

    testWidgets('忽略需要二次确认，确认后不再提供提醒', (WidgetTester tester) async {
      await pumpPage(tester, const ActivityDetailPage(activityId: 'act-1002'));

      await tester.tap(find.text('忽略'));
      await tester.pumpAndSettle();
      expect(find.text('确认忽略'), findsOneWidget);
      expect(find.textContaining('不会提醒，也不会进入日程'), findsOneWidget);

      await tester.tap(find.text('确认忽略'));
      await tester.pumpAndSettle();

      expect(find.text('已忽略'), findsWidgets);
      expect(find.text('确认活动'), findsNothing);
      expect(find.text('报名截止提醒'), findsNothing);
    });

    testWidgets('报名截止只有原文时明确说“没有可确定时刻”', (WidgetTester tester) async {
      await pumpPage(tester, const ActivityDetailPage(activityId: 'act-1003'));

      expect(find.textContaining('原文'), findsWidgets);
      expect(find.textContaining('没有可确定的时刻'), findsOneWidget);
      expect(find.textContaining('23:59'), findsNothing);
    });

    testWidgets('复制报名链接写入剪贴板', (WidgetTester tester) async {
      final _RecordingShare share = _RecordingShare();
      await pumpPage(
        tester,
        const ActivityDetailPage(activityId: 'act-1001'),
        share: share,
      );

      await tester.scrollUntilVisible(
        find.text('复制报名链接'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('复制报名链接'));
      await tester.pumpAndSettle();

      expect(share.copied, contains('https://example.edu/activities/act-1001'));
      expect(find.text('报名链接已复制'), findsOneWidget);
    });

    testWidgets('复制失败时提示手动复制，而不是假装成功', (WidgetTester tester) async {
      await pumpPage(
        tester,
        const ActivityDetailPage(activityId: 'act-1001'),
        share: _FailingShare(),
      );

      await tester.scrollUntilVisible(
        find.text('复制报名链接'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('复制报名链接'));
      await tester.pumpAndSettle();

      expect(find.textContaining('复制失败'), findsOneWidget);
      expect(find.text('报名链接已复制'), findsNothing);
    });

    testWidgets('确认后可添加自定义站内信提醒，选择器使用注入时钟', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      DateTime? capturedNow;
      Future<DateTime?> picker(
        BuildContext context, {
        required DateTime initialUtc,
        required DateTime now,
        DateTime? firstUtc,
        DateTime? lastUtc,
      }) async {
        capturedNow = now;
        return now.add(const Duration(hours: 2));
      }

      await pumpPage(
        tester,
        ActivityDetailPage(
          activityId: 'act-1001',
          pickDateTime: picker,
        ),
        repository: repository,
      );

      await tester.scrollUntilVisible(
        find.byKey(const Key('activity-add-reminder')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('activity-add-reminder')));
      await tester.pumpAndSettle();

      expect(capturedNow, now);
      final List<ActivityReminderItem> reminders =
          repository.debugReminders('act-1001');
      expect(reminders, hasLength(3));
      final ActivityReminderItem created = reminders.firstWhere(
        (ActivityReminderItem reminder) =>
            reminder.kind == ActivityReminderKind.custom,
      );
      expect(created.kind, ActivityReminderKind.custom);
      expect(created.channel, ActivityReminderChannel.inapp);
      expect(find.text('自定义提醒'), findsOneWidget);
    });

    testWidgets('删除提醒需要二次确认，删除后列表刷新', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpPage(
        tester,
        const ActivityDetailPage(activityId: 'act-1001'),
        repository: repository,
      );

      await tester.scrollUntilVisible(
        find.byTooltip('删除提醒').first,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byTooltip('删除提醒').first);
      await tester.pumpAndSettle();
      expect(find.text('删除这条提醒？'), findsOneWidget);

      await tester.tap(find.text('删除'));
      await tester.pumpAndSettle();

      expect(repository.debugReminders('act-1001'), hasLength(1));
    });

    testWidgets('提醒列表跟随 nextCursor 加载更多', (WidgetTester tester) async {
      await pumpPage(
        tester,
        const ActivityDetailPage(activityId: 'act-1001'),
        overrides: <Override>[
          activityRemindersPageSizeProvider.overrideWithValue(1),
        ],
      );

      expect(find.byTooltip('删除提醒'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.byKey(const Key('activity-reminders-load-more')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('activity-reminders-load-more')));
      await tester.pumpAndSettle();

      expect(find.byTooltip('删除提醒'), findsNWidgets(2));
    });

    testWidgets('过去时刻的自定义提醒被拒绝，且不写入', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      Future<DateTime?> pastPicker(
        BuildContext context, {
        required DateTime initialUtc,
        required DateTime now,
        DateTime? firstUtc,
        DateTime? lastUtc,
      }) async =>
          now.subtract(const Duration(hours: 1));

      await pumpPage(
        tester,
        ActivityDetailPage(
          activityId: 'act-1001',
          pickDateTime: pastPicker,
        ),
        repository: repository,
      );

      await tester.scrollUntilVisible(
        find.byKey(const Key('activity-add-reminder')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('activity-add-reminder')));
      await tester.pumpAndSettle();

      expect(find.text('提醒时间必须晚于当前时刻'), findsOneWidget);
      expect(repository.debugReminders('act-1001'), hasLength(2));
    });

    testWidgets('长链接在 320px 下换行且不溢出', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            appRuntimeProvider.overrideWithValue(runtime),
            activitiesRepositoryProvider.overrideWithValue(buildRepo()),
            activitiesClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const ActivityDetailPage(activityId: 'act-1001'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('复制报名链接'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('手动添加', () {
    testWidgets('提交时才校验，错误有文字且不写入', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpRoute(
        tester,
        '/activities/new',
        repository: repository,
      );

      await tester.tap(find.text('保存活动'));
      await tester.pumpAndSettle();

      expect(find.text('请填写活动名称'), findsOneWidget);
      expect(find.text('请检查表单中标红的字段'), findsOneWidget);
      expect(repository.debugLength, 5);
    });

    testWidgets('填名称即可用默认开始时间创建 candidate，并跳到详情', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpRoute(
        tester,
        '/activities/new',
        repository: repository,
      );

      await tester.enterText(
        find.byKey(const Key('activity-title')),
        '计算生物学论坛',
      );
      await tester.enterText(
        find.byKey(const Key('activity-location')),
        '生命学院 4-102',
      );
      await tester.tap(find.text('保存活动'));
      await tester.pumpAndSettle();

      expect(repository.debugLength, 6);
      final ActivityItem created = repository.debugById('act-9100')!;
      expect(created.source, ActivitySource.manual);
      expect(created.status, ActivityStatus.candidate);
      expect(created.title, '计算生物学论坛');
      expect(created.location, '生命学院 4-102');
      expect(find.byType(ActivityDetailPage), findsOneWidget);
    });

    testWidgets('320px 下表单不溢出', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            appRuntimeProvider.overrideWithValue(runtime),
            activitiesRepositoryProvider.overrideWithValue(buildRepo()),
            activitiesClockProvider.overrideWithValue(() => now),
          ],
          child: MaterialApp(
            theme: KedaYaTheme.light(),
            home: const ActivityComposePage(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('手动添加活动'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('公众号单篇导入', () {
    testWidgets('链接与正文至少一个，提交前不阻断编辑', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpRoute(
        tester,
        '/activities/import',
        repository: repository,
      );

      expect(find.textContaining('不会自动发现'), findsOneWidget);
      expect(repository.debugLength, 5);

      await tester.tap(find.text('导入这篇'));
      await tester.pumpAndSettle();

      expect(find.text('请粘贴公众号文章链接或正文'), findsOneWidget);
      expect(repository.debugLength, 5);
    });

    testWidgets('导入链接后生成公众号候选活动', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpRoute(
        tester,
        '/activities/import',
        repository: repository,
      );

      await tester.enterText(
        find.byKey(const Key('wechat-url')),
        'https://mp.weixin.qq.com/s/widget-test',
      );
      await tester.tap(find.text('导入这篇'));
      await tester.pumpAndSettle();

      expect(repository.debugLength, 6);
      final ActivityItem created = repository.debugById('act-9100')!;
      expect(created.source, ActivitySource.wechatMp);
      expect(created.status, ActivityStatus.candidate);
      expect(created.sourceUrl, 'https://mp.weixin.qq.com/s/widget-test');
      expect(find.byType(ActivityDetailPage), findsOneWidget);
    });

    testWidgets('链接与正文同时填写时阻断提交', (WidgetTester tester) async {
      final MockActivitiesRepository repository = buildRepo();
      await pumpRoute(
        tester,
        '/activities/import',
        repository: repository,
      );

      await tester.enterText(
        find.byKey(const Key('wechat-url')),
        'https://mp.weixin.qq.com/s/widget-test',
      );
      await tester.enterText(
        find.byKey(const Key('wechat-text')),
        '活动正文摘录',
      );
      await tester.tap(find.text('导入这篇'));
      await tester.pumpAndSettle();

      expect(find.text('链接与正文只能填一个'), findsOneWidget);
      expect(repository.debugLength, 5);
    });
  });

  group('路由', () {
    testWidgets('/activities 指向列表页', (WidgetTester tester) async {
      await pumpRoute(tester, '/activities');
      expect(find.byType(ActivitiesPage), findsOneWidget);
      expect(find.text('校园活动'), findsOneWidget);
      expect(find.text('手动添加'), findsOneWidget);
    });

    testWidgets('/activities/:id 指向详情页', (WidgetTester tester) async {
      await pumpRoute(tester, '/activities/act-1001');
      expect(find.byType(ActivityDetailPage), findsOneWidget);
      expect(find.text('人工智能与教育创新论坛'), findsOneWidget);
    });

    testWidgets('/activities/import 不会被 :id 吃掉', (WidgetTester tester) async {
      await pumpRoute(tester, '/activities/import');
      expect(find.byType(ActivityImportPage), findsOneWidget);
      expect(find.byType(ActivityDetailPage), findsNothing);
    });
  });
}
