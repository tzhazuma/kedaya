import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';

/// 物种 / 区域 / 聚合热点 / 命名个体的纯逻辑测试
/// （规格 §2.2 / §2.3 / §2.5 / §9.4 / §9.5 / §8.1 E10）。
void main() {
  group('物种（规格 §2.5）', () {
    test('解析保护物种的繁殖期字段', () {
      final WildlifeSpecies swan = WildlifeSpecies.fromJson(<String, Object?>{
        'id': 'sp-swan',
        'scientificName': 'Cygnus atratus',
        'commonNameZh': '黑天鹅',
        'commonNameEn': 'Black swan',
        'taxonRank': 'species',
        'isProtected': true,
        'isNestingSensitive': true,
        'nestingMonths': <Object?>[3, 4, 5, 6],
        'defaultFeedingPolicy': 'forbidden',
      });
      expect(swan.displayName, '黑天鹅');
      expect(swan.isProtected, isTrue);
      expect(swan.protectionLabel, '保护物种');
      expect(swan.nestingMonths, <int>[3, 4, 5, 6]);
      expect(swan.defaultFeedingPolicy, FeedingPolicy.forbidden);
      expect(swan.isNestingInMonth(4), isTrue);
      expect(swan.isNestingInMonth(10), isFalse);
    });

    test('nestingMonths 容忍字符串数字，未知层级收敛', () {
      final WildlifeSpecies species = WildlifeSpecies.fromJson(<String, Object?>{
        'id': 'sp-x',
        'scientificName': 'X',
        'commonNameZh': 'X',
        'taxonRank': 'tribe',
        'nestingMonths': <Object?>['3', 'oops', 4],
        'defaultFeedingPolicy': 'nonsense',
      });
      expect(species.nestingMonths, <int>[3, 4]);
      expect(species.taxonRank, TaxonRank.unknown);
      expect(species.defaultFeedingPolicy, FeedingPolicy.unknown);
      expect(species.isNestingInMonth(3), isFalse, reason: 'isNestingSensitive 默认为 false');
    });

    test('shanghaiMonth 按东八区取月份（规格 §9.4 的 monthInShanghai）', () {
      // UTC 10 月 31 日 20:00 → 上海 11 月 1 日 04:00。
      expect(shanghaiMonth(DateTime.utc(2026, 10, 31, 20)), 11);
      expect(shanghaiMonth(DateTime.utc(2026, 10, 31, 15)), 10);
    });
  });

  group('投喂政策（契约冻结 allowed | discouraged | forbidden）', () {
    test('收敛与徽章语义色', () {
      expect(FeedingPolicy.fromWire('allowed'), FeedingPolicy.allowed);
      expect(FeedingPolicy.fromWire('discouraged'), FeedingPolicy.discouraged);
      expect(FeedingPolicy.fromWire('forbidden'), FeedingPolicy.forbidden);
      expect(FeedingPolicy.fromWire('???'), FeedingPolicy.unknown);
      expect(FeedingPolicy.allowed.tone, FeedingBadgeTone.success);
      expect(FeedingPolicy.discouraged.tone, FeedingBadgeTone.warning);
      expect(FeedingPolicy.forbidden.tone, FeedingBadgeTone.danger);
      // 未知**绝不**当成"可投喂"。
      expect(FeedingPolicy.unknown.isAllowed, isFalse);
      expect(FeedingPolicy.unknown.tone, FeedingBadgeTone.muted);
    });

    test('只有 forbidden 需要在上报表单出红色警告条', () {
      expect(FeedingPolicy.forbidden.needsReportingWarning, isTrue);
      expect(FeedingPolicy.discouraged.needsReportingWarning, isFalse);
      expect(FeedingPolicy.unknown.needsReportingWarning, isFalse);
    });
  });

  group('区域（规格 §2.2 / §8.3）', () {
    test('半径既读 geo.radiusM 也读顶层 radiusM；物种两种键名都读', () {
      final WildlifeZone nested = WildlifeZone.fromJson(<String, Object?>{
        'id': 'wz-1',
        'name': '人工湖',
        'geo': <String, Object?>{'lat': 31.1772, 'lng': 121.5913, 'radiusM': 120},
        'species': <Object?>['sp-swan'],
      });
      expect(nested.radiusM, 120);
      expect(nested.center.lat, closeTo(31.1772, 1e-9));
      expect(nested.speciesIds, <String>['sp-swan']);
      // 规格 §2.2 的默认值。
      expect(nested.fuzzRadiusM, defaultFuzzRadiusM);
      expect(nested.isSensitive, isFalse);

      final WildlifeZone flat = WildlifeZone.fromJson(<String, Object?>{
        'id': 'wz-2',
        'name': '食堂',
        'geo': <String, Object?>{'lat': 31.1779, 'lng': 121.5890},
        'radiusM': 60,
        'speciesIds': <Object?>['sp-cat'],
      });
      expect(flat.radiusM, 60);
      expect(flat.speciesIds, <String>['sp-cat']);
    });

    test('告示位摘要截到 40 字（规格 §8.3 的气泡）', () {
      final WildlifeZone zone = WildlifeZone(
        id: 'wz-1',
        name: '人工湖',
        center: const Wgs84Point(lat: 31.1772, lng: 121.5913),
        radiusM: 120,
        noticeText: '黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂（面包、零食等人类食物会损害它们的健康）。',
      );
      expect(zone.hasNotice, isTrue);
      expect(zone.noticeSummary.length, zoneNoticeSummaryLength + 1);
      expect(zone.noticeSummary.endsWith('…'), isTrue);
      expect(zoneNoticeSummaryLength, 40);
    });

    test('covers 用米判断，半径外不算命中', () {
      const Wgs84Point center = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final WildlifeZone zone = WildlifeZone(
        id: 'wz-1',
        name: '草坪',
        center: center,
        radiusM: 50,
      );
      final Wgs84Point inside = Wgs84Point(
        lat: 31.1780 + 30 / CampusProjection.defaultMetersPerDegreeLat,
        lng: 121.5900,
      );
      final Wgs84Point outside = Wgs84Point(
        lat: 31.1780 + 80 / CampusProjection.defaultMetersPerDegreeLat,
        lng: 121.5900,
      );
      expect(zone.covers(inside), isTrue);
      expect(zone.covers(outside), isFalse);
      expect(zone.distanceToMeters(inside), closeTo(30, 0.1));
    });

    test('zoneContaining 命中多个时取半径最小的（最具体的区域）', () {
      const Wgs84Point point = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final List<WildlifeZone> zones = <WildlifeZone>[
        WildlifeZone(id: 'big', name: '整个校园', center: point, radiusM: 500),
        WildlifeZone(id: 'small', name: '草坪', center: point, radiusM: 40),
        WildlifeZone(
          id: 'far',
          name: '远处',
          center: const Wgs84Point(lat: 31.1850, lng: 121.5950),
          radiusM: 10,
        ),
      ];
      expect(zoneContaining(point, zones)!.id, 'small');
      expect(zoneContaining(const Wgs84Point(lat: 31.1860, lng: 121.5970), zones), isNull);
    });
  });

  group('聚合热点（规格 §2.3 / §8.1 E10 / §11.3 T24）', () {
    WildlifeSpot spot({int delayHours = defaultAggregationDelayHours}) => WildlifeSpot(
      id: 'ws-1',
      speciesId: 'sp-cat',
      centroid: const Wgs84Point(lat: 31.17855, lng: 121.59015),
      radiusM: 62,
      sightingCount: 24,
      firstSeenAt: DateTime.utc(2026, 9, 1),
      lastSeenAt: DateTime.utc(2026, 10, 15),
      computedAt: DateTime.utc(2026, 10, 16, 3),
      hourHistogram: const <int>[
        0, 0, 0, 0, 0, 0, 2, 5, 8, 4, 1, 0,
        0, 0, 0, 0, 0, 3, 7, 9, 5, 2, 0, 0,
      ],
      confidence: 0.72,
      distinctReporters: 9,
      aggregationDelayHours: delayHours,
    );

    test('客户端永远不把它当实时位置', () {
      expect(spot().isRealtime, isFalse);
      expect(spot().isAggregated, isTrue);
      expect(spot().aggregationDelayHours, 24);
    });

    test('computedAt 与当前时间至少相差 24 小时', () {
      final WildlifeSpot value = spot();
      expect(value.isAggregationDelayed(DateTime.utc(2026, 10, 17, 3)), isTrue);
      expect(value.isAggregationDelayed(DateTime.utc(2026, 10, 16, 12)), isFalse);
    });

    test('直方图被规范为恰好 24 项（多给少给都不崩）', () {
      final WildlifeSpot short = WildlifeSpot.fromJson(<String, Object?>{
        'id': 'ws-2',
        'speciesId': 'sp-cat',
        'centroid': <String, Object?>{'lat': 31.178, 'lng': 121.59},
        'firstSeenAt': '2026-09-01T00:00:00.000Z',
        'lastSeenAt': '2026-10-15T00:00:00.000Z',
        'computedAt': '2026-10-16T03:00:00.000Z',
        'hourHistogram': <Object?>[1, 2, 3],
      });
      expect(short.hourHistogram, hasLength(24));
      expect(short.hourHistogram[0], 1);
      expect(short.hourHistogram[23], 0);
    });

    test('peakHours 取最多的 3 个时段，按次数降序', () {
      // 直方图里 19 点 9 次、8 点 8 次、7 点与 20 点都是 5 次 → 取索引小的 7 点。
      expect(spot().peakHours, <int>[19, 8, 7]);
    });

    test('confidenceLabel 分档', () {
      expect(spot().confidenceLabel, '较可信');
      expect(
        WildlifeSpot(
          id: 'ws-3',
          speciesId: 'sp-cat',
          centroid: const Wgs84Point(lat: 31.178, lng: 121.59),
          radiusM: 10,
          sightingCount: 1,
          firstSeenAt: DateTime.utc(2026, 9, 1),
          lastSeenAt: DateTime.utc(2026, 10, 15),
          computedAt: DateTime.utc(2026, 10, 16),
          confidence: 0.2,
        ).confidenceLabel,
        '不可信',
      );
    });

    test('查询参数：minConfidence 默认 0.3，空物种/区域被丢弃', () {
      expect(
        const WildlifeSpotQuery(limit: 50).toQuery(),
        <String, Object?>{'limit': 50, 'minConfidence': 0.3},
      );
      expect(
        const WildlifeSpotQuery(speciesId: 'sp-cat', zoneId: 'wz-lake', limit: 10).toQuery(),
        <String, Object?>{
          'limit': 10,
          'species': 'sp-cat',
          'zoneId': 'wz-lake',
          'minConfidence': 0.3,
        },
      );
      expect(WildlifeSpotQuery.defaultMinConfidence, 0.3);
    });
  });

  group('命名个体与审核状态机', () {
    test('个体与观测复用同一套状态机（规格 §2.10 刻意同构）', () {
      expect(
        WildlifeModerationStatus.fromWire('pending'),
        WildlifeModerationStatus.pending,
      );
      expect(WildlifeModerationStatus.pending.label, '待审核');
      expect(WildlifeModerationStatus.rejected.isPublic, isFalse);
      expect(WildlifeModerationStatus.unknown.label, '未知状态');
    });

    test('个体名与物种在序列化里保留', () {
      const WildlifeIndividual individual = WildlifeIndividual(
        id: 'wi-daju',
        name: '大橘',
        speciesId: 'sp-cat',
        speciesNameZh: '猫',
        status: WildlifeModerationStatus.published,
      );
      final Map<String, Object?> json = individual.toJson();
      expect(json['name'], '大橘');
      expect(json['speciesId'], 'sp-cat');
      expect(json['status'], 'PUBLISHED');
    });
  });
}
