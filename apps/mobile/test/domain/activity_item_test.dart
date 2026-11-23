import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/activity.dart';

String _repeat(String value, int times) =>
    List<String>.filled(times, value).join();

Map<String, Object?> _json({
  String id = 'act-1',
  String source = 'campus-mail',
  String kind = 'lecture',
  String title = '人工智能与教育创新论坛',
  Object? startsAt = '2026-11-25T02:00:00.000Z',
  Object? endsAt = '2026-11-25T04:00:00.000Z',
  Object? location = '信息学院 1-101',
  Object? organizer = '信息学院',
  Object? registrationDeadlineAt = '2026-11-24T02:00:00.000Z',
  Object? registrationDeadlineRaw,
  Object? registrationUrl = 'https://example.edu/activities/act-1',
  Object? evidenceText = '公众号推文摘录：11 月 25 日上午十点，信息学院 1-101。',
  Object? confidence = 0.82,
  String status = 'candidate',
  Object? sourceUrl = 'https://mp.weixin.qq.com/s/demo',
  Object? sourceLabel = '上科大信息学院',
  Object? publishedAt = '2026-11-20T01:00:00.000Z',
  Object? stale = false,
}) =>
    <String, Object?>{
      'id': id,
      'source': source,
      'kind': kind,
      'title': title,
      'startsAt': startsAt,
      'endsAt': endsAt,
      'location': location,
      'organizer': organizer,
      'registrationDeadlineAt': registrationDeadlineAt,
      'registrationDeadlineRaw': registrationDeadlineRaw,
      'registrationUrl': registrationUrl,
      'evidenceText': evidenceText,
      'confidence': confidence,
      'status': status,
      'sourceUrl': sourceUrl,
      'sourceLabel': sourceLabel,
      'publishedAt': publishedAt,
      'stale': stale,
    };

