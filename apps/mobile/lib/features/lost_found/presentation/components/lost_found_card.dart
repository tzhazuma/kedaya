import 'package:flutter/material.dart';

import '../../../../domain/models/lost_found_item.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'lost_found_pill.dart';

/// 列表项：类型、状态、标题、地点与相对时间。
///
/// 联系方式**不在列表里出现**（契约 §9 数据最小化），只在详情页展示。
class LostFoundCard extends StatelessWidget {
  const LostFoundCard({
    required this.item,
    required this.now,
    this.onTap,
    super.key,
  });

  final LostFoundItem item;
  final DateTime now;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool isLost = item.kind == LostFoundKind.lost;
    final Color kindColor = isLost ? colors.warning : colors.success;
    final Color statusColor = item.isResolved ? colors.success : colors.info;
    final DateTime displayTime = item.occurredAt ?? item.createdAt;

    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Container(
          padding: const EdgeInsets.all(KedaYaTokens.space3),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  LostFoundPill(
                    label: isLost ? '寻物' : '招领',
                    color: kindColor,
                  ),
                  const SizedBox(width: KedaYaTokens.space1),
                  LostFoundPill(
                    label: item.isResolved ? '已解决' : item.status.label,
                    color: statusColor,
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Text(
                      formatRelativeTime(displayTime, now: now),
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
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space1),
                  Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: colors.textMuted,
                  ),
                ],
              ),
              if (item.location != null &&
                  item.location!.trim().isNotEmpty) ...[
                const SizedBox(height: KedaYaTokens.space1),
                Row(
                  children: <Widget>[
                    Icon(
                      Icons.place_outlined,
                      size: 14,
                      color: colors.textMuted,
                    ),
                    const SizedBox(width: KedaYaTokens.space1),
                    Expanded(
                      child: Text(
                        item.location!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              if (item.description != null &&
                  item.description!.trim().isNotEmpty) ...[
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  item.description!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
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
