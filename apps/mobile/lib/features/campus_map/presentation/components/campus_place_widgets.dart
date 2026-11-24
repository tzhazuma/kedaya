import 'package:flutter/material.dart';

import '../../../../domain/models/campus_place.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 顶部说明卡：**必须让用户知道这不是地图**。
///
/// 产品要求这句话原样可见，因此文案集中在这里，列表页与详情页共用，
/// 不会出现两处措辞不一致。
class CampusPlaceMapNotice extends StatelessWidget {
  const CampusPlaceMapNotice({super.key});

  static const String title = '校园地点目录（演示）';

  static const String body = '未接入腾讯/高德 SDK，当前是地点目录；坐标仅演示，'
      '开放时间与步行分钟数也是演示值。'
      '「在地图中打开」只会复制坐标，粘贴到任意地图 App 即可，App 内不显示底图。';

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.map_outlined, size: 18, color: colors.brandStrong),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  body,
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

/// 分类标签（列表卡片与详情页共用）。
class CampusPlaceCategoryBadge extends StatelessWidget {
  const CampusPlaceCategoryBadge({required this.category, super.key});

  final CampusPlaceCategory category;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = switch (category) {
      CampusPlaceCategory.teaching => colors.info,
      CampusPlaceCategory.dining => colors.warning,
      CampusPlaceCategory.sports => colors.success,
      CampusPlaceCategory.service => colors.brandStrong,
      // dorm 用中性灰：`inkSoft` 在暗色主题下本身就是深色，拿它当标签色
      // 会得到「深色字 + 深色底」。
      CampusPlaceCategory.dorm => colors.textMuted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.35)),
      ),
      child: Text(
        category.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: tone,
        ),
      ),
    );
  }
}

/// 「图标 + 一行说明」——列表卡片和详情页的信息行。
class CampusPlaceInfoRow extends StatelessWidget {
  const CampusPlaceInfoRow({
    required this.icon,
    required this.text,
    this.iconColor,
    super.key,
  });

  final IconData icon;
  final String text;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(icon, size: 16, color: iconColor ?? colors.textMuted),
        const SizedBox(width: KedaYaTokens.space2),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}

/// 列表卡片：名称、分类、楼栋/楼层、开放时间、到最近校门的步行分钟数。
class CampusPlaceCard extends StatelessWidget {
  const CampusPlaceCard({
    required this.place,
    this.onTap,
    super.key,
  });

  final CampusPlace place;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final BorderRadius radius = BorderRadius.circular(KedaYaTokens.radiusLg);
    return Material(
      color: colors.surface,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      place.name,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  CampusPlaceCategoryBadge(category: place.category),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              CampusPlaceInfoRow(
                icon: Icons.location_on_outlined,
                text: place.buildingAndFloor,
              ),
              const SizedBox(height: KedaYaTokens.space1),
              CampusPlaceInfoRow(
                icon: Icons.schedule,
                text: place.openingHours,
              ),
              const SizedBox(height: KedaYaTokens.space1),
              CampusPlaceInfoRow(
                icon: Icons.directions_walk,
                text: '${place.walkSummary}（演示）',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
