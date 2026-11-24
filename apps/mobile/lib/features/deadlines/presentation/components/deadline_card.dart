import 'package:flutter/material.dart';

import '../../../../domain/models/deadline_item.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 一条 DDL 卡片。
///
/// 一张卡上必须能回答四个问题：**是什么（类型 + 标题）、哪来的（来源）、
/// 什么时候截止、还剩多久 / 逾期几天**。逾期只用红色不够，文案本身也写明
/// 「已逾期 N 天」，色弱与截图场景仍然可读。
class DeadlineCard extends StatelessWidget {
  const DeadlineCard({
    required this.item,
    required this.now,
    required this.onToggle,
    required this.onDelete,
    this.busy = false,
    super.key,
  });

  final DeadlineItem item;

  /// 注入「现在」：剩余时间与逾期判定都据此计算（测试里可复现）。
  final DateTime now;

  /// 勾选 / 取消勾选完成。
  final ValueChanged<bool> onToggle;

  /// 删除（页面负责二次确认）。
  final VoidCallback onDelete;

  /// 该条正在提交（防重复点击）。
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool overdue = item.isOverdueAt(now);
    final Color countdownColor = item.completed
        ? colors.success
        : overdue
            ? colors.danger
            : colors.brandStrong;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        KedaYaTokens.space1,
        KedaYaTokens.space3,
        KedaYaTokens.space1,
        KedaYaTokens.space3,
      ),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(
          color: overdue ? colors.danger.withValues(alpha: 0.5) : colors.border,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Checkbox(
              value: item.completed,
              onChanged: busy ? null : (bool? next) => onToggle(next ?? false),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          fontWeight: KedaYaTokens.fontWeightSemibold,
                          height: KedaYaTokens.lineHeightNormal,
                          color:
                              item.completed ? colors.textMuted : colors.text,
                          decoration: item.completed
                              ? TextDecoration.lineThrough
                              : TextDecoration.none,
                        ),
                      ),
                    ),
                    const SizedBox(width: KedaYaTokens.space2),
                    _KindBadge(kind: item.kind),
                  ],
                ),
                if (item.source != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    '来源：${item.source!}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
                const SizedBox(height: KedaYaTokens.space2),
                Wrap(
                  spacing: KedaYaTokens.space2,
                  runSpacing: 2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Icon(
                          Icons.event_outlined,
                          size: 14,
                          color: colors.textMuted,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          '截止 ${formatDeadlineDue(item.dueAt, now)}',
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeXs,
                            color: colors.textMuted,
                          ),
                        ),
                      ],
                    ),
                    Text(
                      describeDeadlineCountdown(item, now),
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: countdownColor,
                      ),
                    ),
                  ],
                ),
                if (item.note != null) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space1),
                  Text(
                    item.note!,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      height: KedaYaTokens.lineHeightNormal,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            tooltip: '删除',
            onPressed: busy ? null : onDelete,
            icon: Icon(
              Icons.delete_outline,
              size: 20,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

/// 类型徽章（作业 / 考试 / 报名 / 其他），文字永远保留。
class _KindBadge extends StatelessWidget {
  const _KindBadge({required this.kind});

  final DeadlineKind kind;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = switch (kind) {
      DeadlineKind.homework => colors.info,
      DeadlineKind.exam => colors.danger,
      DeadlineKind.registration => colors.warning,
      DeadlineKind.other => colors.textMuted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Text(
        kind.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: tone,
        ),
      ),
    );
  }
}
