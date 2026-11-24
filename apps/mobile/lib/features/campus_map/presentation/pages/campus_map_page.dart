import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/campus_place.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/campus_map_providers.dart';
import '../../campus_map_routes.dart';
import '../components/campus_place_widgets.dart';

/// 校园地点目录（`/campus-map`）。
///
/// 三个固定约束：
///   1. **不是地图** —— 顶部常驻说明卡写明未接入地图 SDK、坐标仅演示；
///   2. **筛选是叠加的** —— 分类 chip 与搜索框同时生效（`filterCampusPlaces`）；
///   3. **空结果不是错误** —— 说明怎么回到全部地点，而不是只显示"暂无数据"。
class CampusMapPage extends ConsumerStatefulWidget {
  const CampusMapPage({super.key});

  @override
  ConsumerState<CampusMapPage> createState() => _CampusMapPageState();
}

class _CampusMapPageState extends ConsumerState<CampusMapPage> {
  late final TextEditingController _searchController;

  @override
  void initState() {
    super.initState();
    // 允许外部（测试 / 深链）预先设置关键词；正常启动时是空串。
    _searchController = TextEditingController(
      text: ref.read(campusMapFilterProvider).query,
    );
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _setQuery(String value) {
    ref.read(campusMapFilterProvider.notifier).setQuery(value);
  }

  /// 搜索框的 ×：只清关键词，保留已选分类。
  void _clearQuery() {
    _searchController.clear();
    ref.read(campusMapFilterProvider.notifier).setQuery('');
  }

  /// 「清空筛选」：分类与关键词一起回到初始状态。
  void _clearFilters() {
    _searchController.clear();
    ref.read(campusMapFilterProvider.notifier).clear();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final CampusMapFilter filter = ref.watch(campusMapFilterProvider);
    final List<CampusPlace> places = ref.watch(filteredCampusPlacesProvider);

    // 整页一个 ListView：键盘弹出时不会因为「固定头部 + Expanded」而溢出，
    // 17 条演示数据的规模也不需要懒加载。
    return KedaYaPageScaffold(
      title: '校园地点',
      child: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space6),
        children: <Widget>[
          const CampusPlaceMapNotice(),
          const SizedBox(height: KedaYaTokens.space3),
          _buildSearchField(colors, filter),
          const SizedBox(height: KedaYaTokens.space3),
          SizedBox(
            height: KedaYaTokens.space12,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: <Widget>[
                _CategoryChip(
                  label: '全部',
                  selected: filter.category == null,
                  onSelected: (bool _) => ref
                      .read(campusMapFilterProvider.notifier)
                      .selectCategory(null),
                ),
                for (final CampusPlaceCategory category
                    in CampusPlaceCategory.values)
                  _CategoryChip(
                    label: category.label,
                    selected: filter.category == category,
                    onSelected: (bool selected) => ref
                        .read(campusMapFilterProvider.notifier)
                        .selectCategory(selected ? category : null),
                  ),
              ],
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  filter.isActive
                      ? '筛出 ${places.length} 个地点'
                      : '共 ${places.length} 个地点',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ),
              if (filter.isActive)
                TextButton(
                  onPressed: _clearFilters,
                  child: const Text('清空筛选'),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          if (places.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: KedaYaTokens.space6),
              child: KedaYaEmptyState(
                title: '没有匹配的地点',
                description: '试试换一个关键词（名称、别名或楼栋号），'
                    '或点「全部」看看所有地点。',
                icon: Icons.location_off_outlined,
                onRetry: filter.isActive ? _clearFilters : null,
                retryLabel: '清空筛选',
              ),
            )
          else
            for (final (int index, CampusPlace place)
                in places.indexed) ...<Widget>[
              if (index > 0) const SizedBox(height: KedaYaTokens.space3),
              CampusPlaceCard(
                place: place,
                onTap: () => context.push(
                  CampusMapRoutes.detail(place.id),
                ),
              ),
            ],
        ],
      ),
    );
  }

  Widget _buildSearchField(KedaYaColors colors, CampusMapFilter filter) {
    final BorderRadius radius = BorderRadius.circular(KedaYaTokens.radiusMd);
    OutlineInputBorder border(Color color, {double width = 1}) =>
        OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: color, width: width),
        );

    return TextField(
      controller: _searchController,
      onChanged: _setQuery,
      onSubmitted: (String _) => FocusScope.of(context).unfocus(),
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: '搜索名称、别名或楼栋号',
        prefixIcon: const Icon(Icons.search, size: 20),
        suffixIcon: filter.query.isEmpty
            ? null
            : IconButton(
                tooltip: '清空搜索',
                icon: const Icon(Icons.clear, size: 20),
                onPressed: _clearQuery,
              ),
        filled: true,
        fillColor: colors.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          vertical: KedaYaTokens.space3,
        ),
        enabledBorder: border(colors.border),
        focusedBorder: border(colors.brandStrong, width: 1.5),
      ),
    );
  }
}

/// 分类 chip（「全部」用 `null` 表示）。
///
/// 样式与 `faq` 的分类条一致：选中时鸭黄底 + 品牌色文字，未选中时浅灰底。
/// 再次点击已选中的分类会回到「全部」（`selected == false`）。
class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.only(right: KedaYaTokens.space2),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: onSelected,
        showCheckmark: false,
        backgroundColor: colors.surfaceAlt,
        selectedColor: colors.brandSoft,
        side: BorderSide(color: colors.border),
        labelStyle: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          fontWeight: selected
              ? KedaYaTokens.fontWeightSemibold
              : KedaYaTokens.fontWeightRegular,
          color: selected ? colors.brandStrong : colors.textMuted,
        ),
      ),
    );
  }
}
