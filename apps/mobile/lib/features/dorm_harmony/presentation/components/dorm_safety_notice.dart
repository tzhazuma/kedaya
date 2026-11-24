import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 顶部固定提示（每个页面都渲染，且不随列表滚动）。
const String dormSafetyNoticeText = '匿名发布，请就事论事；涉及安全请直接联系辅导员/保卫处';

class DormSafetyNotice extends StatelessWidget {
  const DormSafetyNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.brand.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.shield_outlined,
            size: 18,
            color: colors.brandStrong,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  dormSafetyNoticeText,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '这里是匿名倾诉板，不是公开举报墙：不点名、不人身攻击，只讨论具体的生活问题。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
