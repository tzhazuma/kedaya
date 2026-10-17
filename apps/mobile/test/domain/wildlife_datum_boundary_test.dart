import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';
import 'package:kedaya/domain/models/wildlife_track.dart';

/// 坐标系边界测试（规格 §3.2 / §3.5 V5）：**GCJ-02 不得进入本端**。
///
/// 规格 §3.1 的原话：一个在图书馆后草坪的观测点，如果按 WGS84 数值丢给按
/// GCJ-02 解释的组件，"会显示在几百米外的教学楼或校门外"，而且
/// **看起来像数据错了而不是坐标系错了**。
///
/// 本端采用方案 B（静态底图 + 仿射标定），**完全不经过 GCJ-02**。
/// 这些测试把"不经过"变成可执行的断言，而不是一句注释：
///   1. 类型层面：`GeoDatum` 只有一个成员 → 构造不出 GCJ-02 坐标；
///   2. 序列化层面：所有模型的 JSON 里没有 `gcj*` 键；
///   3. 解析层面：payload 里即使带了 `gcjLat` / `exactLat` / `reporterId` 也被忽略；
///   4. 源码层面：机械扫描，禁止出现 GCJ 转换函数。
void main() {
  group('类型层面：GCJ-02 无法被表示', () {
    test('GeoDatum 只有 wgs84 一个成员', () {
      expect(GeoDatum.values, hasLength(1));
      expect(GeoDatum.values.single, GeoDatum.wgs84);
      expect(GeoDatum.wgs84.wire, 'WGS84');
    });

    test('Wgs84Point 的 datum 恒为 WGS84', () {
      const Wgs84Point point = Wgs84Point(lat: 31.1780, lng: 121.5900);
      expect(point.datum, GeoDatum.wgs84);
    });
  });

  group('序列化层面：响应/请求里没有 gcj 键', () {
    test('观测的 geo 只有 lat/lng', () {
      final WildlifeSighting sighting = WildlifeSighting(
        id: 'wl-test',
        speciesId: 'sp-cat',
        status: WildlifeModerationStatus.published,
        geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
        observedAt: DateTime.utc(2026, 10, 16, 9),
        createdAt: DateTime.utc(2026, 10, 16, 9, 10),
      );
      final Map<String, Object?> json = sighting.toJson();
      expect(_hasGcjKey(json), isFalse, reason: '序列化结果里出现了 gcj* 键');
      final Map<String, Object?> geo = json['geo']! as Map<String, Object?>;
      expect(geo.keys.toSet(), <String>{'lat', 'lng'});
    });

    test('上报请求体的 geo 只有 lat/lng', () {
      final WildlifeSightingDraft draft = WildlifeSightingDraft(
        speciesId: 'sp-cat',
        observedAt: DateTime.utc(2026, 10, 16, 9),
        geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
      );
      final Map<String, Object?> json = draft.toJson();
      expect(_hasGcjKey(json), isFalse);
      final Map<String, Object?> geo = json['geo']! as Map<String, Object?>;
      expect(geo.keys.toSet(), <String>{'lat', 'lng'});
    });

    test('区域 / 热点 / 轨迹的序列化结果里没有 gcj 键', () {
      final WildlifeZone zone = WildlifeZone(
        id: 'wz-test',
        name: '测试区域',
        center: const Wgs84Point(lat: 31.1780, lng: 121.5900),
        radiusM: 50,
      );
      expect(_hasGcjKey(zone.toJson()), isFalse);
      expect(zone.toJson()['geo'], isA<Map<String, Object?>>());
      expect(
        (zone.toJson()['geo']! as Map<String, Object?>).keys.toSet(),
        <String>{'lat', 'lng', 'radiusM'},
      );

      final WildlifeTrack track = WildlifeTrack(
        id: 'wt-test',
        speciesId: 'sp-cat',
        path: const <Wgs84Point>[
          Wgs84Point(lat: 31.1780, lng: 121.5900),
          Wgs84Point(lat: 31.1785, lng: 121.5905),
        ],
        spanStartAt: DateTime.utc(2026, 10, 1),
        spanEndAt: DateTime.utc(2026, 10, 10),
        computedAt: DateTime.utc(2026, 10, 16),
      );
      expect(_hasGcjKey(track.toJson()), isFalse);
      // GeoJSON 是 [lng, lat]（见 parseGeoJsonLineString 的注释）。
      final Map<String, Object?> path =
          track.toJson()['path']! as Map<String, Object?>;
      expect(path['type'], 'LineString');
      final List<Object?> coordinates = path['coordinates']! as List<Object?>;
      expect(coordinates.first, <double>[121.5900, 31.1780]);
    });
  });

  group('解析层面：即使 payload 带了 GCJ / 精确坐标 / reporterId 也一律忽略', () {
    test('观测解析只读 geo.lat / geo.lng', () {
      final WildlifeSighting sighting =
          WildlifeSighting.fromJson(<String, Object?>{
        'id': 'wl-1',
        'species': 'sp-cat',
        'status': 'PUBLISHED',
        'observedAt': '2026-10-16T01:00:00.000Z',
        'geo': <String, Object?>{
          'lat': 31.178,
          'lng': 121.59,
          'gcjLat': 31.181,
          'gcjLng': 121.594,
        },
        'gcjLat': 31.181,
        'gcjLng': 121.594,
        'exactLat': 31.1781,
        'exactLng': 121.5901,
        'reporterId': 'u-1001',
      });
      expect(sighting.geo!.lat, 31.178);
      expect(sighting.geo!.lng, 121.59);
      // 精确坐标与上报人 id **不在模型里**，所以它们连"被丢弃"都不需要：
      // 模型没有承载它们的地方（规格 §9.6 / T15）。
      expect(sighting.toJson().containsKey('exactLat'), isFalse);
      expect(sighting.toJson().containsKey('reporterId'), isFalse);
      expect(_hasGcjKey(sighting.toJson()), isFalse);
    });

    test('观测模型**没有** reporterId 字段（编译期就不可能泄漏）', () {
      final WildlifeSighting sighting = WildlifeSighting(
        id: 'wl-2',
        speciesId: 'sp-cat',
        status: WildlifeModerationStatus.published,
        geo: const Wgs84Point(lat: 31.178, lng: 121.59),
        observedAt: DateTime.utc(2026, 10, 16),
        createdAt: DateTime.utc(2026, 10, 16),
        isAnonymous: true,
      );
      // 匿名时展示名一律是「匿名同学」，且不带上报人标识。
      expect(sighting.reporterLabel, '匿名同学');
      expect(sighting.toJson().containsKey('reporterId'), isFalse);
      expect(sighting.toJson()['isAnonymous'], isTrue);
    });
  });

  group('源码层面：禁止 GCJ-02 转换函数（机械扫描）', () {
    test('wildlife 相关源码里没有 gcj 相关的标识符（注释除外）', () {
      // 只扫本次交付相关的文件；`geo.dart` 的注释里**说明**了"没有 GCJ 转换"，
      // 因此扫描前必须剥掉注释。
      final List<String> targets = <String>[];
      for (final String root in <String>[
        'lib/domain',
        'lib/data/mock',
        'lib/data/repositories',
        'lib/features/wildlife',
        'lib/platform',
      ]) {
        final Directory directory = Directory(root);
        if (!directory.existsSync()) continue;
        for (final FileSystemEntity entity
            in directory.listSync(recursive: true)) {
          if (entity is! File || !entity.path.endsWith('.dart')) continue;
          // 路径直接使用（不做分隔符替换：Flutter 测试跑在 POSIX 路径上，
          // 而且 Dart 的原始字符串不能以反斜杠结尾）。
          final String path = entity.path;
          if (!path.contains('wildlife') && !path.endsWith('models/geo.dart'))
            continue;
          targets.add(path);
        }
      }
      expect(targets, isNotEmpty, reason: '扫描目标为空，说明路径写错了');

      final RegExp gcj = RegExp('gcj', caseSensitive: false);
      final List<String> offenders = <String>[];
      for (final String path in targets) {
        final List<String> lines = File(path).readAsLinesSync();
        for (int index = 0; index < lines.length; index++) {
          final String code = lines[index].split('//').first;
          if (gcj.hasMatch(code)) {
            offenders.add('$path:${index + 1}: ${lines[index].trim()}');
          }
        }
      }
      expect(
        offenders,
        isEmpty,
        reason: '本端不提供 GCJ-02 转换（方案 B 不需要），发现:\n${offenders.join('\n')}',
      );
    });
  });
}

/// 递归检查 JSON 里是否出现 gcj 相关键名。
bool _hasGcjKey(Object? value) {
  if (value is Map<String, Object?>) {
    for (final MapEntry<String, Object?> entry in value.entries) {
      if (entry.key.toLowerCase().contains('gcj')) return true;
      if (_hasGcjKey(entry.value)) return true;
    }
    return false;
  }
  if (value is List<Object?>) {
    return value.any(_hasGcjKey);
  }
  return false;
}
