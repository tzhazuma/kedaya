import 'package:flutter/material.dart';

import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 物种筛选 chip 行（地图页与观测列表共用同一个筛选状态）。
class WildlifeSpeciesFilterBar extends StatelessWidget {
  const WildlifeSpeciesFilterBar({
    required this.species,
    required this.selectedSpeciesId,
    required this.onSelected,
    super.key,
  });

  final List<WildlifeSpecies> species;
  final String? selectedSpeciesId;

  /// 传 null 表示"全部物种"。
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: KedaYaTokens.space4),
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: KedaYaTokens.space2),
            child: ChoiceChip(
              label: const Text('全部'),
              selected: selectedSpeciesId == null,
              onSelected: (bool _) => onSelected(null),
            ),
          ),
          for (final WildlifeSpecies item in species)
            Padding(
              padding: const EdgeInsets.only(right: KedaYaTokens.space2),
              child: ChoiceChip(
                label: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(item.displayName),
                    if (item.isProtected) ...<Widget>[
                      const SizedBox(width: KedaYaTokens.space1),
                      Icon(Icons.shield_outlined, size: 13, color: colors.danger),
                    ],
                  ],
                ),
                selected: selectedSpeciesId == item.id,
                onSelected: (bool selected) => onSelected(selected ? item.id : null),
              ),
            ),
        ],
      ),
    );
  }
}

/// 物种选择列表（上报表单里的单选，含投喂政策与保护状态）。
class WildlifeSpeciesPicker extends StatelessWidget {
  const WildlifeSpeciesPicker({
    required this.species,
    required this.selectedSpeciesId,
    required this.onSelected,
    this.suggestionId,
    super.key,
  });

  final List<WildlifeSpecies> species;
  final String? selectedSpeciesId;
  final ValueChanged<String> onSelected;

  /// 自动分类的 top-1（高亮提示"请确认"）。
  final String? suggestionId;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (final WildlifeSpecies item in species)
          RadioListTile<String>(
            value: item.id,
            groupValue: selectedSpeciesId,
            onChanged: (String? value) {
              if (value != null) onSelected(value);
            },
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Row(
              children: <Widget>[
                Text(
                  item.displayName,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: colors.text,
                    fontWeight: item.id == suggestionId
                        ? KedaYaTokens.fontWeightSemibold
                        : KedaYaTokens.fontWeightRegular,
                  ),
                ),
                if (item.isProtected) ...<Widget>[
                  const SizedBox(width: KedaYaTokens.space1),
                  Icon(Icons.shield_outlined, size: 14, color: colors.danger),
                ],
                if (item.id == suggestionId) ...<Widget>[
                  const SizedBox(width: KedaYaTokens.space2),
                  Text(
                    '自动建议',
                    style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.info),
                  ),
                ],
              ],
            ),
            subtitle: Text(
              '${item.scientificName} · ${item.defaultFeedingPolicy.label}'
              '${item.isNestingSensitive ? ' · 繁殖期敏感' : ''}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ),
      ],
    );
  }
}
