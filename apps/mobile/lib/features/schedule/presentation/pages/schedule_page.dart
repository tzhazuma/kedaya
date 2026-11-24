import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/course_session.dart';
import '../../../../domain/models/exam_entry.dart';
import '../../../../domain/models/ics_export.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/schedule_ics.dart';
import '../../application/schedule_providers.dart';
import '../components/course_session_card.dart';

/// 建议路由（在 `lib/app/app_router.dart` 注册后生效）。
const String scheduleRoutePath = '/schedule';

/// 课表（`schedule`）。
///
/// 两个 tab：
/// - **今天**：只显示今天（注入的 `now` 所在星期）的课，按开始时间排序，
///   正在上的那节高亮并标「进行中」；
/// - **本周**：周一到周日**纵向分组**（手机宽度下不做 7 列横向网格，
///   避免横向溢出），每门课都有时间与地点。
///
/// 页面只读：不写入 DDL，也不生成提醒。
class SchedulePage extends ConsumerStatefulWidget {
  const SchedulePage({super.key});

  @override
  ConsumerState<SchedulePage> createState() => _SchedulePageState();
}

class _SchedulePageState extends ConsumerState<SchedulePage> {
  /// 每 30 秒重画一次，让「进行中」在页面停留时也能自己切换。
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 30), (Timer timer) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // 每次 build 都从注入的时钟取「现在」：测试 override 后完全确定。
    final DateTime now = ref.watch(scheduleClockProvider)();
    final AsyncValue<List<CourseSession>> value =
        ref.watch(weekScheduleProvider);
    final WeekScheduleController controller =
        ref.read(weekScheduleProvider.notifier);

    return DefaultTabController(
      length: 3,
      child: KedaYaPageScaffold(
        title: '课表',
        // TabBarView 自己带列表内边距；外壳不再额外加一圈，避免双重留白。
        padding: EdgeInsets.zero,
        actions: <Widget>[
          IconButton(
            tooltip: '添加课程',
            onPressed: () => context.push('/schedule/new'),
            icon: const Icon(Icons.add),
          ),
          IconButton(
            tooltip: '导出日历 (ICS)',
            onPressed: () async {
              final String ics = buildIcs(
                buildScheduleIcsEvents(
                  sessions: value.valueOrNull ?? const <CourseSession>[],
                  exams: ref.read(examsProvider),
                  now: now,
                ),
              );
              await ref.read(shareProvider).copyToClipboard(ics);
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('已复制 ICS 到剪贴板，可粘贴保存为 .ics 后导入日历')),
              );
            },
            icon: const Icon(Icons.event_available_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
        bottom: const TabBar(
          tabs: <Tab>[
            Tab(text: '今天'),
            Tab(text: '本周'),
            Tab(text: '考试'),
          ],
        ),
        child: Column(
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                0,
              ),
              child: ScheduleNotice(),
            ),
            Expanded(
              child: TabBarView(
                children: <Widget>[
                  _TodayTab(
                    value: value,
                    now: now,
                    onRefresh: controller.refresh,
                    onDelete: (CourseSession session) =>
                        _confirmDelete(context, controller, session),
                  ),
                  _WeekTab(
                    value: value,
                    now: now,
                    onRefresh: controller.refresh,
                    onDelete: (CourseSession session) =>
                        _confirmDelete(context, controller, session),
                  ),
                  _ExamsTab(exams: ref.watch(examsProvider), now: now),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 页首说明：演示数据 + 与 DDL 的边界。
Future<void> _confirmDelete(
  BuildContext context,
  WeekScheduleController controller,
  CourseSession session,
) async {
  final bool? confirmed = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      title: const Text('删除这门课？'),
      content: Text('${session.courseName} · ${session.weekday.label} '
          '${session.timeRangeLabel}'),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('删除'),
        ),
      ],
    ),
  );
  if (confirmed ?? false) {
    await controller.removeCourse(session.id);
  }
}

class ScheduleNotice extends StatelessWidget {
  const ScheduleNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.calendar_view_week_outlined,
                size: 18,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  '演示课表，真实课表需接入教务',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '这份课表来自本机演示数据，按周重复；接入教务系统后会替换成真实课程。'
            '课表只显示上课时间与地点，不写入 DDL，也不生成提醒。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

/// 「今天」：今天（`now` 所在星期）的课，按开始时间升序。
class _TodayTab extends StatelessWidget {
  const _TodayTab({
    required this.value,
    required this.now,
    required this.onRefresh,
    required this.onDelete,
  });

  final AsyncValue<List<CourseSession>> value;
  final DateTime now;
  final Future<void> Function() onRefresh;
  final Future<void> Function(CourseSession session) onDelete;

  @override
  Widget build(BuildContext context) {
    final CourseWeekday weekday = CourseWeekday.fromDateTime(now);
    final AsyncValue<List<CourseSession>> today =
        value.whenData((List<CourseSession> sessions) {
      return sessionsOn(sessions, weekday);
    });

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: AsyncStateView<List<CourseSession>>(
        value: today,
        isEmpty: (List<CourseSession> items) => items.isEmpty,
        emptyTitle: '今天没有课',
        emptyDescription: '演示课表，真实课表需接入教务。'
            '${weekday.label}这份演示数据里没有排课，可以去自习或休息。',
        loadingMessage: '正在翻课表…',
        onRetry: onRefresh,
        builder: (BuildContext context, List<CourseSession> items) =>
            ListView.separated(
          key: const Key('schedule-today-list'),
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          itemCount: items.length,
          separatorBuilder: (BuildContext context, int index) =>
              const SizedBox(height: KedaYaTokens.space3),
          itemBuilder: (BuildContext context, int index) {
            final CourseSession session = items[index];
            return GestureDetector(
              onLongPress: () => onDelete(session),
              child: CourseSessionCard(
                key: ValueKey<String>('schedule-today-${session.id}'),
                session: session,
                now: now,
              ),
            );
          },
        ),
      ),
    );
  }
}

/// 「本周」：周一到周日**纵向**分组（无课的那天也保留一行，说明是空的）。
class _WeekTab extends StatelessWidget {
  const _WeekTab({
    required this.value,
    required this.now,
    required this.onRefresh,
    required this.onDelete,
  });

  final AsyncValue<List<CourseSession>> value;
  final DateTime now;
  final Future<void> Function() onRefresh;
  final Future<void> Function(CourseSession session) onDelete;

  @override
  Widget build(BuildContext context) {
    final CourseWeekday today = CourseWeekday.fromDateTime(now);
    final List<DateTime> dates = weekDatesFor(now);

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: AsyncStateView<List<CourseSession>>(
        value: value,
        isEmpty: (List<CourseSession> items) => items.isEmpty,
        emptyTitle: '本周还没有课程',
        emptyDescription: '演示课表，真实课表需接入教务。'
            '接入教务系统后，这里会按周一到周日列出真实课程。',
        loadingMessage: '正在整理这一周…',
        onRetry: onRefresh,
        builder: (BuildContext context, List<CourseSession> items) {
          final Map<CourseWeekday, List<CourseSession>> groups =
              groupSessionsByWeekday(items);
          return ListView(
            key: const Key('schedule-week-list'),
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              KedaYaTokens.space6,
            ),
            children: <Widget>[
              for (final CourseWeekday weekday in CourseWeekday.values) ...[
                _WeekdayHeader(
                  weekday: weekday,
                  date: dates[weekday.index],
                  isToday: weekday == today,
                  courseCount: groups[weekday]!.length,
                ),
                const SizedBox(height: KedaYaTokens.space2),
                if (groups[weekday]!.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(
                      left: KedaYaTokens.space1,
                      bottom: KedaYaTokens.space2,
                    ),
                    child: Text(
                      '无课',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        color: context.kedayaColors.textMuted,
                      ),
                    ),
                  )
                else
                  for (final CourseSession session in groups[weekday]!)
                    Padding(
                      padding: const EdgeInsets.only(
                        bottom: KedaYaTokens.space2,
                      ),
                      child: GestureDetector(
                        onLongPress: () => onDelete(session),
                        child: CourseSessionCard(
                          key: ValueKey<String>(
                            'schedule-week-${session.id}',
                          ),
                          session: session,
                          now: now,
                          dense: true,
                        ),
                      ),
                    ),
                const SizedBox(height: KedaYaTokens.space3),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// 一天的小标题：「周二 · 11月24日 · 今天 · 2 门课」。
class _WeekdayHeader extends StatelessWidget {
  const _WeekdayHeader({
    required this.weekday,
    required this.date,
    required this.isToday,
    required this.courseCount,
  });

  final CourseWeekday weekday;
  final DateTime date;
  final bool isToday;
  final int courseCount;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      children: <Widget>[
        Text(
          weekday.label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(width: KedaYaTokens.space2),
        Text(
          '${date.month}月${date.day}日',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        if (isToday) ...<Widget>[
          const SizedBox(width: KedaYaTokens.space1),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: KedaYaTokens.space1,
              vertical: 1,
            ),
            decoration: BoxDecoration(
              color: colors.brandSoft,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
            ),
            child: Text(
              '今天',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                fontWeight: KedaYaTokens.fontWeightMedium,
                color: colors.brandStrong,
              ),
            ),
          ),
        ],
        const Spacer(),
        if (courseCount > 0)
          Text(
            '$courseCount 门课',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
      ],
    );
  }
}

/// 考试 tab：按开考时间升序，显示倒计时与考场信息。
class _ExamsTab extends StatelessWidget {
  const _ExamsTab({required this.exams, required this.now});

  final List<ExamEntry> exams;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (exams.isEmpty) {
      return Center(
        child: Text(
          '暂无考试安排（演示数据，真实考场需接入教务）',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            color: colors.textMuted,
          ),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      itemCount: exams.length + 1,
      separatorBuilder: (_, __) => const SizedBox(height: KedaYaTokens.space3),
      itemBuilder: (BuildContext context, int index) {
        if (index == 0) {
          return Text(
            '演示考试安排 · 导出 ICS 可导入系统日历',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          );
        }
        final ExamEntry exam = exams[index - 1];
        final int days = daysUntilExam(exam, now);
        final String countdown = days > 0
            ? '还有 $days 天'
            : days == 0
                ? '今天'
                : '已结束';
        return Container(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      exam.courseName,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: days <= 3 && days >= 0
                          ? colors.danger.withValues(alpha: 0.12)
                          : colors.brandSoft,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      countdown,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        color: days <= 3 && days >= 0
                            ? colors.danger
                            : colors.brandStrong,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '${exam.startsAt.month} 月 ${exam.startsAt.day} 日 '
                '${exam.startsAt.hour.toString().padLeft(2, '0')}:'
                '${exam.startsAt.minute.toString().padLeft(2, '0')}'
                ' · ${exam.durationMinutes} 分钟',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${exam.location}'
                '${exam.seat == null ? '' : ' · 座位 ${exam.seat}'}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
              if ((exam.note ?? '').trim().isNotEmpty) ...<Widget>[
                const SizedBox(height: 2),
                Text(
                  exam.note!,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
