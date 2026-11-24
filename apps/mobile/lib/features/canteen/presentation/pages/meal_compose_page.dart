import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/canteen_dish.dart';
import '../../../../domain/models/meal_record.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/canteen_providers.dart';
import '../../canteen_routes.dart';
import '../../domain/canteen_rules.dart';
import '../components/canteen_disclaimer.dart';
import '../components/canteen_dish_tile.dart';
import '../components/canteen_filters.dart';

/// 记一餐：选餐次 → 搜索/筛选菜品 → 加入并调份数 → 底部实时合计 → 保存。
///
/// 「保存」只写本机记录；成功提示会写明未上传，不伪造服务端回执。
class MealComposePage extends ConsumerStatefulWidget {
  const MealComposePage({super.key});

  @override
  ConsumerState<MealComposePage> createState() => _MealComposePageState();
}

class _MealComposePageState extends ConsumerState<MealComposePage> {
  final TextEditingController _search = TextEditingController();
  final List<_PickedDish> _picked = <_PickedDish>[];

  MealSlot _slot = MealSlot.lunch;
  CanteenName? _canteen;
  DishCategory? _category;

  @override
  void initState() {
    super.initState();
    _slot = MealSlot.suggestedAt(ref.read(canteenClockProvider)());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _addDish(CanteenDish dish) {
    setState(() {
      final int index =
          _picked.indexWhere((_PickedDish item) => item.dish.id == dish.id);
      if (index < 0) {
        _picked.add(_PickedDish(dish: dish, servings: 1));
        return;
      }
      final _PickedDish current = _picked[index];
      _picked[index] = current.copyWith(
        servings: (current.servings + 1).clamp(0.5, 9.5),
      );
    });
  }

  void _changeServings(int index, double delta) {
    setState(() {
      final _PickedDish current = _picked[index];
      _picked[index] = current.copyWith(
        servings: (current.servings + delta).clamp(0.5, 9.5),
      );
    });
  }

  void _removeDish(int index) {
    setState(() => _picked.removeAt(index));
  }

  void _save() {
    if (_picked.isEmpty) {
      _showMessage('还没有加入菜品，空餐次不能保存');
      return;
    }
    final List<MealEntry> entries = _picked
        .map((_PickedDish item) => MealEntry(
              dishId: item.dish.id,
              dishName: item.dish.name,
              servings: item.servings,
              nutritionPerServing: item.dish.nutrition,
            ))
        .toList(growable: false);
    try {
      final MealRecord record = ref
          .read(mealRecordsControllerProvider.notifier)
          .addMeal(slot: _slot, entries: entries);
      _showMessage(
        '已记入今日${_slot.label}：${record.entries.length} 个菜品，'
        '共 ${record.total.kcal} kcal。记录保存在本机，未上传。',
      );
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(CanteenRoutes.home);
      }
    } on MealDraftException catch (error) {
      _showMessage(error.message);
    } on Object catch (error) {
      _showMessage('没有保存成功：$error');
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
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
    final List<CanteenDish> available = filterCanteenDishes(dishes, query)
        .where((CanteenDish dish) =>
            !_picked.any((_PickedDish item) => item.dish.id == dish.id))
        .toList(growable: false);
    final NutritionFacts total = _picked.fold(
      NutritionFacts.zero,
      (NutritionFacts sum, _PickedDish item) =>
          sum + item.dish.nutrition.scaled(item.servings),
    );

    return KedaYaPageScaffold(
      title: '记一餐',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                KedaYaTokens.space6,
              ),
              children: <Widget>[
                const CanteenNutritionNotice(showDetail: false),
                const SizedBox(height: KedaYaTokens.space4),
                const _SectionLabel('餐次'),
                const SizedBox(height: KedaYaTokens.space2),
                SegmentedButton<MealSlot>(
                  segments: <ButtonSegment<MealSlot>>[
                    for (final MealSlot slot in MealSlot.values)
                      ButtonSegment<MealSlot>(
                        value: slot,
                        label: Text(slot.label),
                      ),
                  ],
                  selected: <MealSlot>{_slot},
                  showSelectedIcon: false,
                  style: const ButtonStyle(
                    visualDensity: VisualDensity.compact,
                    padding: WidgetStatePropertyAll<EdgeInsets>(
                      EdgeInsets.symmetric(
                        horizontal: KedaYaTokens.space2,
                      ),
                    ),
                  ),
                  onSelectionChanged: (Set<MealSlot> selection) =>
                      setState(() => _slot = selection.first),
                ),
                const SizedBox(height: KedaYaTokens.space4),
                const _SectionLabel('选菜品'),
                const SizedBox(height: KedaYaTokens.space2),
                CanteenSearchField(
                  controller: _search,
                  onChanged: () => setState(() {}),
                  hintText: '搜索菜名后点「加入」',
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
                const SizedBox(height: KedaYaTokens.space4),
                _SectionLabel(
                  '已加入（${_picked.length} 个菜品）',
                  caption: _picked.isEmpty ? '至少加入一个才能保存' : '可调整份数',
                ),
                const SizedBox(height: KedaYaTokens.space2),
                if (_picked.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(KedaYaTokens.space3),
                      child: Text(
                        '还没有加菜品。可以在下面筛选，也可以点整行加入；'
                        '已加入的菜品会在上方显示实时合计。',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  )
                else
                  Card(
                    child: Column(
                      children: <Widget>[
                        for (int i = 0; i < _picked.length; i++) ...<Widget>[
                          if (i > 0)
                            const Divider(
                              height: 1,
                              indent: KedaYaTokens.space3,
                              endIndent: KedaYaTokens.space3,
                            ),
                          _PickedDishRow(
                            item: _picked[i],
                            onDecrease: () => _changeServings(i, -0.5),
                            onIncrease: () => _changeServings(i, 0.5),
                            onRemove: () => _removeDish(i),
                          ),
                        ],
                      ],
                    ),
                  ),
                const SizedBox(height: KedaYaTokens.space4),
                _SectionLabel(
                  '可添加菜品（${available.length}）',
                  caption: query.isEmpty ? '全部菜品' : '当前筛选结果',
                ),
                const SizedBox(height: KedaYaTokens.space2),
                if (available.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(KedaYaTokens.space3),
                      child: Text(
                        _picked.isEmpty
                            ? '没有符合条件的菜品。试试清空搜索，或换一个食堂/品类。'
                            : '当前条件下能加的菜都已经加入，可以在上方调整份数。',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  )
                else
                  for (int i = 0; i < available.length; i++) ...<Widget>[
                    if (i > 0) const SizedBox(height: KedaYaTokens.space2),
                    CanteenDishTile(
                      dish: available[i],
                      onTap: () => _addDish(available[i]),
                      trailing: IconButton.filledTonal(
                        tooltip: '加入 ${available[i].name}',
                        onPressed: () => _addDish(available[i]),
                        icon: const Icon(Icons.add),
                      ),
                    ),
                  ],
              ],
            ),
          ),
          _ComposeTotalBar(
            total: total,
            canSave: _picked.isNotEmpty,
            onSave: _save,
          ),
        ],
      ),
    );
  }
}

