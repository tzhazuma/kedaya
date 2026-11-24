import 'package:flutter/material.dart';

import '../../../../domain/models/errand_task.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../domain/errand_board.dart';
import 'errand_status_badge.dart';

/// 跑腿卡片：路线、报酬、倒计时、备注摘要、发布者代号。
class ErrandCard extends StatelessWidget {
  const ErrandCard({
    required this.task,
    required this.now,
    this.onTap,
    super.key,
  });

  final ErrandTask task;

  /// 注入「现在」：倒计时与紧急程度据此计算（测试可复现）。
  final DateTime now;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool passed = errandDeadlinePassed(task.deadline, now);
    final bool urgent = errandDeadlineUrgent(task.deadline, now);
    final Color deadlineTone =
        passed ? colors.danger : (urgent ? colors.warning : colors.textMuted);
    final String note = errandNoteExcerpt(task.note);

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
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Icon(
                              Icons.trip_origin,
                              size: 14,
                              color: colors.success,
                            ),
                            const SizedBox(width: KedaYaTokens.space1),
                            Text(
                              '取件',
                              style: TextStyle(
                                fontSize: KedaYaTokens.fontSizeXs,
                                color: colors.textMuted,
                              ),
                            ),
                            const SizedBox(width: KedaYaTokens.space2),
                            Expanded(
                              child: Text(
                                errandPickupText(task),
                                style: TextStyle(
                                  fontSize: KedaYaTokens.fontSizeSm,
                                  color: colors.text,
                                  height: KedaYaTokens.lineHeightNormal,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Row(
                          children: <Widget>[
                            Icon(
                              Icons.place_outlined,
                              size: 14,
                              color: colors.brandStrong,
                            ),
                            const SizedBox(width: KedaYaTokens.space1),
                            Text(
                              '送达',
                              style: TextStyle(
                                fontSize: KedaYaTokens.fontSizeXs,
                                color: colors.textMuted,
                              ),
                            ),
                            const SizedBox(width: KedaYaTokens.space2),
                            Expanded(
                              child: Text(
                                errandDeliveryText(task),
                                style: TextStyle(
                                  fontSize: KedaYaTokens.fontSizeSm,
                                  color: colors.text,
                                  height: KedaYaTokens.lineHeightNormal,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space3),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: <Widget>[
                      Text(
                        '¥${task.rewardYuan}',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeLg,
                          fontWeight: KedaYaTokens.fontWeightBold,
                          color: colors.brandStrong,
                        ),
                      ),
                      Text(
                        '报酬',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Row(
                children: <Widget>[
                  ErrandStatusBadge(status: task.status),
                  const SizedBox(width: KedaYaTokens.space2),
                  Icon(
                    Icons.timer_outlined,
                    size: 14,
                    color: deadlineTone,
                  ),
                  const SizedBox(width: 2),
                  Expanded(
                    child: Text(
                      errandDeadlineText(task.deadline, now),
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: urgent || passed
                            ? KedaYaTokens.fontWeightMedium
                            : KedaYaTokens.fontWeightRegular,
                        color: deadlineTone,
                      ),
                    ),
                  ),
                ],
              ),
              if (note.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  note,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
              const SizedBox(height: KedaYaTokens.space3),
              Row(
                children: <Widget>[
                  Icon(
                    Icons.person_outline,
                    size: 14,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 2),
                  Expanded(
                    child: Text(
                      '${errandPosterAlias(task)} 发布',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        color: colors.textMuted,
                      ),
                    ),
                  ),
                  Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: colors.textMuted,
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
