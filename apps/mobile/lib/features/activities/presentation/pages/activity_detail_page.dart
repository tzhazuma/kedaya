import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/activity.dart';
import '../../../../domain/models/activity_ics.dart';
import '../../../../domain/models/activity_time.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/ics_export.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/activities_providers.dart';
import '../components/activity_cards.dart';
import '../components/activity_date_time_picker.dart';

/// 活动详情：字段、证据、来源、提醒状态与确认/忽略。
///
/// 三个“不撒谎”的承诺：
/// 1. 报名截止只有原文时，明说没有可确定时刻，不补 `23:59`；
/// 2. 候选活动不显示提醒，只说明确认后才会创建；
/// 3. 提醒只展示站内信状态，不声称已接通系统推送或微信订阅消息。
class ActivityDetailPage extends ConsumerWidget {
  const ActivityDetailPage({
    required this.activityId,
    this.pickDateTime = pickActivityDateTime,
    super.key,
  });

  final String activityId;

  /// 日期选择器（测试注入；默认走真实 Material 选择器）。
  final ActivityDateTimePicker pickDateTime;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ActivityItem> value =
        ref.watch(activityDetailProvider(activityId));

    final ActivityItem? loaded = value.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('活动详情'),
        actions: <Widget>[
          // 只在有确定开始时间时才给出口：时间待确认的活动导出到日历是错的。
          if (loaded != null && loaded.startsAt != null)
            IconButton(
              tooltip: '导出到日历（ICS）',
              onPressed: () async {
                final String ics = buildIcs(
                  buildActivityIcsEvents(<ActivityItem>[loaded]),
                );
                await ref.read(shareProvider).copyToClipboard(ics);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Semantics(
                      liveRegion: true,
                      child: Text(
                        loaded.isPending
                            ? '已复制 ICS。这条活动还没确认，导入日历前请先核对时间。'
                            : '已复制 ICS 到剪贴板，可粘贴保存为 .ics 后导入日历',
                      ),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.event_available_outlined),
            ),
        ],
      ),
      body: SafeArea(
        child: value.when(
          data: (ActivityItem item) => _ActivityDetailBody(
            item: item,
            pickDateTime: pickDateTime,
          ),
          loading: () => const KedaYaLoadingState(message: '正在打开活动…'),
          error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
            error: error,
            onRetry: () => ref.invalidate(activityDetailProvider(activityId)),
          ),
          skipLoadingOnRefresh: true,
        ),
      ),
    );
  }
}

class _ActivityDetailBody extends ConsumerStatefulWidget {
  const _ActivityDetailBody({
    required this.item,
    required this.pickDateTime,
  });

  final ActivityItem item;
  final ActivityDateTimePicker pickDateTime;

  @override
  ConsumerState<_ActivityDetailBody> createState() =>
      _ActivityDetailBodyState();
}

class _ActivityDetailBodyState extends ConsumerState<_ActivityDetailBody> {
  bool _busy = false;

  ActivityItem get item => widget.item;

  String _messageOf(Object error) =>
      error is ApiException ? error.error.userMessage : '$error';

