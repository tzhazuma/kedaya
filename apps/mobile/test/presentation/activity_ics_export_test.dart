import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/ports/platform_ports.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_detail_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 详情页的「导出到日历」入口。
///
/// 只测两件事：**什么时候出现**、**导出的是不是这条活动**。
/// ICS 格式本身由 `activity_ics_test.dart` 的 7 例覆盖。
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

  ActivityItem item({DateTime? startsAt, ActivityStatus? status}) => ActivityItem(
        id: 'act-ics',
        source: ActivitySource.wechatMp,
        kind: 'other',
        title: '校园马拉松',
        status: status ?? ActivityStatus.confirmed,
        startsAt: startsAt,
        location: '东区体育场',
        evidenceText: '11 月 30 日开跑',
      );

  Future<_RecordingShare> pump(
    WidgetTester tester,
    ActivityItem activity,
  ) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final _RecordingShare share = _RecordingShare();
    final MockActivitiesRepository repo = MockActivitiesRepository(
      activities: <ActivityItem>[activity],
      controls: MockControls(latency: Duration.zero),
      clock: () => now,
    );
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          activitiesRepositoryProvider.overrideWithValue(repo),
          shareProvider.overrideWithValue(share),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const ActivityDetailPage(activityId: 'act-ics'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return share;
  }

  testWidgets('没有开始时间时不出现导出入口', (WidgetTester tester) async {
    await pump(tester, item());
    expect(find.byTooltip('导出到日历（ICS）'), findsNothing);
  });

  testWidgets('有开始时间时导出这一条活动', (WidgetTester tester) async {
    final _RecordingShare share = await pump(
      tester,
      item(startsAt: DateTime.utc(2026, 11, 30, 2)),
    );

    await tester.tap(find.byTooltip('导出到日历（ICS）'));
    await tester.pumpAndSettle();

    expect(share.copied, isNotNull);
    expect(share.copied, contains('BEGIN:VCALENDAR'));
    expect(share.copied, contains('UID:activity-act-ics@kedaya'));
    expect(share.copied, contains('DTSTART:20261130T020000Z'));
    expect(find.textContaining('已复制 ICS'), findsOneWidget);
  });

  testWidgets('待确认活动导出时提示先核对时间', (WidgetTester tester) async {
    await pump(
      tester,
      item(
        startsAt: DateTime.utc(2026, 11, 30, 2),
        status: ActivityStatus.candidate,
      ),
    );

    await tester.tap(find.byTooltip('导出到日历（ICS）'));
    await tester.pumpAndSettle();

    expect(find.textContaining('还没确认'), findsOneWidget);
  });
}
