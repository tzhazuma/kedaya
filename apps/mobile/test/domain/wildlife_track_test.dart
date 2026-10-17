import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife_track.dart';

/// 推断轨迹的模型测试（规格 §2.4 / §6 / §10.5 / §11.3 T18）。
///
/// 本文件里最重要的一条：**`isInferred` 永远是 true**，
/// 而且它不是可解析字段 —— 客户端在类型层面就无法表示一条"实测轨迹"。
void main() {
  group('GeoJSON 解析（RFC 7946 是 [lng, lat]，顺序与本端字段相反）', () {
    test('LineString 的坐标顺序被正确解读', () {
      final List<Wgs84Point> path = parseGeoJsonLineString(<String, Object?>{
        'type': 'LineString',
        'coordinates': <Object?>[
          <Object?>[121.5901, 31.1780],
          <Object?>[121.5912, 31.1786],
        ],
      });
      expect(path, hasLength(2));
      // 上科大：lat≈31、lng≈121。如果解析时把顺序写反，这两个断言会立刻失败。
      expect(path.first.lat, closeTo(31.1780, 1e-9));
      expect(path.first.lng, closeTo(121.5901, 1e-9));
      expect(path.first.isWithin(CampusBounds.campus), isTrue);
    });

    test('坏点被丢弃而不是让整条轨迹消失', () {
      final List<Wgs84Point> path = parseGeoJsonLineString(<String, Object?>{
        'coordinates': <Object?>[
          <Object?>[121.5901, 31.1780],
          <Object?>['oops'],
          <Object?>[121.5912],
          <Object?>[121.5915, 31.1789],
          'not-a-point',
        ],
      });
      expect(path, hasLength(2));
    });

    test('空 / 缺 coordinates 时返回空列表（不抛异常）', () {
      expect(parseGeoJsonLineString(<String, Object?>{}), isEmpty);
      expect(
        parseGeoJsonLineString(<String, Object?>{'coordinates': <Object?>[]}),
        isEmpty,
      );
    });
  });

  group('isInferred 恒为 true（规格 §2.4 / §11.3 T18）', () {
    test('即使服务端下发 isInferred: false，客户端也仍然标注"推断"', () {
      final WildlifeTrack track = WildlifeTrack.fromJson(<String, Object?>{
        'id': 'wt-1',
        'speciesId': 'sp-swan',
        'isInferred': false,
        'method': 'dbscan-chain',
        'spanStartAt': '2026-09-20T00:00:00.000Z',
        'spanEndAt': '2026-10-14T00:00:00.000Z',
        'path': <String, Object?>{
          'type': 'LineString',
          'coordinates': <Object?>[
            <Object?>[121.5901, 31.1780],
            <Object?>[121.5912, 31.1786],
          ],
        },
      });
      expect(track.isInferred, isTrue);
      expect(track.toJson()['isInferred'], isTrue);
      expect(WildlifeTrack.inferredLabel, contains('推断'));
      expect(WildlifeTrack.inferredLabel, contains('非实测'));
    });

    test('客户端不做任何补点 / 平滑（规格 §6.2 ④ 的"明确不做"）', () {
      final WildlifeTrack track = WildlifeTrack(
        id: 'wt-1',
        speciesId: 'sp-swan',
        path: const <Wgs84Point>[
          Wgs84Point(lat: 31.1780, lng: 121.5900),
          Wgs84Point(lat: 31.1786, lng: 121.5912),
        ],
        spanStartAt: DateTime.utc(2026, 9, 20),
        spanEndAt: DateTime.utc(2026, 10, 14),
        computedAt: DateTime.utc(2026, 10, 16),
      );
      expect(track.isSmoothed, isFalse);
      expect(track.segmentCount, 1);
      expect(track.path, hasLength(2));
    });
  });

  group('免责说明（规格 §10.5：由服务端下发，客户端仍要兜底）', () {
    test('服务端给了文案就用服务端的', () {
      final WildlifeTrack track = WildlifeTrack(
        id: 'wt-1',
        speciesId: 'sp-swan',
        path: const <Wgs84Point>[],
        spanStartAt: DateTime.utc(2026, 9, 20),
        spanEndAt: DateTime.utc(2026, 10, 14),
        computedAt: DateTime.utc(2026, 10, 16),
        sightingCount: 31,
        disclaimer: '本轨迹由 31 次同学上报推断得出，并非实测运动路径。',
      );
      expect(track.inferredDisclaimer, '本轨迹由 31 次同学上报推断得出，并非实测运动路径。');
      expect(track.fullDisclaimer, contains('基于 31 次上报推断'));
    });

    test('服务端漏发时用兜底文案 —— 永不为空，且仍然写"推断"', () {
      final WildlifeTrack track = WildlifeTrack(
        id: 'wt-2',
        speciesId: 'sp-cat',
        path: const <Wgs84Point>[],
        spanStartAt: DateTime.utc(2026, 9, 20),
        spanEndAt: DateTime.utc(2026, 10, 14),
        computedAt: DateTime.utc(2026, 10, 16),
        disclaimer: '   ',
      );
      expect(track.inferredDisclaimer, WildlifeTrack.fallbackDisclaimer);
      expect(track.inferredDisclaimer, contains('并非实测运动路径'));
      expect(track.inferredDisclaimer.trim(), isNotEmpty);
    });
  });

  group('几何与统计', () {
    test('服务端没给长度时由折线现算（避免显示 0 米）', () {
      final WildlifeTrack track = WildlifeTrack.fromJson(<String, Object?>{
        'id': 'wt-1',
        'speciesId': 'sp-cat',
        'spanStartAt': '2026-09-20T00:00:00.000Z',
        'spanEndAt': '2026-10-14T00:00:00.000Z',
        'totalDistanceM': 0,
        'path': <String, Object?>{
          'type': 'LineString',
          'coordinates': <Object?>[
            <Object?>[121.5900, 31.1780],
            // 向北约 100 m
            <Object?>[
              121.5900,
              31.1780 + 100 / CampusProjection.defaultMetersPerDegreeLat
            ],
          ],
        },
      });
      expect(track.totalDistanceM, closeTo(100, 2));
    });

    test('polylineLengthMeters 逐段累加', () {
      const List<Wgs84Point> path = <Wgs84Point>[
        Wgs84Point(lat: 31.1780, lng: 121.5900),
        Wgs84Point(lat: 31.1789, lng: 121.5900),
        Wgs84Point(lat: 31.1798, lng: 121.5900),
      ];
      expect(polylineLengthMeters(path), closeTo(200, 4));
      expect(polylineLengthMeters(const <Wgs84Point>[]), 0);
      expect(
        polylineLengthMeters(
            const <Wgs84Point>[Wgs84Point(lat: 31.178, lng: 121.59)]),
        0,
      );
    });

    test('途经点顺序被保留，少于 2 个点画不出线', () {
      final WildlifeTrack track = WildlifeTrack.fromJson(<String, Object?>{
        'id': 'wt-1',
        'speciesId': 'sp-cat',
        'spotIds': <Object?>['ws-b', 'ws-a'],
        'spanStartAt': '2026-09-20T00:00:00.000Z',
        'spanEndAt': '2026-10-14T00:00:00.000Z',
        'path': <String, Object?>{
          'type': 'LineString',
          'coordinates': <Object?>[
            <Object?>[121.5901, 31.1780],
          ],
        },
      });
      expect(track.spotIds, <String>['ws-b', 'ws-a']);
      expect(track.isDrawable, isFalse);
      expect(track.segmentCount, 0);
    });

    test('方法收敛：只有 dbscan-chain 是已知值', () {
      expect(TrackMethod.fromWire('dbscan-chain'), TrackMethod.dbscanChain);
      expect(TrackMethod.fromWire('DBSCAN-CHAIN'), TrackMethod.dbscanChain);
      expect(TrackMethod.fromWire('spline-v2'), TrackMethod.unknown);
      expect(TrackMethod.dbscanChain.label, contains('DBSCAN'));
    });

    test('展示名：有命名个体时用个体名', () {
      final WildlifeTrack track = WildlifeTrack(
        id: 'wt-1',
        speciesId: 'sp-cat',
        speciesNameZh: '猫',
        individualName: '大橘',
        path: const <Wgs84Point>[],
        spanStartAt: DateTime.utc(2026, 9, 20),
        spanEndAt: DateTime.utc(2026, 10, 14),
        computedAt: DateTime.utc(2026, 10, 16),
      );
      expect(track.hasNamedIndividual, isTrue);
      expect(track.displayName, '大橘');
      expect(track.confidenceLabel, '不可信');
    });

    test('查询参数收敛', () {
      expect(
        const WildlifeTrackQuery(speciesId: 'sp-cat', limit: 5).toQuery(),
        <String, Object?>{'limit': 5, 'species': 'sp-cat'},
      );
      expect(
        const WildlifeTrackQuery(individualId: 'wi-daju', limit: 5).toQuery(),
        <String, Object?>{'limit': 5, 'individualId': 'wi-daju'},
      );
    });
  });
}