  Future<void> _confirm() async {
    setState(() => _busy = true);
    try {
      await ref.read(activitiesActionsProvider).confirm(item.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已确认。默认站内提醒已按规则创建。'),
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _dismiss() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('忽略这个活动？'),
        content: const Text('忽略后不会提醒，也不会进入日程。需要时可以重新从来源导入。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            style: TextButton.styleFrom(
              minimumSize: const Size(48, 48),
            ),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              minimumSize: const Size(88, 48),
            ),
            child: const Text('确认忽略'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(activitiesActionsProvider).dismiss(item.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已忽略，不再提醒。'),
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copyLink(String label, String url) async {
    try {
      await ref.read(shareProvider).copyToClipboard(url);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$label已复制')),
      );
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('复制失败，请长按链接手动复制'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool showReminders = item.status == ActivityStatus.confirmed;

    return ListView(
      padding: EdgeInsets.fromLTRB(
        KedaYaTokens.space4,
        KedaYaTokens.space4,
        KedaYaTokens.space4,
        KedaYaTokens.space6 + MediaQuery.viewPaddingOf(context).bottom,
      ),
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Text(
                item.title,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXl,
                  fontWeight: KedaYaTokens.fontWeightBold,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ),
            const SizedBox(width: KedaYaTokens.space2),
            ActivityStatusBadge(status: item.status),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space3),
        Wrap(
          spacing: KedaYaTokens.space2,
          runSpacing: KedaYaTokens.space1,
          children: <Widget>[
            ActivitySourceBadge(source: item.source),
            if (item.stale)
              ActivityBadge(
                text: '上次同步失败 · 旧数据',
                tone: colors.warning,
                icon: Icons.cloud_off_outlined,
              ),
          ],
        ),
        if (item.stale) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space3),
          _Notice(
            icon: Icons.cloud_off_outlined,
            tone: colors.warning,
            text: '上次同步失败，这条可能是旧数据。重新同步前请以来源原文为准。',
          ),
        ],
        const SizedBox(height: KedaYaTokens.space4),
        _InfoLine(
          icon: Icons.schedule_outlined,
          label: '时间',
          value: item.startsAt == null
              ? item.timeRangeLabel
              : '${item.timeRangeLabel}（北京时间）',
        ),
        if (item.location != null)
          _InfoLine(
            icon: Icons.place_outlined,
            label: '地点',
            value: item.location!,
          ),
        if (item.organizer != null)
          _InfoLine(
            icon: Icons.groups_2_outlined,
            label: '主办方',
            value: item.organizer!,
          ),
        _InfoLine(
          icon: Icons.category_outlined,
          label: '类型',
          value: item.kindLabel,
        ),
        const SizedBox(height: KedaYaTokens.space4),
        _DeadlineSection(item: item),
        if (item.registrationUrl != null || item.sourceUrl != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space4),
          _LinksSection(
            item: item,
            onCopy: (String label, String url) =>
                unawaited(_copyLink(label, url)),
          ),
        ],
        const SizedBox(height: KedaYaTokens.space4),
        _EvidenceSection(item: item),
        const SizedBox(height: KedaYaTokens.space4),
        _SourceSection(item: item),
        const SizedBox(height: KedaYaTokens.space4),
        if (showReminders)
          _RemindersSection(
            activityId: item.id,
            pickDateTime: widget.pickDateTime,
          )
        else if (item.status == ActivityStatus.candidate)
          _Notice(
            icon: Icons.info_outline,
            tone: colors.info,
            text: '确认后才会创建提醒（报名截止前 24 小时、开始前 1 小时）。'
                '候选活动不会进入日程，也不会触发提醒。',
          )
        else
          _Notice(
            icon: Icons.notifications_off_outlined,
            tone: colors.textMuted,
            text: item.status == ActivityStatus.dismissed
                ? '已忽略：不会再提醒。需要时可以重新从来源导入。'
                : '已归档：不会再提醒。',
          ),
        const SizedBox(height: KedaYaTokens.space5),
        _Actions(
          item: item,
          busy: _busy,
          onConfirm: _confirm,
          onDismiss: _dismiss,
        ),
      ],
    );
  }
}

class _DeadlineSection extends StatelessWidget {
  const _DeadlineSection({required this.item});

