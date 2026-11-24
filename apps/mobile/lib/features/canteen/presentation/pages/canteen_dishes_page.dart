import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/canteen_providers.dart';
import '../../domain/canteen_rules.dart';
import '../components/canteen_disclaimer.dart';
import '../components/canteen_dish_tile.dart';
import '../components/canteen_filters.dart';

/// 菜品库：食堂 chips + 品类 chips + 菜名搜索，三者**叠加**。
///
/// 页面只做展示与筛选，不在 widget 里复制过滤规则 —— 规则在
/// `filterCanteenDishes`，单测直接覆盖它。
class CanteenDishesPage extends ConsumerStatefulWidget {
  const CanteenDishesPage({super.key});

  @override
  ConsumerState<CanteenDishesPage> createState() => _CanteenDishesPageState();
}

class _CanteenDishesPageState extends ConsumerState<CanteenDishesPage> {
  final TextEditingController _search = TextEditingController();
  CanteenName? _canteen;
  DishCategory? _category;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _reset() {
    _search.clear();
    setState(() {
      _canteen = null;
      _category = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final List<CanteenDish> dishes = ref.watch(canteenDishesProvider);
    final DishQuery query = DishQuery(
      canteen: _canteen,
      category: _category,
      keyword: _search.text,
    );
    final List<CanteenDish> filtered = filterCanteenDishes(dishes, query);

    return KedaYaPageScaffold(
      title: '菜品库',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        if (!query.isEmpty)
          TextButton(
            onPressed: _reset,
            style: TextButton.styleFrom(foregroundColor: colors.text),
            child: const Text('清空筛选'),
          ),
      ],
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              KedaYaTokens.space2,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                CanteenSearchField(
                  controller: _search,
                  onChanged: () => setState(() {}),
                  hintText: '搜索菜名（如：鸡、面、汤）',
                ),
                const SizedBox(height: KedaYaTokens.space2),
                CanteenFilterChips(
                  selectedCanteen: _canteen,
                  selectedCategory: _category,
                  onCanteenChanged: (CanteenName? value) =>
                      setState(() => _canteen = value),
                  onCategoryChanged: (DishCategory? value) =>
                      setState(() => _category = value),
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Row(
                  children: <Widget>[
                    Text(
                      '共 ${filtered.length} 个菜品',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: KedaYaTokens.fontWeightMedium,
                        color: colors.text,
                      ),
                    ),
                    const Spacer(),
                    Expanded(
                      child: Text(
                        '食堂 + 品类 + 关键词叠加生效',
                        textAlign: TextAlign.right,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space2),
                const CanteenNutritionNotice(showDetail: false),
              ],
            ),
          ),
          Expanded(
            child: filtered.isEmpty
                ? KedaYaEmptyState(
                    title: '没有符合条件的菜品',
                    description: _emptyDescription(),
                    icon: Icons.search_off,
                    onRetry: _reset,
                    retryLabel: '清空筛选',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      KedaYaTokens.space4,
                      KedaYaTokens.space2,
                      KedaYaTokens.space4,
                      KedaYaTokens.space6,
                    ),
                    itemCount: filtered.length,
                    separatorBuilder:
                        (BuildContext context, int index) =>
                            const SizedBox(height: KedaYaTokens.space2),
                    itemBuilder: (BuildContext context, int index) =>
                        CanteenDishTile(dish: filtered[index]),
                  ),
          ),
        ],
      ),
    );
  }

  String _emptyDescription() {
    final String canteen = _canteen?.label ?? '全部食堂';
    final String category = _category?.label ?? '全部品类';
    final String keyword = _search.text.trim();
    return '当前是「$canteen · $category」'
        '${keyword.isEmpty ? '' : '，关键词「$keyword」'}。'
        '三个条件是叠加的，试试去掉一个再找。';
  }
}
