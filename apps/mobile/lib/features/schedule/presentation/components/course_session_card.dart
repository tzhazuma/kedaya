import 'package:flutter/material.dart';

import '../../../../domain/models/course_session.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 一条课程时段卡片。
///
/// 设计约束：
/// - **进行中的课必须一眼看出来**：整张卡片换底色 + 描边，并带文字徽章
///   （不能只靠颜色 —— 色弱 / 截图 / 屏幕阅读器都还要能读）；
/// - 课程名可能很长，因此放在 [Expanded] 里两行截断，右上角只放一个短徽章，
///   手机宽度下不会横向溢出；
/// - 教师、地点各占一行，带图标，长文本单行截断。
class CourseSessionCard extends StatelessWidget {
  const CourseSessionCard({
    required this.session,
    required this.now,
    this.dense = false,
    super.key,
  });

  final CourseSession session;

  /// 注入「现在」：进行中判定与高亮都据此计算（测试里可复现）。
  final DateTime now;

  /// 紧凑模式（本周列表里一天多课时用，少一点内边距）。
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool ongoing = session.isOngoingAt(now);

    return Container(
      padding: EdgeInsets.all(
        dense ? KedaYaTokens.space3 : KedaYaTokens.space4,
      ),
      decoration: BoxDecoration(
        color: ongoing ? colors.brandSoft : colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(
          color: ongoing ? colors.brandStrong : colors.border,
          width: ongoing ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  session.courseName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ),
              if (ongoing) ...<Widget>[
                const SizedBox(width: KedaYaTokens.space2),
                const _OngoingBadge(),
              ],
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _MetaRow(icon: Icons.person_outline, text: session.teacher),
          const SizedBox(height: 2),
          _MetaRow(icon: Icons.place_outlined, text: session.location),
          if (session.note != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            _MetaRow(icon: Icons.sticky_note_2_outlined, text: session.note!),
          ],
          const SizedBox(height: KedaYaTokens.space2),
          Row(
            children: <Widget>[
              Icon(
                Icons.schedule_outlined,
                size: 16,
                color: ongoing ? colors.brandStrong : colors.textMuted,
              ),
              const SizedBox(width: KedaYaTokens.space1),
              Text(
                session.timeRangeLabel,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightMedium,
                  color: ongoing ? colors.brandStrong : colors.text,
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                session.periodLabel,
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

/// 「进行中」徽章（文字永远保留）。
class _OngoingBadge extends StatelessWidget {
  const _OngoingBadge();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.brandStrong,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
      ),
      child: Text(
        '进行中',
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: colors.textInverse,
        ),
      ),
    );
  }
}

/// 「图标 + 单行截断文本」的元信息行。
class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      children: <Widget>[
        Icon(icon, size: 14, color: colors.textMuted),
        const SizedBox(width: KedaYaTokens.space1),
        Expanded(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}
