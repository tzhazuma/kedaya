import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/activity_fixtures.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 11, 22);
  final DateTime startOfDemoWindow = now;

  MockActivitiesRepository repo({DateTime Function()? clock}) =>
      MockActivitiesRepository(
        controls: MockControls(latency: Duration.zero),
        clock: clock ?? () => now,
      );

  group('演示数据', () {
    test('覆盖三种来源与四种状态', () {
      final List<ActivityItem> items = buildMockActivities(startOfDemoWindow);
      expect(
        items.map((ActivityItem item) => item.source).toSet(),
        <ActivitySource>{
          ActivitySource.campusMail,
          ActivitySource.wechatMp,
          ActivitySource.manual,
        },
      );
      expect(
        items.map((ActivityItem item) => item.status).toSet(),
        <ActivityStatus>{
          ActivityStatus.candidate,
          ActivityStatus.confirmed,
          ActivityStatus.dismissed,
          ActivityStatus.archived,
        },
      );
    });

    test('有一条只有原文截止时间的候选活动（用于守住“不补 23:59”）', () {
      final ActivityItem item = buildMockActivities(startOfDemoWindow)
          .firstWhere((ActivityItem candidate) =>
              candidate.registrationDeadlineRaw != null &&
              candidate.registrationDeadlineAt == null);
      expect(item.status, ActivityStatus.candidate);
      expect(item.registrationDeadlineRaw, isNotNull);
      expect(item.registrationDeadlineLabel, isNot(contains('23:59')));
    });
  });

  group('list', () {
    test('按来源筛选', () async {
      final Page<ActivityItem> page =
          (await repo().list(source: ActivitySource.wechatMp)).unwrap;
      expect(page.items, hasLength(2));
      expect(
        page.items.every(
          (ActivityItem item) => item.source == ActivitySource.wechatMp,
        ),
        isTrue,
      );
    });

    test('按状态筛选', () async {
      final Page<ActivityItem> page =
          (await repo().list(status: ActivityStatus.candidate)).unwrap;
      expect(page.items, hasLength(2));
      expect(
        page.items.every(
          (ActivityItem item) => item.status == ActivityStatus.candidate,
        ),
        isTrue,
      );
    });

    test('来源与状态是叠加条件', () async {
      final Page<ActivityItem> page = (await repo().list(
        source: ActivitySource.campusMail,
        status: ActivityStatus.candidate,
      ))
          .unwrap;
      expect(page.items.single.id, 'act-1002');
    });

    test('空结果开关与故障注入', () async {
      final MockActivitiesRepository empty = repo();
      empty.controls.emptyResults = true;
      expect((await empty.list()).unwrap.items, isEmpty);

      final MockActivitiesRepository failing = repo();
      failing.controls.failureMode = MockFailureMode.upstreamUnavailable;
      final Result<Page<ActivityItem>> result = await failing.list();
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.upstreamUnavailable);
    });

    test('不传 status 时默认只返回 candidate + confirmed（与 OpenAPI 一致）', () async {
      final Page<ActivityItem> page = (await repo().list()).unwrap;
      expect(
        page.items.every((ActivityItem item) =>
            item.status == ActivityStatus.candidate ||
            item.status == ActivityStatus.confirmed),
        isTrue,
      );
      expect(page.total, 3);
    });

    test('列表跟随 limit / cursor 分页，页间不重复', () async {
      final MockActivitiesRepository repository = repo();
      final Set<String> ids = <String>{};

      final Page<ActivityItem> first = (await repository.list(limit: 2)).unwrap;
      expect(first.items, hasLength(2));
      expect(first.nextCursor, isNotNull);
      ids.addAll(first.items.map((ActivityItem item) => item.id));

      final Page<ActivityItem> second = (await repository.list(
        limit: 2,
        cursor: first.nextCursor,
      ))
          .unwrap;
      expect(second.items, hasLength(1));
      expect(second.nextCursor, isNull);
      ids.addAll(second.items.map((ActivityItem item) => item.id));

      expect(ids, hasLength(3));
    });
  });

  group('confirm / dismiss', () {
    test('候选活动确认后生成默认站内提醒', () async {
      final MockActivitiesRepository repository = repo();
      expect(
        (await repository.listReminders(activityId: 'act-1002')).unwrap.items,
        isEmpty,
      );

      final ActivityItem confirmed =
          (await repository.confirm('act-1002')).unwrap;
      expect(confirmed.status, ActivityStatus.confirmed);
      expect(confirmed.canScheduleReminders, isTrue);

      final List<ActivityReminderItem> reminders =
          (await repository.listReminders(activityId: 'act-1002')).unwrap.items;
      expect(
        reminders.map((ActivityReminderItem reminder) => reminder.kind),
        <ActivityReminderKind>[
          ActivityReminderKind.registration,
          ActivityReminderKind.start,
        ],
      );
      expect(
        reminders.every(
          (ActivityReminderItem reminder) =>
              reminder.channel == ActivityReminderChannel.inapp &&
              reminder.status == ActivityReminderStatus.pending,
        ),
        isTrue,
      );
    });

    test('重复确认是幂等的，不会重复创建提醒', () async {
      final MockActivitiesRepository repository = repo();
      await repository.confirm('act-1002');
      final int first = (await repository.listReminders(
        activityId: 'act-1002',
      ))
          .unwrap
          .items
          .length;
      await repository.confirm('act-1002');
      final int second = (await repository.listReminders(
        activityId: 'act-1002',
      ))
          .unwrap
          .items
          .length;
      expect(second, first);
    });

    test('已忽略的活动不能再确认（409 CONFLICT）', () async {
      final MockActivitiesRepository repository = repo();
      await repository.dismiss('act-1002');
      final Result<ActivityItem> result = await repository.confirm('act-1002');
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
    });

    test('忽略候选活动后不创建提醒', () async {
      final MockActivitiesRepository repository = repo();
      final ActivityItem dismissed =
          (await repository.dismiss('act-1002')).unwrap;
      expect(dismissed.status, ActivityStatus.dismissed);
      expect(
        (await repository.listReminders(activityId: 'act-1002')).unwrap.items,
        isEmpty,
      );
    });

    test('归档活动不能确认', () async {
      final Result<ActivityItem> result = await repo().confirm('act-1005');
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
    });

    test('未确认的候选活动不能创建提醒', () async {
      final Result<ActivityReminderItem> result = await repo().createReminder(
        'act-1002',
        kind: ActivityReminderKind.custom,
        remindAt: now.add(const Duration(hours: 2)),
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.conflict);
    });
  });

  group('提醒', () {
    test('提醒列表跟随 limit / cursor 分页', () async {
      final MockActivitiesRepository repository = repo();
      await repository.confirm('act-1002');

      final Page<ActivityReminderItem> first =
          (await repository.listReminders(activityId: 'act-1002', limit: 1))
              .unwrap;
      expect(first.items, hasLength(1));
      expect(first.nextCursor, isNotNull);

      final Page<ActivityReminderItem> second = (await repository.listReminders(
        activityId: 'act-1002',
        limit: 1,
        cursor: first.nextCursor,
      ))
          .unwrap;
      expect(second.items, hasLength(1));
      expect(second.nextCursor, isNull);
      expect(second.items.single.id, isNot(first.items.single.id));
    });

    test('目标只剩 3 分钟时默认提醒落在目标时刻，而不是 now + 5', () async {
      final DateTime target = now.add(const Duration(minutes: 3));
      final MockActivitiesRepository repository = MockActivitiesRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => now,
        activities: <ActivityItem>[
          ActivityItem(
            id: 'act-short',
            source: ActivitySource.manual,
            kind: 'other',
            title: '马上开始的活动',
            startsAt: target,
            status: ActivityStatus.confirmed,
          ),
        ],
      );

      final List<ActivityReminderItem> reminders =
          (await repository.listReminders(activityId: 'act-short'))
              .unwrap
              .items;
      expect(reminders.single.remindAt, target);
      expect(reminders.single.remindAt.isAfter(target), isFalse);
    });

    test('微信订阅消息未接通 → 明确拒绝，而不是假装已排期', () async {
      final Result<ActivityReminderItem> result = await repo().createReminder(
        'act-1001',
        kind: ActivityReminderKind.custom,
        remindAt: now.add(const Duration(hours: 2)),
        channel: ActivityReminderChannel.wechatSubscribe,
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(result.errorOrNull?.message, contains('未接通'));
    });

    test('站内自定义提醒可创建、可删除（删除幂等）', () async {
      final MockActivitiesRepository repository = repo();
      final ActivityReminderItem created = (await repository.createReminder(
        'act-1001',
        kind: ActivityReminderKind.custom,
        remindAt: now.add(const Duration(hours: 2)),
      ))
          .unwrap;
      expect(created.status, ActivityReminderStatus.pending);
      expect(created.channel, ActivityReminderChannel.inapp);

      expect((await repository.deleteReminder(created.id)).isOk, isTrue);
      expect((await repository.deleteReminder(created.id)).isOk, isTrue);
      expect(
        (await repository.listReminders(activityId: 'act-1001'))
            .unwrap
            .items
            .where(
                (ActivityReminderItem reminder) => reminder.id == created.id),
        isEmpty,
      );
    });

    test('派发只把到期的站内提醒标为已发送', () async {
      DateTime clock = now;
      final MockActivitiesRepository repository = repo(clock: () => clock);
      await repository.confirm('act-1002'); // 截止提醒 = now+5min，开始 = now+23h

      clock = now.add(const Duration(minutes: 6));
      expect((await repository.dispatchReminders()).isOk, isTrue);

      final List<ActivityReminderItem> reminders =
          (await repository.listReminders(activityId: 'act-1002')).unwrap.items;
      final ActivityReminderItem registration = reminders.firstWhere(
        (ActivityReminderItem reminder) =>
            reminder.kind == ActivityReminderKind.registration,
      );
      final ActivityReminderItem start = reminders.firstWhere(
        (ActivityReminderItem reminder) =>
            reminder.kind == ActivityReminderKind.start,
      );
      expect(registration.status, ActivityReminderStatus.sent);
      expect(start.status, ActivityReminderStatus.pending);
    });
  });

  group('createManual', () {
    ActivityDraft draft() => ActivityDraft(
          title: '  计算生物学论坛  ',
          kind: 'lecture',
          startsAt: now.add(const Duration(days: 2)),
          endsAt: now.add(const Duration(days: 2, hours: 2)),
          location: '  生命学院 4-102 ',
          organizer: '生命学院',
          registrationUrl: 'https://example.edu/signup',
          evidenceText: '  海报摘录：11 月 24 日 19:00。 ',
        );

    test('合法草稿 → candidate / manual，字段被规范化', () async {
      final MockActivitiesRepository repository = repo();
      final ActivityItem created =
          (await repository.createManual(draft())).unwrap;

      expect(created.source, ActivitySource.manual);
      expect(created.status, ActivityStatus.candidate);
      expect(created.title, '计算生物学论坛');
      expect(created.location, '生命学院 4-102');
      expect(created.evidenceText, '海报摘录：11 月 24 日 19:00。');
      expect(created.startsAt, now.add(const Duration(days: 2)));
      expect(repository.debugLength, 6);
      expect(repository.debugById(created.id), created);
    });

    test('非法草稿 → VALIDATION_FAILED，且不写入', () async {
      final MockActivitiesRepository repository = repo();
      final Result<ActivityItem> result = await repository.createManual(
        ActivityDraft(
          title: ' ',
          startsAt: null,
          evidenceText: List<String>.filled(201, '证').join(),
        ),
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(result.errorOrNull?.message, contains('活动名称'));
      expect(repository.debugLength, 5);
    });
  });

  group('微信单篇导入', () {
    test('只有链接：source=wechat-mp、candidate、不编造时间', () async {
      final ActivityItem created = (await repo().importWechat(
        const WechatImportDraft(url: 'https://mp.weixin.qq.com/s/demo'),
      ))
          .unwrap;

      expect(created.source, ActivitySource.wechatMp);
      expect(created.status, ActivityStatus.candidate);
      expect(created.sourceUrl, 'https://mp.weixin.qq.com/s/demo');
      expect(created.startsAt, isNull);
      expect(created.registrationDeadlineAt, isNull);
      expect(created.evidenceText, isNull);
      expect(created.title, contains('公众号'));
    });

    test('粘贴正文：标题取首个非空行，证据截断到 200 字', () async {
      final String text = List<String>.filled(260, '文').join();
      final ActivityItem created = (await repo().importWechat(
        WechatImportDraft(text: '社团招新路演\n$text'),
      ))
          .unwrap;

      expect(created.title, '社团招新路演');
      expect(created.evidenceText, isNotNull);
      expect(created.evidenceText!.runes.length, activityEvidenceMaxChars);
      expect(created.startsAt, isNull);
    });

    test('链接与正文都为空 → 校验失败', () async {
      final Result<ActivityItem> result =
          await repo().importWechat(const WechatImportDraft());
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
    });

    test('链接与正文同时提供 → 校验失败（只能单篇二选一）', () async {
      final Result<ActivityItem> result = await repo().importWechat(
        const WechatImportDraft(
          url: 'https://mp.weixin.qq.com/s/demo',
          text: '活动正文摘录',
        ),
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(result.errorOrNull?.message, contains('只能填一个'));
    });
  });

  group('邮件提升', () {
    test('已知邮件事件 → campus-mail 候选活动', () async {
      final ActivityItem created =
          (await repo().promoteMail('mail-1001')).unwrap;
      expect(created.source, ActivitySource.campusMail);
      expect(created.status, ActivityStatus.candidate);
      expect(created.sourceLabel, contains('校园邮箱'));
      expect(created.evidenceText, isNull);
    });

    test('未知邮件事件 → NOT_FOUND', () async {
      final Result<ActivityItem> result = await repo().promoteMail('mail-x');
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.notFound);
    });
  });

  group('patch', () {
    test('可改内容字段', () async {
      final ActivityItem patched = (await repo().patch(
        'act-1002',
        <String, Object?>{'title': '改过的标题', 'location': '新地点'},
      ))
          .unwrap;
      expect(patched.title, '改过的标题');
      expect(patched.location, '新地点');
      expect(patched.status, ActivityStatus.candidate);
    });

    test('状态只能走 confirm / dismiss，不允许 PATCH 改', () async {
      final Result<ActivityItem> result = await repo().patch(
        'act-1002',
        <String, Object?>{'status': 'confirmed'},
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
    });
  });
}
