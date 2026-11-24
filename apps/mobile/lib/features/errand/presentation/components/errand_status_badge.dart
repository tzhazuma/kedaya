import 'package:flutter/material.dart';

import '../../../../domain/models/errand_task.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 状态徽章（文字永远保留，不靠颜色单独表意）。
class ErrandStatusBadge extends StatelessWidget {
  const ErrandStatusBadge({required this.status, super.key});

  final ErrandStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = switch (status) {
      ErrandStatus.open => colors.brandStrong,
      ErrandStatus.accepted || ErrandStatus.delivered => colors.info,
      ErrandStatus.completed => colors.success,
      ErrandStatus.cancelled || ErrandStatus.unknown => colors.textMuted,
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
        status.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: tone,
        ),
      ),
    );
  }
}
