import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/campus_place.dart';
import '../data/campus_place_seed.dart';

/// 分类 + 关键词筛选条件。
///
/// 两个条件**叠加**，与 `filterCampusPlaces` 的参数一一对应：
/// [category] 为 `null` 表示「全部」，[query] 为空表示不搜索。
/// 把筛选条件单独成对象，是为了让「清空」只有一个入口，不会漏掉其中一个。
final class CampusMapFilter {
  const CampusMapFilter({this.category, this.query = ''});

  /// `null` = 全部分类。
  final CampusPlaceCategory? category;

  final String query;

  /// 是否处于筛选状态（决定列表上方显示「共 N 个」还是「筛出 N 个」）。
  bool get isActive => category != null || query.trim().isNotEmpty;

  CampusMapFilter withCategory(CampusPlaceCategory? next) =>
      CampusMapFilter(category: next, query: query);

  CampusMapFilter withQuery(String next) =>
      CampusMapFilter(category: category, query: next);

  @override
  bool operator ==(Object other) =>
      other is CampusMapFilter &&
      other.category == category &&
      other.query == query;

  @override
  int get hashCode => Object.hash(category, query);

  @override
  String toString() => 'CampusMapFilter(category=$category, query="$query")';
}

/// 分类 chip 与搜索框共用的筛选状态。
final campusMapFilterProvider =
    NotifierProvider<CampusMapFilterNotifier, CampusMapFilter>(
  CampusMapFilterNotifier.new,
);

final class CampusMapFilterNotifier extends Notifier<CampusMapFilter> {
  @override
  CampusMapFilter build() => const CampusMapFilter();

  void selectCategory(CampusPlaceCategory? category) =>
      state = state.withCategory(category);

  void setQuery(String query) => state = state.withQuery(query);

  void clear() => state = const CampusMapFilter();
}

/// 地点目录（编译期种子）。
///
/// 本模块**没有后端端点**，也没有地图 SDK，因此这里刻意不经过 Port：
/// 没有异步、没有失败分支，页面不需要三态。将来接真实数据时，把 provider
/// 换成 `FutureProvider` 即可，页面的筛选逻辑不用动。
final campusPlacesProvider = Provider<List<CampusPlace>>(
  (ref) => campusPlaceSeed,
);

/// 应用分类 + 关键词后的列表。
final filteredCampusPlacesProvider = Provider<List<CampusPlace>>((ref) {
  final CampusMapFilter filter = ref.watch(campusMapFilterProvider);
  final List<CampusPlace> places = ref.watch(campusPlacesProvider);
  return filterCampusPlaces(
    places,
    category: filter.category,
    query: filter.query,
  );
});

/// 详情页按 id 读取；找不到返回 `null`。
final campusPlaceByIdProvider =
    Provider.family<CampusPlace?, String>((ref, String id) {
  final List<CampusPlace> places = ref.watch(campusPlacesProvider);
  return campusPlaceById(places, id);
});
