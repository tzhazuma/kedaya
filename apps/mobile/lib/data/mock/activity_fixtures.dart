import '../../domain/models/activity.dart';

/// 演示数据：**相对 `now` 生成**，因此不会过几天就全变成“已结束”。
///
/// 五条覆盖三种来源与四种状态，其中 `act-1003` 刻意只有报名截止原文
/// （没有可确定 instant），用来守住“不擅自补 23:59”。
List<ActivityItem> buildMockActivities(DateTime now) {
  final DateTime utc = now.toUtc();
  return <ActivityItem>[
    ActivityItem(
      id: 'act-1001',
      source: ActivitySource.wechatMp,
      kind: 'lecture',
      title: '人工智能与教育创新论坛',
      startsAt: utc.add(const Duration(hours: 26)),
      endsAt: utc.add(const Duration(hours: 28)),
      location: '信息学院 1-101',
      organizer: '信息学院',
      registrationDeadlineAt: utc.add(const Duration(hours: 2)),
      registrationUrl: 'https://example.edu/activities/act-1001',
      evidenceText: '公众号推文摘录：11 月 23 日上午十点，信息学院 1-101，需提前报名。',
      confidence: 0.82,
      status: ActivityStatus.confirmed,
      sourceUrl: 'https://mp.weixin.qq.com/s/demo-act-1001',
      sourceLabel: '上科大信息学院',
      publishedAt: utc.subtract(const Duration(days: 1)),
    ),
    ActivityItem(
      id: 'act-1002',
      source: ActivitySource.campusMail,
      kind: 'lecture',
      title: '校园讲座：可信 AI 的边界',
      startsAt: utc.add(const Duration(hours: 24)),
      endsAt: utc.add(const Duration(hours: 26)),
      location: '图书馆 302 报告厅',
      organizer: '计算与智能实验室',
      registrationDeadlineAt: utc.add(const Duration(hours: 12)),
      registrationUrl: 'https://example.edu/activities/act-1002',
      evidenceText: '邮件摘录：11 月 23 日 18:30，图书馆 302，扫码报名。',
      confidence: 0.74,
      status: ActivityStatus.candidate,
      sourceLabel: '校园邮箱',
      publishedAt: utc.subtract(const Duration(hours: 5)),
    ),
    ActivityItem(
      id: 'act-1003',
      source: ActivitySource.wechatMp,
      kind: 'club',
      title: '社团招新路演',
      location: '图书馆前广场',
      organizer: '社团联合会',
      registrationDeadlineRaw: '报名截止：11 月 30 日闭馆前（原文未写具体时刻）',
      evidenceText: '公众号推文摘录：本周五 18:30，图书馆前广场，现场可咨询。',
      confidence: 0.61,
      status: ActivityStatus.candidate,
      sourceUrl: 'https://mp.weixin.qq.com/s/demo-act-1003',
      sourceLabel: '上科大社团联合会',
      publishedAt: utc.subtract(const Duration(days: 2)),
      stale: true,
    ),
    ActivityItem(
      id: 'act-1004',
      source: ActivitySource.manual,
      kind: 'other',
      title: '旧书交换市集',
      startsAt: utc.subtract(const Duration(days: 2)),
      endsAt:
          utc.subtract(const Duration(days: 2)).add(const Duration(hours: 3)),
      location: '学生中心一层',
      organizer: '我',
      confidence: 1,
      status: ActivityStatus.dismissed,
      publishedAt: utc.subtract(const Duration(days: 3)),
    ),
    ActivityItem(
      id: 'act-1005',
      source: ActivitySource.campusMail,
      kind: 'other',
      title: '毕业季跳蚤市场',
      startsAt: utc.subtract(const Duration(days: 5)),
      endsAt:
          utc.subtract(const Duration(days: 5)).add(const Duration(hours: 4)),
      location: '体育馆东侧',
      organizer: '学生会',
      confidence: 0.8,
      status: ActivityStatus.archived,
      sourceLabel: '校园邮箱',
      publishedAt: utc.subtract(const Duration(days: 6)),
    ),
  ];
}
