import 'package:flutter/material.dart';

import '../../../../domain/models/campus_portrait.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'portrait_tag_tile.dart';

/// 标签示例（演示数据）。
///
/// 这是**静态文案示例**，不是任何人的画像，也不会写入本机；
/// 页面用它说明「标签长什么样、来源如何标注」，不据此推断用户。
List<PortraitTag> buildDemoPortraitTags() => <PortraitTag>[
      PortraitTag(
        label: '作息偏晚',
        source: '校园网登录',
        updatedAt: DateTime(2026, 11, 18, 9),
      ),
      PortraitTag(
        label: '常去图书馆',
        source: '图书馆门禁',
        updatedAt: DateTime(2026, 11, 20, 9),
      ),
      PortraitTag(
        label: '偏好在二食堂就餐',
        source: '校园卡消费',
        updatedAt: DateTime(2026, 11, 19, 9),
      ),
      PortraitTag(
        label: '社团活跃',
        source: '社团活动',
        updatedAt: DateTime(2026, 11, 16, 9),
      ),
    ];

/// 展示标签格式的演示卡（整体标注「演示数据」）。
class PortraitDemoPreview extends StatelessWidget {
  const PortraitDemoPreview({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final List<PortraitTag> tags = buildDemoPortraitTags();
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '标签示例（演示数据）',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: KedaYaTokens.space2,
                  vertical: KedaYaTokens.space1,
                ),
                decoration: BoxDecoration(
                  color: colors.warning.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
                ),
                child: Text(
                  '演示数据',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: colors.warning,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '这不是你的画像，只是标签格式示例；不会写入本机，'
            '也不会根据你的行为生成或推断标签。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          for (int index = 0; index < tags.length; index++) ...<Widget>[
            if (index > 0) const SizedBox(height: KedaYaTokens.space2),
            PortraitTagTile(tag: tags[index], dense: true),
          ],
        ],
      ),
    );
  }
}
