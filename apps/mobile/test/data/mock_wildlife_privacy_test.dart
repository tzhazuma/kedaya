import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/data/mock/mock_wildlife_repository.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';

/// 隐私边界的**行为**测试（规格 §9 / §11.2 T10 / T15 / T24）。
///
/// 规格 §9.1 把敌手写得很具体：好奇的同学、跟踪者、爬虫、EXIF 读取者、内部人员。
/// mock 扮演**服务端**，因此"客户端能观察到什么"由它决定 ——
/// 这些断言就是"客户端拿不到精确坐标"的证据。
void main() {
  MockWildlifeRepository buildRepository() => MockWildlifeRepository(
    controls: MockControls(latency: Duration.zero),
    now: mockNow,
  );

  const Wgs84Point exactPoint = Wgs84Point(lat: 31.17855, lng: 121.59010);

  WildlifeSightingDraft draft({String? zoneId}) => WildlifeSightingDraft(
    speciesId: mockSpeciesCat,
    observedAt: mockNow.subtract(const Duration(hours: 2)),
    geo: exactPoint,
    zoneId: zoneId,
    ethicsAcknowledged: true,
  );

  group('位置模糊化（规格 §9.3 ②）', () {
    test('返回的坐标**不等于**上报的精确坐标（网格吸附到 50 m）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting created = (await repository.createSighting(draft())).unwrap;
      expect(created.geo, isNotNull);
      expect(created.geo, isNot(exactPoint));

      // 偏移量必须在一个格子以内（50 m），且确实被移动过。
      final double offset = CampusProjection.campus.metersBetween(exactPoint, created.geo!);
      expect(offset, greaterThan(0));
      expect(offset, lessThanOrEqualTo(defaultFuzzRadiusM.toDouble()));
    });

    test('吸附后的坐标落在 50 m 网格上（确定性，可复现）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting first = (await repository.createSighting(draft())).unwrap;
      final WildlifeSighting second = (await repository.createSighting(draft())).unwrap;
      // 同一个输入 → 同一个模糊点（不是每次随机）。
      expect(second.geo, first.geo);

      final LocalMeters meters = CampusProjection.campus.toLocalMeters(first.geo!);
      final double snappedX = (meters.x / defaultFuzzRadiusM).roundToDouble() * defaultFuzzRadiusM;
      final double snappedY = (meters.y / defaultFuzzRadiusM).roundToDouble() * defaultFuzzRadiusM;
      expect((meters.x - snappedX).abs(), lessThan(1e-6));
      expect((meters.y - snappedY).abs(), lessThan(1e-6));
    });

    test('时间粗化到小时（普通区域，规格 §9.5）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final DateTime observedAt = DateTime.utc(2026, 10, 16, 9, 37, 12);
      final WildlifeSighting created = (await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: observedAt,
          geo: exactPoint,
          ethicsAcknowledged: true,
        ),
      )).unwrap;
      expect(created.observedAt, observedAt, reason: '上报人自己看得到精确时间');
      expect(created.observedAtFuzzed, DateTime.utc(2026, 10, 16, 9));
    });
  });

  group('敏感区：只给区域，不给任何坐标（规格 §9.3 ① / T10）', () {
    test('敏感区的观测 geo 为 null，时间粗化到天', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting created = (await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: DateTime.utc(2026, 10, 16, 9, 37, 12),
          geo: const Wgs84Point(lat: 31.17925, lng: 121.58885),
          zoneId: mockZoneDorm,
          ethicsAcknowledged: true,
        ),
      )).unwrap;
      expect(created.zoneId, mockZoneDorm);
      expect(created.geo, isNull);
      expect(created.hasGeo, isFalse);
      expect(created.observedAtFuzzed, DateTime.utc(2026, 10, 16));
      expect(created.locationLabel, contains('不公开坐标'));
      expect(created.toJson().containsKey('geo'), isFalse);
    });

    test('敏感区内的聚合热点**不公开**（质心本身就是位置）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSpot> spots = (await repository.listSpots(
        const WildlifeSpotQuery(),
      )).unwrap;
      expect(
        spots.items.any((WildlifeSpot spot) => spot.zoneId == mockZoneDorm),
        isFalse,
      );
      expect(
        spots.items.every((WildlifeSpot spot) => spot.centroid.isWithin(CampusBounds.campus)),
        isTrue,
      );
    });

    test('敏感区的已发布观测在详情里也没有坐标', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting sensitive = (await repository.getSighting('wl-1005')).unwrap;
      expect(sensitive.zoneId, mockZoneDorm);
      expect(sensitive.hasGeo, isFalse);
      expect(sensitive.geo, isNull);
    });
  });

  group('身份与精确坐标永不出现在响应里（规格 §9.6 / T15）', () {
    test('匿名记录：没有 reporterId，展示名是「匿名同学」', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting anonymous = (await repository.getSighting('wl-1005')).unwrap;
      expect(anonymous.isAnonymous, isTrue);
      expect(anonymous.reporterLabel, '匿名同学');
      expect(anonymous.toJson().containsKey('reporterId'), isFalse);
      expect(anonymous.toJson()['reporterDisplayName'], '匿名同学');
    });

    test('所有公开响应序列化后都没有精确坐标键', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSighting> page = (await repository.listSightings(
        const WildlifeSightingQuery(),
      )).unwrap;
      for (final WildlifeSighting sighting in page.items) {
        final Map<String, Object?> json = sighting.toJson();
        for (final String forbidden in <String>[
          'reporterId',
          'exactLat',
          'exactLng',
          'gcjLat',
          'gcjLng',
        ]) {
          expect(json.containsKey(forbidden), isFalse, reason: '${sighting.id} 泄漏了 $forbidden');
        }
      }
    });
  });

  group('聚合延迟（规格 §8.1 E10 / T24）', () {
    test('所有热点的 computedAt 都比当前时间早至少 24 小时', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSpot> spots = (await repository.listSpots(
        const WildlifeSpotQuery(),
      )).unwrap;
      expect(spots.items, isNotEmpty);
      for (final WildlifeSpot spot in spots.items) {
        expect(
          spot.isAggregationDelayed(mockNow),
          isTrue,
          reason: '${spot.id} 的 computedAt 太新（会变成实时围观工具）',
        );
        expect(spot.isRealtime, isFalse);
        expect(spot.aggregationDelayHours, greaterThanOrEqualTo(24));
      }
    });
  });
}
