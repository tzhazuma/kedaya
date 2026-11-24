import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 徽章色调。
enum FleaTagTone { neutral, brand, success, warning, danger }

/// 小徽章：文字永远保留，不允许只靠颜色表意（色弱 / 截图 / 读屏都能用）。
class FleaTag extends StatelessWidget {
  const FleaTag({
    required this.text,
    this.tone = FleaTagTone.neutral,
    this.icon,
    super.key,
  });

  final String text;
  final FleaTagTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final Color color = switch (tone) {
      FleaTagTone.neutral => context.kedayaColors.textMuted,
      FleaTagTone.brand => context.kedayaColors.brandStrong,
      FleaTagTone.success => context.kedayaColors.success,
      FleaTagTone.warning => context.kedayaColors.warning,
      FleaTagTone.danger => context.kedayaColors.danger,
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 3),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              fontWeight: KedaYaTokens.fontWeightMedium,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
