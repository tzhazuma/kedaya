import 'package:flutter/material.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 菜品搜索框（菜品库与「记一餐」共用）。
class CanteenSearchField extends StatelessWidget {
  const CanteenSearchField({
    required this.controller,
    required this.onChanged,
    this.hintText = '搜索菜名',
    super.key,
  });

  final TextEditingController controller;

  /// 文本变化时通知父级 `setState`（本组件不持有筛选状态）。
  final VoidCallback onChanged;

  final String hintText;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final OutlineInputBorder border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
      borderSide: BorderSide(color: colors.border),
    );
    return TextField(
      controller: controller,
      onChanged: (_) => onChanged(),
      textInputAction: TextInputAction.search,
      style: TextStyle(
        fontSize: KedaYaTokens.fontSizeSm,
        color: colors.text,
      ),
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          color: colors.textMuted,
        ),
        prefixIcon: Icon(
          Icons.search,
          size: KedaYaTokens.fontSizeXl,
          color: colors.textMuted,
        ),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: '清空搜索',
                onPressed: () {
                  controller.clear();
                  onChanged();
                },
                icon: Icon(
                  Icons.close,
                  size: KedaYaTokens.fontSizeLg,
                  color: colors.textMuted,
                ),
              ),
        filled: true,
        fillColor: colors.surface,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: BorderSide(color: colors.brandStrong, width: 1.5),
        ),
      ),
    );
  }
}

/// 食堂 + 品类单选的横向 chips。
///
/// 两个维度都是「单选 + 全部」，与关键词一起构成**叠加**条件；
/// 这里只负责把选择传出去，真正的过滤在 `filterCanteenDishes`。
class CanteenFilterChips extends StatelessWidget {
  const CanteenFilterChips({
    required this.selectedCanteen,
    required this.selectedCategory,
    required this.onCanteenChanged,
    required this.onCategoryChanged,
    super.key,
  });

  final CanteenName? selectedCanteen;
  final DishCategory? selectedCategory;
  final ValueChanged<CanteenName?> onCanteenChanged;
  final ValueChanged<DishCategory?> onCategoryChanged;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    Widget chip(String label, bool selected, VoidCallback onTap) {
      return ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => onTap(),
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.padded,
        backgroundColor: colors.surface,
        selectedColor: colors.brandSoft,
        side: BorderSide(
          color: selected ? colors.brandStrong : colors.border,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        ),
        labelStyle: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: selected
              ? KedaYaTokens.fontWeightSemibold
              : KedaYaTokens.fontWeightRegular,
          color: colors.text,
        ),
      );
    }

    Widget row(String label, List<Widget> chips) {
      return Row(
        children: <Widget>[
          SizedBox(
            width: KedaYaTokens.space10,
            child: Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: <Widget>[
                  for (int i = 0; i < chips.length; i++) ...<Widget>[
                    if (i > 0) const SizedBox(width: KedaYaTokens.space2),
                    chips[i],
                  ],
                ],
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        row('食堂', <Widget>[
          chip('全部', selectedCanteen == null, () => onCanteenChanged(null)),
          for (final CanteenName name in CanteenName.values)
            chip(
              name.label,
              selectedCanteen == name,
              () => onCanteenChanged(name),
            ),
        ]),
        const SizedBox(height: KedaYaTokens.space1),
        row('品类', <Widget>[
          chip('全部', selectedCategory == null,
              () => onCategoryChanged(null)),
          for (final DishCategory category in DishCategory.values)
            chip(
              category.label,
              selectedCategory == category,
              () => onCategoryChanged(category),
            ),
        ]),
      ],
    );
  }
}
