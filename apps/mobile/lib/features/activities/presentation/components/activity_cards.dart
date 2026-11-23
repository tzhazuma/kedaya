import 'package:flutter/material.dart';

import '../../../../domain/models/activity.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 小徽章：文字永远保留（不靠颜色单独表意）。
class ActivityBadge extends StatelessWidget {
  const ActivityBadge({
    required this.text,
    required this.tone,
    this.icon,
    super.key,
  });

  final String text;
  final Color tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 12, color: tone),
            const SizedBox(width: 3),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              fontWeight: KedaYaTokens.fontWeightMedium,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}

/// 来源徽章（校园邮箱 / 公众号 / 手动创建）。
class ActivitySourceBadge extends StatelessWidget {
  const ActivitySourceBadge({required this.source, super.key});

  final ActivitySource source;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final IconData icon = switch (source) {
      ActivitySource.campusMail => Icons.mail_outline,
      ActivitySource.wechatMp => Icons.article_outlined,
      ActivitySource.manual => Icons.edit_outlined,
    };
    return ActivityBadge(
      text: source.label,
      tone: switch (source) {
        ActivitySource.campusMail => colors.info,
        ActivitySource.wechatMp => colors.brandStrong,
        ActivitySource.manual => colors.textMuted,
      },
      icon: icon,
    );
  }
}

/// 状态徽章（待确认 / 已确认 / 已忽略 / 已归档）。
class ActivityStatusBadge extends StatelessWidget {
  const ActivityStatusBadge({required this.status, super.key});

  final ActivityStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return ActivityBadge(
      text: status.label,
      tone: switch (status) {
        ActivityStatus.candidate => colors.warning,
        ActivityStatus.confirmed => colors.success,
        ActivityStatus.dismissed => colors.textMuted,
        ActivityStatus.archived => colors.textMuted,
      },
    );
  }
}

/// 列表卡片：来源 / 状态 / 时间 / 地点 / 报名截止同时可判读。
///
/// 候选活动会额外说明“不会触发提醒”，避免用户以为它已经在日程里。
class ActivityCard extends StatelessWidget {
  const ActivityCard({required this.item, required this.onTap, super.key});

  final ActivityItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool hasDeadline = item.registrationDeadlineAt != null ||
        item.registrationDeadlineRaw != null;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      item.title,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        height: KedaYaTokens.lineHeightNormal,
                        color: item.status == ActivityStatus.dismissed ||
                                item.status == ActivityStatus.archived
                            ? colors.textMuted
                            : colors.text,
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  ActivityStatusBadge(status: item.status),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space1,
                crossAxisAlignment: WrapCrossAlignment.center,
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
              const SizedBox(height: KedaYaTokens.space2),
              _IconLine(
                icon: Icons.schedule_outlined,
                text: item.startsAt == null
                    ? item.timeRangeLabel
                    : '${item.timeRangeLabel}（北京时间）',
              ),
              if (item.location != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space1),
                _IconLine(
                  icon: Icons.place_outlined,
                  text: item.location!,
                ),
              ],
              if (hasDeadline) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space1),
                _IconLine(
                  icon: Icons.event_busy_outlined,
                  text: item.registrationDeadlineAt != null
                      ? '报名截止：${item.registrationDeadlineLabel}'
                      : '报名截止原文：${item.registrationDeadlineRaw}',
                ),
              ],
              if (item.isPending) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  '待确认：不会进入日程，也不会触发提醒。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.warning,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 16, color: colors.textMuted),
        ),
        const SizedBox(width: KedaYaTokens.space1),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}
