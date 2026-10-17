import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 小标签的语义色调。
enum ForumPillTone {
  /// 中性信息（版块名、标签）。
  neutral,

  /// 品牌强调（置顶、状态）。
  brand,

  /// 警示（被举报/已隐藏）。
  danger,
}

/// 论坛里通用的小标签（版块名 / 标签 / 状态）。
///
/// 色值**全部**来自 `context.kedayaColors`，因此暗色主题自动生效
/// （契约 §11.5：禁止硬编码色值）。
class ForumPill extends StatelessWidget {
  const ForumPill(
      {required this.text,
      this.tone = ForumPillTone.neutral,
      this.icon,
      super.key});

  final String text;
  final ForumPillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final (Color background, Color foreground) = switch (tone) {
      ForumPillTone.neutral => (colors.surfaceAlt, colors.textMuted),
      ForumPillTone.brand => (colors.brandSoft, colors.brandStrong),
      ForumPillTone.danger => (colors.surfaceAlt, colors.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 12, color: foreground),
            const SizedBox(width: KedaYaTokens.space1),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              fontWeight: KedaYaTokens.fontWeightMedium,
              color: foreground,
            ),
          ),
        ],
      ),
    );
  }
}

/// 匿名标记。
///
/// 契约 §9 要求匿名与实名在模型层解耦；UI 这一侧的责任是**把匿名状态显式说出来**，
/// 而不是让匿名帖看起来和实名帖一样。长按/悬停会给出说明文案。
class ForumAnonymousBadge extends StatelessWidget {
  const ForumAnonymousBadge({required this.notice, super.key});

  /// 说明文案，来自 domain 常量（[anonymousPostNotice] / [anonymousReplyNotice]）。
  final String notice;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: notice,
        child: const ForumPill(
          text: '匿名',
          tone: ForumPillTone.brand,
          icon: Icons.visibility_off_outlined,
        ),
      );
}
