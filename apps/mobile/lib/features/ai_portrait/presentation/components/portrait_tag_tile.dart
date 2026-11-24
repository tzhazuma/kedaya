import 'package:flutter/material.dart';

import '../../../../domain/models/campus_portrait.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 一个画像标签：标签名 + **必填的来源与更新时间**。
class PortraitTagTile extends StatelessWidget {
  const PortraitTagTile({required this.tag, this.dense = false, super.key});

  final PortraitTag tag;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: EdgeInsets.all(
        dense ? KedaYaTokens.space2 : KedaYaTokens.space3,
      ),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            tag.label,
            style: TextStyle(
              fontSize:
                  dense ? KedaYaTokens.fontSizeSm : KedaYaTokens.fontSizeMd,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            tag.sourceLine,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          if (tag.detail != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              tag.detail!,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
