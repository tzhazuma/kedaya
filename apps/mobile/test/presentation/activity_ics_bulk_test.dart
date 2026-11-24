import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/ports/platform_ports.dart';
import 'package:kedaya/features/activities/application/activities_providers.dart';
import 'package:kedaya/features/activities/presentation/pages/activities_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 列表页的「一次导出已确认活动到日历」。
///
/// 只测两条判据：**只导已确认且有时间**、**没有可导的活动时按钮禁用**。
/// ICS 格式本身由 `activity_ics_test.dart` 覆盖。
final class _RecordingShare implements SharePort {
  String? copied;

  @override
  Future<void> copyToClipboard(String text) async => copied = text;

  @override
  Future<void> shareLink(Uri uri, {String? title}) async {}

  @override
  Future<void> shareText(String text, {String? subject}) async {}
}

void main() {
  final DateTime now = DateTime.utc(2026, 11, 24);

  ActivityItem item({
    required String id,
    required String title,
    ActivityStatus status = ActivityStatus.confirmed,
    DateTime? startsAt,
  }) =>
      ActivityItem(
        id: id,
        source: ActivitySource.wechatMp,
        kind: 'other',
        title: title,
        status: status,
        startsAt: startsAt,
      );

  Future<_RecordingShare> pump(
    WidgetTester tester,
    List<ActivityItem> activities,
  ) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final _RecordingShare share = _RecordingShare();
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider.overrideWithValue(
            MockActivitiesRepository(
              activities: activities,
              controls: MockControls(latency: Duration.zero),
              clock: () => now,
            ),
          ),
          activitiesClockProvider.overrideWithValue(() => now),
          shareProvider.overrideWithValue(share),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const ActivitiesPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return share;
  }

  testWidgets('只导已确认且有开始时间的活动', (WidgetTester tester) async {
    final _RecordingShare share = await pump(tester, <ActivityItem>[
      item(
        id: 'confirmed',
        title: '已确认的活动',
        startsAt: DateTime.utc(2026, 11, 30, 2),
      ),
      item(id: 'no-time', title: '没有时间的活动'),
      item(
        id: 'candidate',
        title: '待确认的活动',
        status: ActivityStatus.candidate,
        startsAt: DateTime.utc(2026, 12, 1, 2),
      ),
    ]);

    await tester.tap(find.byTooltip('导出已确认活动到日历（ICS）'));
    await tester.pumpAndSettle();

    expect(share.copied, isNotNull);
    expect(share.copied, contains('UID:activity-confirmed@kedaya'));
    expect(share.copied, isNot(contains('activity-no-time')));
    expect(share.copied, isNot(contains('activity-candidate')));
    expect(find.textContaining('已复制 1 条活动'), findsOneWidget);
  });

  testWidgets('没有可导活动时按钮禁用', (WidgetTester tester) async {
    await pump(tester, <ActivityItem>[
      item(
        id: 'candidate',
        title: '待确认',
        status: ActivityStatus.candidate,
        startsAt: DateTime.utc(2026, 12, 1, 2),
      ),
    ]);

    final IconButton button = tester.widget<IconButton>(
      find.ancestor(
        of: find.byIcon(Icons.event_available_outlined),
        matching: find.byType(IconButton),
      ),
    );
    expect(button.onPressed, isNull);
  });
}
