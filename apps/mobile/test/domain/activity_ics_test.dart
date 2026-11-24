import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/models/activity_ics.dart';
import 'package:kedaya/domain/models/ics_export.dart';

void main() {
  ActivityItem activity({
    String id = 'act-1',
    String title = '校园马拉松',
    ActivityStatus status = ActivityStatus.confirmed,
    DateTime? startsAt,
    DateTime? endsAt,
    String? location,
    String? evidenceText,
    String? sourceUrl,
  }) =>
      ActivityItem(
        id: id,
        source: ActivitySource.wechatMp,
        kind: 'other',
        title: title,
        status: status,
        startsAt: startsAt,
        endsAt: endsAt,
        location: location,
        evidenceText: evidenceText,
        sourceUrl: sourceUrl,
      );

  group('buildActivityIcsEvents', () {
    test('没有开始时间的活动不导出', () {
      expect(buildActivityIcsEvents(<ActivityItem>[activity()]), isEmpty);
    });

    test('有开始无结束时用默认 2 小时', () {
      final DateTime start = DateTime.utc(2026, 11, 30, 10);
      final List<IcsEvent> events =
          buildActivityIcsEvents(<ActivityItem>[activity(startsAt: start)]);

      expect(events, hasLength(1));
      expect(events.single.startUtc, start);
      expect(events.single.endUtc, start.add(const Duration(hours: 2)));
    });

    test('结束早于开始时退回默认时长，不产出反向事件', () {
      final DateTime start = DateTime.utc(2026, 11, 30, 10);
      final List<IcsEvent> events = buildActivityIcsEvents(<ActivityItem>[
        activity(
          startsAt: start,
          endsAt: start.subtract(const Duration(hours: 1)),
        ),
      ]);
      expect(events.single.endUtc.isAfter(events.single.startUtc), isTrue);
    });

    test('UID 绑定活动 id，重复导出是同一个事件', () {
      final DateTime start = DateTime.utc(2026, 11, 30, 10);
      final List<IcsEvent> first =
          buildActivityIcsEvents(<ActivityItem>[activity(startsAt: start)]);
      final List<IcsEvent> second = buildActivityIcsEvents(
        <ActivityItem>[activity(startsAt: start, title: '改了标题')],
      );
      expect(first.single.uid, second.single.uid);
    });

    test('描述只带证据与来源链接，并标出待确认', () {
      final DateTime start = DateTime.utc(2026, 11, 30, 10);
      final List<IcsEvent> events = buildActivityIcsEvents(<ActivityItem>[
        activity(
          startsAt: start,
          status: ActivityStatus.candidate,
          evidenceText: '11 月 30 日开跑',
          sourceUrl: 'https://mp.weixin.qq.com/s/x',
        ),
      ]);
      final String description = events.single.description!;
      expect(description, contains('11 月 30 日开跑'));
      expect(description, contains('https://mp.weixin.qq.com/s/x'));
      expect(description, contains('待确认'));
    });

    test('已确认的活动不带待确认字样', () {
      final List<IcsEvent> events = buildActivityIcsEvents(<ActivityItem>[
        activity(startsAt: DateTime.utc(2026, 11, 30, 10)),
      ]);
      expect(events.single.description, isNull);
    });

    test('生成的 ICS 是合法日历：CRLF、UTF-8 文本转义、可被解析', () {
      final String ics = buildIcs(
        buildActivityIcsEvents(<ActivityItem>[
          activity(
            title: '讲座: 大模型, 程序分析',
            startsAt: DateTime.utc(2026, 11, 27, 10, 30),
            location: '信息学院 1 号楼, 报告厅',
          ),
        ]),
        generatedAt: DateTime.utc(2026, 11, 24),
      );

      expect(ics.startsWith('BEGIN:VCALENDAR\r\n'), isTrue);
      expect(ics.endsWith('END:VCALENDAR\r\n'), isTrue);
      expect(ics, contains('SUMMARY:讲座: 大模型\\, 程序分析'));
      expect(ics, contains('LOCATION:信息学院 1 号楼\\, 报告厅'));
      expect(ics, contains('DTSTART:20261127T103000Z'));
      expect(ics, contains('DTEND:20261127T123000Z'));
      // 没有出现裸 \n（所有行都以 CRLF 结束）
      expect(ics.split('\r\n').every((String line) => !line.contains('\n')), isTrue);
    });
  });
}