  final ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DateTime? deadline = item.registrationDeadlineAt;
    final String? raw = item.registrationDeadlineRaw;

    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.event_busy_outlined,
                  size: 18, color: colors.textMuted),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                '报名截止',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          if (deadline != null)
            Text(
              item.registrationDeadlineLabel,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            )
          else if (raw == null)
            Text(
              '未注明报名截止。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          if (raw != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '原文：$raw',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
            if (deadline == null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '原文没有可确定的时刻，因此不会自动创建截止提醒，也不会擅自补一个时刻。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.warning,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _LinksSection extends StatelessWidget {
  const _LinksSection({required this.item, required this.onCopy});

  final ActivityItem item;
  final void Function(String label, String url) onCopy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (item.registrationUrl != null) ...<Widget>[
          _LinkBlock(
            label: '报名链接',
            url: item.registrationUrl!,
            copyLabel: '复制报名链接',
            onCopy: onCopy,
          ),
          const SizedBox(height: KedaYaTokens.space3),
        ],
        if (item.sourceUrl != null)
          _LinkBlock(
            label: '来源链接',
            url: item.sourceUrl!,
            copyLabel: '复制来源链接',
            onCopy: onCopy,
          ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          '链接只用于复制，不在应用内自动打开；请自行确认域名可信。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
      ],
    );
  }
}

class _LinkBlock extends StatelessWidget {
  const _LinkBlock({
    required this.label,
    required this.url,
    required this.copyLabel,
    required this.onCopy,
  });

  final String label;
  final String url;
  final String copyLabel;
  final void Function(String label, String url) onCopy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        SelectableText(
          url,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.info,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        OutlinedButton.icon(
          onPressed: () => onCopy(label, url),
          icon: const Icon(Icons.copy_all_outlined, size: 18),
          label: Text(copyLabel),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 48),
          ),
        ),
      ],
    );
  }
}

class _EvidenceSection extends StatelessWidget {
  const _EvidenceSection({required this.item});

  final ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '证据摘录（最多 $activityEvidenceMaxChars 字）',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          item.evidenceText ?? '没有保存证据片段。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            height: KedaYaTokens.lineHeightLoose,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          '只保存这段摘录；不保存邮件正文、附件或公众号全文。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
      ],
    );
  }
}

class _SourceSection extends StatelessWidget {
  const _SourceSection({required this.item});

  final ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '来源',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          item.source.description,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
        if (item.sourceLabel != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '来源标注：${item.sourceLabel}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.text,
            ),
          ),
        ],
        if (item.publishedAt != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '发布于 ${formatShanghaiInstant(item.publishedAt!)}（北京时间）',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ],
      ],
    );
  }
}

class _RemindersSection extends ConsumerStatefulWidget {
  const _RemindersSection({
    required this.activityId,
    required this.pickDateTime,
  });

  final String activityId;
  final ActivityDateTimePicker pickDateTime;

  @override
  ConsumerState<_RemindersSection> createState() => _RemindersSectionState();
}

class _RemindersSectionState extends ConsumerState<_RemindersSection> {
  bool _busy = false;

  String _messageOf(Object error) =>
      error is ApiException ? error.error.userMessage : '$error';

