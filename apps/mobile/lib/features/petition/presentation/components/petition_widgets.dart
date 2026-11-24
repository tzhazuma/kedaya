import 'package:flutter/material.dart';

import '../../../../domain/models/petition_ticket.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 演示版提示的**固定文案**。
///
/// 三个页面都从这一个常量渲染，避免某一页悄悄弱化成「已提交给学校」。
const String petitionDemoNoticeText = '演示版：提交只保存在本机，不会发送给学校';

/// 页首的常驻提示条。
class PetitionDemoNotice extends StatelessWidget {
  const PetitionDemoNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(
          color: colors.warning.withValues(alpha: 0.40),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.info_outline, size: 18, color: colors.warning),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              petitionDemoNoticeText,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightSemibold,
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

/// 状态徽章：文字永远保留，不靠颜色单独表意。
class PetitionStatusBadge extends StatelessWidget {
  const PetitionStatusBadge({required this.status, super.key});

  final PetitionStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = _statusTone(status, colors);
    final IconData icon = switch (status) {
      PetitionStatus.submitted => Icons.edit_note,
      PetitionStatus.processing => Icons.hourglass_top,
      PetitionStatus.replied => Icons.forum_outlined,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.40)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 12, color: tone),
          const SizedBox(width: 3),
          Text(
            status.label,
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

/// 类别小标签。
class PetitionCategoryBadge extends StatelessWidget {
  const PetitionCategoryBadge({required this.category, super.key});

  final PetitionCategory category;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: colors.border),
      ),
      child: Text(
        category.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          color: colors.textMuted,
        ),
      ),
    );
  }
}

/// 列表卡片：类别 / 标题 / 状态 / 时间同时可判读。
class PetitionTicketCard extends StatelessWidget {
  const PetitionTicketCard({
    required this.ticket,
    required this.onTap,
    super.key,
  });

  final PetitionTicket ticket;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      ticket.title,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        height: KedaYaTokens.lineHeightNormal,
                        color: colors.text,
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  PetitionStatusBadge(status: ticket.status),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                ticket.body,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Row(
                children: <Widget>[
                  PetitionCategoryBadge(category: ticket.category),
                  if (ticket.anonymous) ...<Widget>[
                    const SizedBox(width: KedaYaTokens.space2),
                    Icon(
                      Icons.visibility_off_outlined,
                      size: 14,
                      color: colors.textMuted,
                    ),
                    const SizedBox(width: 2),
                    Text(
                      '匿名',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        color: colors.textMuted,
                      ),
                    ),
                  ],
                  const Spacer(),
                  Text(
                    formatPetitionDateTime(ticket.submittedAt),
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 「已提交 → 处理中 → 已回复」的竖向时间线。
///
/// 未发生的步骤显示「待进行」而不是编一个时间；已经发生的步骤带具体时刻。
class PetitionTimeline extends StatelessWidget {
  const PetitionTimeline({required this.ticket, super.key});

  final PetitionTicket ticket;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final List<PetitionTimelineEntry> entries = petitionTimeline(ticket);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int index = 0; index < entries.length; index++)
          Padding(
            key: Key('petition-timeline-${entries[index].status.wire}'),
            padding: EdgeInsets.zero,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                SizedBox(
                  width: 20,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Container(
                        width: 12,
                        height: 12,
                        margin: const EdgeInsets.only(top: 3),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: entries[index].happened
                              ? _statusTone(entries[index].status, colors)
                              : colors.surface,
                          border: Border.all(
                            width: 2,
                            color: entries[index].happened
                                ? _statusTone(entries[index].status, colors)
                                : colors.border,
                          ),
                        ),
                      ),
                      if (index != entries.length - 1)
                        Container(
                          width: 2,
                          height: 24,
                          margin: const EdgeInsets.only(top: 2),
                          color: entries[index + 1].happened
                              ? _statusTone(entries[index].status, colors)
                                  .withValues(alpha: 0.45)
                              : colors.border,
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          entries[index].status.label,
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeSm,
                            fontWeight: entries[index].happened
                                ? KedaYaTokens.fontWeightSemibold
                                : KedaYaTokens.fontWeightRegular,
                            color: entries[index].happened
                                ? colors.text
                                : colors.textMuted,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          entries[index].at == null
                              ? '待进行'
                              : formatPetitionDateTime(entries[index].at!),
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeXs,
                            color: entries[index].happened
                                ? colors.textMuted
                                : colors.textMuted.withValues(alpha: 0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// `2026-11-24 14:30`（本地时区）。
String formatPetitionDateTime(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String year = local.year.toString();
  final String month = local.month.toString().padLeft(2, '0');
  final String day = local.day.toString().padLeft(2, '0');
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '$year-$month-$day $hour:$minute';
}

Color _statusTone(PetitionStatus status, KedaYaColors colors) =>
    switch (status) {
      PetitionStatus.submitted => colors.info,
      PetitionStatus.processing => colors.warning,
      PetitionStatus.replied => colors.success,
    };
