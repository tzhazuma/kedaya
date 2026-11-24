import 'package:flutter/material.dart';

import '../../../../domain/models/flea_listing.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'flea_tags.dart';

/// 一条闲置在列表里的全部可判读字段。
///
/// 顺序按「买家先看什么」排：分类 / 成色 → 标题 → 价格 → 地点 → 相对时间。
/// 「我的」范围里额外挂一个下架 / 重新上架按钮（[action]），
/// 这样不用点进详情也能管理自己的发布。
class FleaListingCard extends StatelessWidget {
  const FleaListingCard({
    required this.listing,
    required this.now,
    required this.onTap,
    this.action,
    super.key,
  });

  final FleaListing listing;

  /// 注入「现在」，相对时间可复现。
  final DateTime now;

  final VoidCallback onTap;

  /// 可选的尾部操作（「我的」里是下架 / 重新上架）。
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  FleaTag(
                      text: listing.category.label, tone: FleaTagTone.brand),
                  const SizedBox(width: KedaYaTokens.space1),
                  FleaTag(text: listing.condition.label),
                  const Spacer(),
                  Text(
                    describeFleaPostedAt(listing, now),
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                listing.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  height: KedaYaTokens.lineHeightNormal,
                  color: listing.active ? colors.text : colors.textMuted,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    formatFleaPrice(listing.priceFen),
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXl,
                      fontWeight: KedaYaTokens.fontWeightBold,
                      color: colors.brandStrong,
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: <Widget>[
                        Icon(
                          Icons.place_outlined,
                          size: 14,
                          color: colors.textMuted,
                        ),
                        const SizedBox(width: 2),
                        Flexible(
                          child: Text(
                            listing.location,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              fontSize: KedaYaTokens.fontSizeXs,
                              color: colors.textMuted,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (listing.isMine || !listing.active) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space2),
                Wrap(
                  spacing: KedaYaTokens.space1,
                  runSpacing: KedaYaTokens.space1,
                  children: <Widget>[
                    if (listing.isMine)
                      const FleaTag(
                        text: '我发布的',
                        tone: FleaTagTone.brand,
                        icon: Icons.person_outline,
                      ),
                    if (!listing.active)
                      const FleaTag(
                        text: '已下架',
                        tone: FleaTagTone.danger,
                        icon: Icons.visibility_off_outlined,
                      ),
                  ],
                ),
              ],
              if (action != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Align(alignment: Alignment.centerRight, child: action),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