void main() {
  group('ActivityItem.fromJson', () {
    test('解析共同契约字段并统一转成 UTC', () {
      final ActivityItem item = ActivityItem.fromJson(_json());

      expect(item.id, 'act-1');
      expect(item.source, ActivitySource.campusMail);
      expect(item.kind, 'lecture');
      expect(item.title, '人工智能与教育创新论坛');
      expect(item.startsAt, DateTime.utc(2026, 11, 25, 2));
      expect(item.endsAt, DateTime.utc(2026, 11, 25, 4));
      expect(item.location, '信息学院 1-101');
      expect(item.organizer, '信息学院');
      expect(item.registrationDeadlineAt, DateTime.utc(2026, 11, 24, 2));
      expect(item.registrationDeadlineRaw, isNull);
      expect(item.registrationUrl, 'https://example.edu/activities/act-1');
      expect(item.evidenceText, contains('11 月 25 日'));
      expect(item.confidence, closeTo(0.82, 1e-9));
      expect(item.status, ActivityStatus.candidate);
      expect(item.sourceUrl, 'https://mp.weixin.qq.com/s/demo');
      expect(item.sourceLabel, '上科大信息学院');
      expect(item.publishedAt, DateTime.utc(2026, 11, 20, 1));
      expect(item.stale, isFalse);
    });

    test('未知来源 / 状态直接拒绝，不静默降级', () {
      expect(
        () => ActivityItem.fromJson(_json(source: 'rss')),
        throwsFormatException,
      );
      expect(
        () => ActivityItem.fromJson(_json(status: 'pending')),
        throwsFormatException,
      );
    });

    test('没有可确定时刻时保留原文，不擅自补 23:59', () {
      final ActivityItem item = ActivityItem.fromJson(
        _json(
          startsAt: null,
          endsAt: null,
          registrationDeadlineAt: null,
          registrationDeadlineRaw: '11 月 30 日闭馆前（原文如此）',
        ),
      );

      expect(item.startsAt, isNull);
      expect(item.registrationDeadlineAt, isNull);
      expect(item.registrationDeadlineRaw, '11 月 30 日闭馆前（原文如此）');
      expect(item.registrationDeadlineIsUncertain, isTrue);
      expect(item.registrationDeadlineLabel, contains('11 月 30 日闭馆前'));
      expect(item.registrationDeadlineLabel, isNot(contains('23:59')));
      expect(item.timeRangeLabel, contains('时间待确认'));
    });

    test('date-only 时间字段不补午夜：按“没有可确定时刻”处理', () {
      final ActivityItem item = ActivityItem.fromJson(
        _json(
          startsAt: '2026-11-25',
          endsAt: '2026-11-25',
          registrationDeadlineAt: '2026-11-30',
          registrationDeadlineRaw: '11 月 30 日闭馆前',
          publishedAt: '2026-11-20',
        ),
      );

      expect(item.startsAt, isNull);
      expect(item.endsAt, isNull);
      expect(item.registrationDeadlineAt, isNull);
      expect(item.registrationDeadlineRaw, '11 月 30 日闭馆前');
      expect(item.publishedAt, isNull);
      expect(item.timeRangeLabel, contains('时间待确认'));
      expect(item.timeRangeLabel, isNot(contains('00:00')));
    });

    test('没有时区的墙钟时间也拒绝，避免本机时区漂移', () {
      final ActivityItem item = ActivityItem.fromJson(
        _json(startsAt: '2026-11-25T10:00:00'),
      );
      expect(item.startsAt, isNull);
    });

    test('证据片段最多保留 200 字', () {
      final ActivityItem item = ActivityItem.fromJson(
        _json(evidenceText: _repeat('活', 250)),
      );
      expect(item.evidenceText, isNotNull);
      expect(item.evidenceText!.runes.length, activityEvidenceMaxChars);
    });

    test('candidate 不能排提醒，confirmed 才可以', () {
      final ActivityItem candidate = ActivityItem.fromJson(_json());
      final ActivityItem confirmed =
          ActivityItem.fromJson(_json(status: 'confirmed'));

      expect(candidate.isPending, isTrue);
      expect(candidate.canScheduleReminders, isFalse);
      expect(confirmed.isPending, isFalse);
      expect(confirmed.canScheduleReminders, isTrue);
    });

    test('时间标签按 Asia/Shanghai 展示，并标明北京时间', () {
      final ActivityItem item = ActivityItem.fromJson(_json());
      expect(item.startsAtLabel, '2026-11-25 10:00');
      expect(item.timeRangeLabel, contains('2026-11-25 10:00'));
      expect(item.timeRangeLabel, contains('12:00'));
      expect(item.registrationDeadlineLabel, contains('2026-11-24 10:00'));
    });

    test('空字符串字段归一为 null（不在 UI 里显示空行）', () {
      final ActivityItem item = ActivityItem.fromJson(
        _json(location: '  ', organizer: '', sourceLabel: '   '),
      );
      expect(item.location, isNull);
      expect(item.organizer, isNull);
      expect(item.sourceLabel, isNull);
    });
  });

  group('ActivityReminderItem.fromJson', () {
    test('解析共同契约五个字段', () {
      final ActivityReminderItem reminder =
          ActivityReminderItem.fromJson(<String, Object?>{
        'id': 'rem-1',
        'kind': 'registration',
        'remindAt': '2026-11-24T02:00:00.000Z',
        'channel': 'inapp',
        'status': 'scheduled',
      });

      expect(reminder.id, 'rem-1');
      expect(reminder.kind, ActivityReminderKind.registration);
      expect(reminder.remindAt, DateTime.utc(2026, 11, 24, 2));
      expect(reminder.channel, ActivityReminderChannel.inapp);
      expect(reminder.status, ActivityReminderStatus.pending);
    });

    test('未知状态不炸，显示为“状态未知”', () {
      final ActivityReminderItem reminder =
          ActivityReminderItem.fromJson(<String, Object?>{
        'id': 'rem-1',
        'kind': 'custom',
        'remindAt': '2026-11-24T02:00:00.000Z',
        'channel': 'inapp',
        'status': 'some-future-value',
      });
      expect(reminder.status, ActivityReminderStatus.unknown);
      expect(reminder.status.label, contains('未知'));
    });

    test('channel 只接受共同契约的两个取值', () {
      expect(
        () => ActivityReminderItem.fromJson(<String, Object?>{
          'id': 'rem-1',
          'kind': 'start',
          'remindAt': '2026-11-24T02:00:00.000Z',
          'channel': 'sms',
          'status': 'scheduled',
        }),
        throwsFormatException,
      );
    });

    test('remindAt 是必填时刻：date-only 直接拒绝，不补午夜', () {
      expect(
        () => ActivityReminderItem.fromJson(<String, Object?>{
          'id': 'rem-1',
          'kind': 'custom',
          'remindAt': '2026-11-24',
          'channel': 'inapp',
          'status': 'pending',
        }),
        throwsFormatException,
      );
    });

    test('微信订阅消息如实标注“未接通”', () {
      final ActivityReminderItem reminder =
          ActivityReminderItem.fromJson(<String, Object?>{
        'id': 'rem-1',
        'kind': 'start',
        'remindAt': '2026-11-24T02:00:00.000Z',
        'channel': 'wechat-subscribe',
        'status': 'scheduled',
      });
      expect(reminder.channel, ActivityReminderChannel.wechatSubscribe);
      expect(reminder.channel.label, contains('未接通'));
    });
  });

  group('ActivityDraft 校验', () {
    ActivityDraft validDraft() => ActivityDraft(
          title: '  计算生物学论坛  ',
          kind: 'lecture',
          startsAt: DateTime.utc(2026, 11, 25, 11),
          endsAt: DateTime.utc(2026, 11, 25, 13),
          location: '  生命学院 4-102 ',
          organizer: '生命学院',
          registrationDeadlineAt: DateTime.utc(2026, 11, 24, 2),
          registrationUrl: 'https://example.edu/signup',
          evidenceText: '  海报摘录：11 月 25 日 19:00，生命学院 4-102。 ',
        );

    test('合法草稿没有校验问题', () {
      expect(validateActivityDraft(validDraft()), isEmpty);
    });

    test('空标题 / 结束早于开始都给出具体问题', () {
      final List<ActivityDraftProblem> problems = validateActivityDraft(
        ActivityDraft(
          title: ' ',
          startsAt: null,
          endsAt: DateTime.utc(2026, 11, 25, 1),
        ),
      );
      expect(problems, contains(ActivityDraftProblem.titleTooShort));
      expect(problems, contains(ActivityDraftProblem.endBeforeStart));
    });

    test('kind 必须是契约枚举之一', () {
      final ActivityDraft draft = ActivityDraft(
        title: '活动',
        kind: 'campus-event',
        startsAt: DateTime.utc(2026, 11, 25, 11),
      );
      expect(
        validateActivityDraft(draft),
        contains(ActivityDraftProblem.invalidKind),
      );
    });

    test('只接受 http(s) 链接', () {
      final ActivityDraft draft = ActivityDraft(
        title: '活动',
        startsAt: DateTime.utc(2026, 11, 25, 11),
        registrationUrl: 'javascript:alert(1)',
      );
      expect(
        validateActivityDraft(draft),
        contains(ActivityDraftProblem.invalidUrl),
      );
    });

    test('证据超过 200 字是校验错误（而不是悄悄上传全文）', () {
      final ActivityDraft draft = ActivityDraft(
        title: '活动',
        startsAt: DateTime.utc(2026, 11, 25, 11),
        evidenceText: _repeat('证', activityEvidenceMaxChars + 1),
      );
      expect(
        validateActivityDraft(draft),
        contains(ActivityDraftProblem.evidenceTooLong),
      );
    });

    test('toJson 用 UTC ISO，不携带 source/正文/附件字段', () {
      final Map<String, Object?> json = validDraft().toJson();

      // OpenAPI `ActivityCreate` 明确禁止客户端指定 source / status / confidence。
      expect(json.containsKey('source'), isFalse);
      expect(json.containsKey('status'), isFalse);
      expect(json.containsKey('confidence'), isFalse);
      expect(json['title'], '计算生物学论坛');
      expect(json['startsAt'], '2026-11-25T11:00:00.000Z');
      expect(json['registrationDeadlineAt'], '2026-11-24T02:00:00.000Z');
      expect(json['evidenceText'], contains('海报摘录'));
      expect(json.containsKey('body'), isFalse);
      expect(json.containsKey('attachments'), isFalse);
      expect(json.containsKey('html'), isFalse);
    });

    test('证据在写回时也会截断到 200 字', () {
      final ActivityDraft draft = ActivityDraft(
        title: '活动',
        startsAt: DateTime.utc(2026, 11, 25, 11),
        evidenceText: _repeat('证', 260),
      );
      final Object? evidence = draft.toJson()['evidenceText'];
      expect(evidence, isA<String>());
      expect((evidence! as String).runes.length, activityEvidenceMaxChars);
    });
  });

  group('WechatImportDraft 校验', () {
    test('链接与正文至少提供一个', () {
      expect(
        validateWechatImportDraft(const WechatImportDraft()),
        contains(WechatImportProblem.empty),
      );
      expect(
        validateWechatImportDraft(
          const WechatImportDraft(url: 'https://mp.weixin.qq.com/s/demo'),
        ),
        isEmpty,
      );
      expect(
        validateWechatImportDraft(const WechatImportDraft(text: '活动正文摘录')),
        isEmpty,
      );
    });

    test('链接必须是 http(s)', () {
      expect(
        validateWechatImportDraft(
          const WechatImportDraft(url: 'weixin://article/1'),
        ),
        contains(WechatImportProblem.invalidUrl),
      );
    });

    test('链接与正文只能二选一（单篇导入）', () {
      expect(
        validateWechatImportDraft(
          const WechatImportDraft(
            url: 'https://mp.weixin.qq.com/s/demo',
            text: '活动正文摘录',
          ),
        ),
        contains(WechatImportProblem.bothProvided),
      );
    });

    test('请求可带全文供服务端抽取，但落库证据截断到 200 字', () {
      final WechatImportDraft draft =
          WechatImportDraft(text: _repeat('文', 260));
      final String sent = draft.toJson()['text']! as String;
      expect(sent.runes.length, 260);
      expect(draft.evidenceText, isNotNull);
      expect(draft.evidenceText!.runes.length, activityEvidenceMaxChars);
      expect(draft.toJson().containsKey('html'), isFalse);
      expect(draft.toJson().containsKey('content'), isFalse);
    });
  });

  group('filterActivities', () {
    List<ActivityItem> items() => <ActivityItem>[
          ActivityItem.fromJson(_json(id: 'mail-candidate')),
          ActivityItem.fromJson(
            _json(
                id: 'wechat-confirmed',
                source: 'wechat-mp',
                status: 'confirmed'),
          ),
          ActivityItem.fromJson(
            _json(
                id: 'manual-dismissed', source: 'manual', status: 'dismissed'),
          ),
        ];

    test('按来源筛选', () {
      final List<ActivityItem> filtered = filterActivities(
        items(),
        const ActivityFilter(source: ActivitySource.wechatMp),
      );
      expect(filtered.map((ActivityItem item) => item.id), <String>[
        'wechat-confirmed',
      ]);
    });

    test('来源与状态是叠加条件', () {
      final List<ActivityItem> filtered = filterActivities(
        items(),
        const ActivityFilter(
          source: ActivitySource.campusMail,
          status: ActivityStatus.confirmed,
        ),
      );
      expect(filtered, isEmpty);
    });

    test('不设条件时原样返回（顺序不变）', () {
      final List<ActivityItem> all = items();
      expect(
        filterActivities(all, const ActivityFilter())
            .map((ActivityItem item) => item.id)
            .toList(),
        all.map((ActivityItem item) => item.id).toList(),
      );
    });
  });
}
