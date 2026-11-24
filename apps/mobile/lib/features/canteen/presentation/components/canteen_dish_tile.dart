import 'package:flutter/material.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 菜品行：名称、食堂、品类、价格、热量、钠与过敏原。
///
/// 菜品库、记一餐与首页建议共用，避免三个页面各写一套「钠多少算高」的
/// 展示逻辑。高钠用徽章标出；过敏原只陈述「含什么」，不做忌口判断。
class CanteenDishTile extends StatelessWidget {
  const CanteenDishTile({
    required this.dish,
    this.trailing,
    this.footnote,
    this.onTap,
    super.key,
  });

  final CanteenDish dish;

  /// 右侧操作（例如「加入」按钮）；不传则只展示。
  final Widget? trailing;

  /// 额外的说明行（首页建议的「可补…」理由）。
  final Widget? footnote;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final TextStyle metaStyle = TextStyle(
      fontSize: KedaYaTokens.fontSizeXs,
      height: KedaYaTokens.lineHeightNormal,
      color: colors.textMuted,
    );
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            KedaYaTokens.space3,
            KedaYaTokens.space2,
            KedaYaTokens.space2,
            KedaYaTokens.space2,
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            dish.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: KedaYaTokens.fontSizeMd,
                              fontWeight: KedaYaTokens.fontWeightSemibold,
                              color: colors.text,
                            ),
                          ),
                        ),
                        if (dish.isHighSodium) ...<Widget>[
                          const SizedBox(width: KedaYaTokens.space1),
                          _HighSodiumBadge(),
                        ],
                      ],
                    ),
                    const SizedBox(height: KedaYaTokens.space1),
                    Text(
                      '${dish.canteen.label} · ${dish.category.label} · '
                      '${dish.priceLabel}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: metaStyle,
                    ),
                    Text(
                      '${dish.nutrition.kcal} kcal · '
                      '蛋白 ${dish.nutrition.proteinG} g · '
                      '钠 ${dish.nutrition.sodiumMg} mg',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: metaStyle.copyWith(
                        color: dish.isHighSodium
                            ? colors.warning
                            : colors.textMuted,
                        fontWeight: dish.isHighSodium
                            ? KedaYaTokens.fontWeightMedium
                            : KedaYaTokens.fontWeightRegular,
                      ),
                    ),
                    if (dish.allergens.isNotEmpty)
                      Text(
                        dish.allergenLabel,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.warning,
                        ),
                      ),
                    if (footnote != null)
                      Padding(
                        padding:
                            const EdgeInsets.only(top: KedaYaTokens.space1),
                        child: footnote,
                      ),
                  ],
                ),
              ),
              if (trailing != null) ...<Widget>[
                const SizedBox(width: KedaYaTokens.space2),
                trailing!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _HighSodiumBadge extends StatelessWidget {
  const _HighSodiumBadge();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space1,
        vertical: 1,
      ),
      decoration: BoxDecoration(
        color: colors.warning.withAlpha(28),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
      ),
      child: Text(
        '高钠',
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: colors.warning,
        ),
      ),
    );
  }
}
