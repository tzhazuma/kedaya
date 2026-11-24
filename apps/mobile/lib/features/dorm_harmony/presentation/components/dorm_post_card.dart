import 'package:flutter/material.dart';

import '../../../../domain/models/dorm_post.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 楼栋筛选 chips（全部 + 5 个楼栋）。
class DormBuildingFilter extends StatelessWidget {
  const DormBuildingFilter({
    required this.selected,
    required this.onSelected,
    super.key,
  });

  /// `null` = 全部。
  final String? selected;

  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
        ),
        children: <Widget>[
          for (final String? building in <String?>[null, ...dormBuildings])
            Padding(
              padding: const EdgeInsets.only(right: KedaYaTokens.space2),
              child: ChoiceChip(
                label: Text(building ?? '全部'),
                selected: selected == building,
                onSelected: (bool _) => onSelected(building),
              ),
            ),
        ],
      ),
    );
  }
}

/// 列表卡片：楼栋、匿名代号、标题、摘要、回复数、时间。
class DormPostCard extends StatelessWidget {
  const DormPostCard({
    required this.post,
    required this.now,
    this.onTap,
    super.key,
  });

  final DormPost post;
  final DateTime now;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      post.alias,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: KedaYaTokens.fontWeightMedium,
                        color: colors.brandStrong,
                      ),
                    ),
                  ),
                  Text(
                    formatDormTime(post.createdAt, now),
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                post.title,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                post.excerpt,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Row(
                children: <Widget>[
                  Icon(
                    Icons.apartment_outlined,
                    size: 14,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 2),
                  Text(
                    post.building,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space3),
                  Icon(
                    Icons.chat_bubble_outline,
                    size: 14,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 2),
                  Text(
                    '${post.replyCount} 条回复',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: colors.textMuted,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `刚刚` / `30 分钟前` / `2 小时前` / `昨天 14:30`。
String formatDormTime(DateTime value, DateTime now) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final DateTime localNow = now.isUtc ? now.toLocal() : now;
  final Duration diff = localNow.difference(local);
  if (diff.inMinutes < 1) return '刚刚';
  if (diff.inHours < 1) return '${diff.inMinutes} 分钟前';
  if (diff.inHours < 24) return '${diff.inHours} 小时前';
  if (diff.inDays < 7) return '${diff.inDays} 天前';
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.month}月${local.day}日 $hour:$minute';
}
