import 'package:flutter/material.dart';

import '../../../../domain/models/takeout_report.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// `11月24日 12:30`（本地时区）。
String formatTakeoutDateTime(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.month}月${local.day}日 $hour:$minute';
}

/// 单条报备卡片：时间、地点、平台、餐品、状态与两个操作。
class TakeoutReportCard extends StatelessWidget {
  const TakeoutReportCard({
    required this.report,
    required this.now,
    this.onResolve,
    this.onDelete,
    super.key,
  });

  final TakeoutReport report;

  /// 用于相对时间文案（「2 小时前」）。
  final DateTime now;

  final VoidCallback? onResolve;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color statusColor =
        report.isResolved ? colors.success : colors.warning;

    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: KedaYaTokens.space2,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
                ),
                child: Text(
                  report.status.label,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: statusColor,
                  ),
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  '${formatTakeoutDateTime(report.occurredAt)} · '
                  '${formatRelativeTime(report.occurredAt, now: now)}',
                  textAlign: TextAlign.end,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            report.meal,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeMd,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          _MetaRow(icon: Icons.place_outlined, text: report.location),
          _MetaRow(
            icon: Icons.takeout_dining_outlined,
            text: report.platform.label,
          ),
          if (report.contactedBuildingManager)
            _MetaRow(
              icon: Icons.badge_outlined,
              text: '已联系楼管',
              tint: colors.success,
            ),
          if (report.note.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              report.note,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ],
          if (!report.isResolved || onDelete != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Row(
              children: <Widget>[
                if (!report.isResolved && onResolve != null)
                  TextButton.icon(
                    onPressed: onResolve,
                    icon: const Icon(Icons.check_circle_outline, size: 18),
                    label: const Text('标记已解决'),
                  ),
                const Spacer(),
                if (onDelete != null)
                  TextButton.icon(
                    onPressed: onDelete,
                    style: TextButton.styleFrom(
                      foregroundColor: colors.danger,
                    ),
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('删除'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({
    required this.icon,
    required this.text,
    this.tint,
  });

  final IconData icon;
  final String text;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color color = tint ?? colors.textMuted;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 14, color: color),
          const SizedBox(width: KedaYaTokens.space1),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