  Future<void> _addReminder() async {
    final DateTime now = ref.read(activitiesClockProvider)();
    final DateTime? picked = await widget.pickDateTime(
      context,
      initialUtc: now.add(const Duration(hours: 1)),
      now: now,
      firstUtc: now.add(const Duration(minutes: 1)),
    );
    if (picked == null || !mounted) return;
    if (!picked.toUtc().isAfter(now.toUtc())) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('提醒时间必须晚于当前时刻')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(activitiesActionsProvider).addReminder(
            widget.activityId,
            kind: ActivityReminderKind.custom,
            remindAt: picked,
            // MVP 只有站内信；微信订阅消息未接通，不在 UI 里提供假入口。
            channel: ActivityReminderChannel.inapp,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已添加站内信提醒。'),
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteReminder(ActivityReminderItem reminder) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除这条提醒？'),
        content: const Text('删除后不会再收到这条站内信提醒。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(minimumSize: const Size(88, 48)),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(activitiesActionsProvider).deleteReminder(reminder.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已删除提醒。'),
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<ActivityRemindersState> value =
        ref.watch(activityRemindersProvider(widget.activityId));
    final ActivityRemindersController controller =
        ref.read(activityRemindersProvider(widget.activityId).notifier);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '提醒',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          '提醒只在本应用内展示；本版本不会发送系统推送、APNs/FCM/HMS 或微信订阅消息。'
          '自定义提醒也只支持站内信。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        OutlinedButton.icon(
          key: const Key('activity-add-reminder'),
          onPressed: _busy ? null : () => unawaited(_addReminder()),
          icon: const Icon(Icons.add_alarm_outlined, size: 18),
          label: const Text('添加站内信提醒'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        value.when(
          data: (ActivityRemindersState state) {
            final List<ActivityReminderItem> reminders = state.reminders;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (reminders.isEmpty)
                  Text(
                    '还没有提醒：活动时间或报名截止尚未确定，也可以手动添加站内信提醒。',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.textMuted,
                    ),
                  )
                else
                  for (final ActivityReminderItem reminder in reminders)
                    Padding(
                      padding: const EdgeInsets.only(
                        bottom: KedaYaTokens.space2,
                      ),
                      child: _ReminderRow(
                        reminder: reminder,
                        onDelete: _busy
                            ? null
                            : () => unawaited(_deleteReminder(reminder)),
                      ),
                    ),
                if (state.loadMoreError != null) ...<Widget>[
                  Text(
                    '加载更多提醒失败：${_messageOf(state.loadMoreError!)}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.warning,
                    ),
                  ),
                  TextButton(
                    key: const Key('activity-reminders-load-more-retry'),
                    onPressed: () => unawaited(controller.loadMore()),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(48, 48),
                    ),
                    child: const Text('重试'),
                  ),
                ],
                if (state.hasMore)
                  OutlinedButton(
                    key: const Key('activity-reminders-load-more'),
                    onPressed: state.isLoadingMore
                        ? null
                        : () => unawaited(controller.loadMore()),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: Text(
                      state.isLoadingMore ? '正在加载更多提醒…' : '加载更多提醒',
                    ),
                  ),
              ],
            );
          },
          loading: () => const KedaYaLoadingState(message: '正在读取提醒…'),
          error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
            error: error,
            onRetry: () => ref.invalidate(
              activityRemindersProvider(widget.activityId),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReminderRow extends StatelessWidget {
  const _ReminderRow({required this.reminder, this.onDelete});

  final ActivityReminderItem reminder;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  reminder.kind.label,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              ActivityBadge(
                text: reminder.status.label,
                tone: reminder.status == ActivityReminderStatus.sent
                    ? colors.success
                    : colors.textMuted,
              ),
              IconButton(
                key: Key('activity-delete-reminder-${reminder.id}'),
                tooltip: '删除提醒',
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline, size: 20),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            reminder.remindAtLabel,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(
                reminder.channel.label,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
              Text(
                reminder.status.label,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.item,
    required this.busy,
    required this.onConfirm,
    required this.onDismiss,
  });

  final ActivityItem item;
  final bool busy;
  final Future<void> Function() onConfirm;
  final Future<void> Function() onDismiss;

  @override
  Widget build(BuildContext context) {
    if (item.status == ActivityStatus.dismissed ||
        item.status == ActivityStatus.archived) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (item.status == ActivityStatus.candidate) ...<Widget>[
          FilledButton.icon(
            onPressed: busy ? null : () => unawaited(onConfirm()),
            icon: busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check_circle_outline, size: 18),
            label: const Text('确认活动'),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
        ],
        OutlinedButton(
          onPressed: busy ? null : () => unawaited(onDismiss()),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(
            item.status == ActivityStatus.candidate ? '忽略' : '忽略此活动',
          ),
        ),
      ],
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 18, color: colors.textMuted),
          ),
          const SizedBox(width: KedaYaTokens.space2),
          SizedBox(
            width: 56,
            child: Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.tone,
    required this.text,
  });

  final IconData icon;
  final Color tone;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: tone.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: tone),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: context.kedayaColors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
