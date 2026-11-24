import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_tokens.dart';

/// 失物招领的小标签（寻物 / 招领 / 状态）。
class LostFoundPill extends StatelessWidget {
  const LostFoundPill({
    required this.label,
    required this.color,
    super.key,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: color,
        ),
      ),
    );
  }
}
