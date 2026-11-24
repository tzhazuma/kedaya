import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/campus_place.dart';
import 'package:kedaya/features/campus_map/application/campus_map_providers.dart';
import 'package:kedaya/features/campus_map/data/campus_place_seed.dart';

/// `campus-map` 的规则层测试。
///
/// 页面只是把筛选结果画出来，真正会出错的判定都在这里：
/// 分类叠加、关键词归一化、空结果、复制文案拼装。
void main() {
  List<String> ids(List<CampusPlace> places) =>
      places.map((CampusPlace place) => place.id).toList(growable: false);

  group('分类筛选', () {
    test('不传分类 = 全部，且保持种子顺序', () {
      expect(ids(filterCampusPlaces(campusPlaceSeed)), ids(campusPlaceSeed));
    });

    test('每个分类都只返回该分类的地点', () {
      for (final CampusPlaceCategory category in CampusPlaceCategory.values) {
        final List<CampusPlace> result =
            filterCampusPlaces(campusPlaceSeed, category: category);
        expect(
          result,
          isNotEmpty,
          reason: '「${category.label}」至少应有一个演示地点',
        );
        expect(
          result.every((CampusPlace place) => place.category == category),
          isTrue,
          reason: '「${category.label}」的结果里混进了其它分类',
        );
      }
    });

    test('分类与关键词是叠加条件，不是二选一', () {
      final List<CampusPlace> result = filterCampusPlaces(
        campusPlaceSeed,
        category: CampusPlaceCategory.teaching,
        query: '信息',
      );
      expect(ids(result), <String>['sist']);
    });
  });

  group('关键词搜索', () {
    test('按名称搜索', () {
      final List<CampusPlace> result =
          filterCampusPlaces(campusPlaceSeed, query: '生命科学与技术学院');
      expect(ids(result), <String>['slst']);
    });

    test('按别名搜索（忽略大小写）', () {
      expect(
        ids(filterCampusPlaces(campusPlaceSeed, query: 'SIST')),
        <String>['sist'],
      );
      expect(
        ids(filterCampusPlaces(campusPlaceSeed, query: 'sist')),
        <String>['sist'],
      );
      expect(
        ids(filterCampusPlaces(campusPlaceSeed, query: '一食堂')),
        <String>['canteen'],
      );
    });

    test('按楼栋号搜索，「1号楼」与「1 号楼」等价', () {
      final List<CampusPlace> withSpace =
          filterCampusPlaces(campusPlaceSeed, query: '1 号楼');
      final List<CampusPlace> withoutSpace =
          filterCampusPlaces(campusPlaceSeed, query: '1号楼');

      expect(
        ids(withSpace).toSet(),
        <String>{'sist', 'canteen', 'dorm-east'},
      );
      expect(ids(withoutSpace), ids(withSpace));
    });

    test('只搜名称 / 别名 / 楼栋，简介不参与', () {
      // 「取件码」只出现在快递站的简介里，搜到它说明匹配范围越界了。
      expect(
        filterCampusPlaces(campusPlaceSeed, query: '取件码'),
        isEmpty,
      );
    });

    test('空白关键词等价于不搜索', () {
      expect(
        ids(filterCampusPlaces(campusPlaceSeed, query: '   ')),
        ids(campusPlaceSeed),
      );
      expect(normalizeCampusPlaceQuery('  S I S T  '), 'sist');
    });
  });

  group('空结果', () {
    test('没有匹配的关键词返回空列表', () {
      expect(
        filterCampusPlaces(campusPlaceSeed, query: '不存在的地点 xyz'),
        isEmpty,
      );
    });

    test('分类与关键词互斥时返回空列表', () {
      expect(
        filterCampusPlaces(
          campusPlaceSeed,
          category: CampusPlaceCategory.dorm,
          query: '图书馆',
        ),
        isEmpty,
      );
    });

    test('provider 组合：筛选状态驱动列表，清空后回到全部', () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      expect(
        container.read(campusMapFilterProvider),
        const CampusMapFilter(),
      );

      container
          .read(campusMapFilterProvider.notifier)
          .selectCategory(CampusPlaceCategory.teaching);
      container.read(campusMapFilterProvider.notifier).setQuery('信息');
      expect(
        ids(container.read(filteredCampusPlacesProvider)),
        <String>['sist'],
      );

      container.read(campusMapFilterProvider.notifier).setQuery('不存在的地点 xyz');
      expect(container.read(filteredCampusPlacesProvider), isEmpty);

      container.read(campusMapFilterProvider.notifier).clear();
      expect(
        container.read(campusMapFilterProvider),
        const CampusMapFilter(),
      );
      expect(
        ids(container.read(filteredCampusPlacesProvider)),
        ids(campusPlaceSeed),
      );
    });
  });

  group('复制文案拼装', () {
    test('位置描述 = 名称（楼栋 · 楼层）', () {
      final CampusPlace library = campusPlaceById(campusPlaceSeed, 'library')!;
      expect(
        library.locationCopyText,
        '上海科技大学图书馆（图书馆主楼 · 2 层）',
      );
      expect(library.buildingAndFloor, '图书馆主楼 · 2 层');
      expect(library.walkSummary, '步行约 8 分钟到东门');
    });

    test('每个地点的位置描述都不同，避免复制后分不清', () {
      final Set<String> texts = campusPlaceSeed
          .map((CampusPlace place) => place.locationCopyText)
          .toSet();
      expect(texts.length, campusPlaceSeed.length);
    });

    test('坐标文案固定 6 位小数，可直接粘贴到地图 App', () {
      final CampusPlace library = campusPlaceById(campusPlaceSeed, 'library')!;
      expect(library.coordinatesCopyText, '31.179520, 121.598310');
      for (final CampusPlace place in campusPlaceSeed) {
        expect(
          place.coordinatesCopyText,
          matches(RegExp(r'^\d+\.\d{6}, \d+\.\d{6}$')),
          reason: '${place.name} 的坐标格式不能直接粘贴',
        );
      }
    });
  });

  group('种子目录', () {
    test('12–18 个地点，id 唯一', () {
      expect(campusPlaceSeed.length, inInclusiveRange(12, 18));
      expect(
        campusPlaceSeed.map((CampusPlace place) => place.id).toSet().length,
        campusPlaceSeed.length,
      );
    });

    test('每个地点都有列表与详情需要的字段', () {
      for (final CampusPlace place in campusPlaceSeed) {
        expect(place.name.trim(), isNotEmpty, reason: place.id);
        expect(place.building.trim(), isNotEmpty, reason: place.id);
        expect(place.floor.trim(), isNotEmpty, reason: place.id);
        expect(place.openingHours.trim(), isNotEmpty, reason: place.id);
        expect(place.nearestGate.trim(), isNotEmpty, reason: place.id);
        expect(place.walkMinutesToNearestGate, greaterThan(0),
            reason: place.id);
        expect(place.description.length, greaterThan(10), reason: place.id);
      }
    });

    test('坐标落在张江校区的演示范围内', () {
      for (final CampusPlace place in campusPlaceSeed) {
        expect(place.latitude, inInclusiveRange(31.1, 31.3),
            reason: '${place.id} 纬度越界');
        expect(place.longitude, inInclusiveRange(121.5, 121.7),
            reason: '${place.id} 经度越界');
      }
    });

    test('按 id 查不到时返回 null（详情页据此给空态）', () {
      expect(campusPlaceById(campusPlaceSeed, 'nope'), isNull);
    });
  });
}