class _PickedDish {
  const _PickedDish({required this.dish, required this.servings});

  final CanteenDish dish;
  final double servings;

  _PickedDish copyWith({double? servings}) =>
      _PickedDish(dish: dish, servings: servings ?? this.servings);

  String get servingsLabel => formatCanteenServings(servings);

  NutritionFacts get total => dish.nutrition.scaled(servings);
}

class _PickedDishRow extends StatelessWidget {
  const _PickedDishRow({
    required this.item,
    required this.onDecrease,
    required this.onIncrease,
    required this.onRemove,
  });

  final _PickedDish item;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final NutritionFacts total = item.total;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        KedaYaTokens.space3,
        KedaYaTokens.space1,
        KedaYaTokens.space1,
        KedaYaTokens.space1,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.dish.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                Text(
                  '${item.dish.canteen.label} · ${total.kcal} kcal · '
                  '钠 ${total.sodiumMg} mg',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: '减少半份',
            visualDensity: VisualDensity.compact,
            onPressed: onDecrease,
            icon: Icon(
              Icons.remove_circle_outline,
              color: colors.textMuted,
            ),
          ),
          SizedBox(
            width: KedaYaTokens.space8,
            child: Text(
              item.servingsLabel,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
          ),
          IconButton(
            tooltip: '增加半份',
            visualDensity: VisualDensity.compact,
            onPressed: onIncrease,
            icon: Icon(
              Icons.add_circle_outline,
              color: colors.textMuted,
            ),
          ),
          IconButton(
            tooltip: '移除 ${item.dish.name}',
            visualDensity: VisualDensity.compact,
            onPressed: onRemove,
            icon: Icon(Icons.close, color: colors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _ComposeTotalBar extends StatelessWidget {
  const _ComposeTotalBar({
    required this.total,
    required this.canSave,
    required this.onSave,
  });

  final NutritionFacts total;
  final bool canSave;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(
        KedaYaTokens.space4,
        KedaYaTokens.space2,
        KedaYaTokens.space4,
        KedaYaTokens.space2,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '合计 ${total.kcal} kcal',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightBold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  canSave
                      ? '蛋白 ${total.proteinG} g · 脂肪 ${total.fatG} g · '
                          '碳水 ${total.carbsG} g · 钠 ${total.sodiumMg} mg'
                      : '先加入至少一个菜品才能保存',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: KedaYaTokens.space3),
          FilledButton(
            onPressed: canSave ? onSave : null,
            child: const Text('保存到今日'),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.title, {this.caption});

  final String title;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        if (caption != null) ...<Widget>[
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              caption!,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ],
    );
  }
}
