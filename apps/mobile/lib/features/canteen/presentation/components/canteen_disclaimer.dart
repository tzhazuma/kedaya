import 'package:flutter/material.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 营养数据的来源提示。
///
/// 所有出现营养值的页面（首页 / 菜品库 / 记一餐 / 今日记录）都要放一个，
/// 且文案里必须保留 [canteenNutritionNotice] 的原文。
class CanteenNutritionNotice extends StatelessWidget {
  const CanteenNutritionNotice({this.showDetail = true, super.key});

  /// 是否补一句「仅供选餐参考」。列表页顶部空间紧张时可以只留原句。
  final bool showDetail;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space3,
        vertical: KedaYaTokens.space2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.science_outlined,
            size: KedaYaTokens.fontSizeMd,
            color: colors.textMuted,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              showDetail
                  ? '$canteenNutritionNotice；营养值仅供选餐时参考。'
                  : canteenNutritionNotice,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
