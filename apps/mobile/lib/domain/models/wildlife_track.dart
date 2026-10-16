/// `wildlife` 推断轨迹（规格 `docs/features/wildlife-map.md` §2.4 / §6 / §10.5）。
///
/// ## ⚠️ 本类型叫「轨迹」，但**不是**实测路径
///
/// 数据来源是**同学偶发上报**，不是 GPS 项圈。因此：
///   - 无法重建真实运动路径，也无法知道两次上报之间动物去了哪；
///   - 服务端只做「按时间排序的簇 → 相邻可信簇连**直线**」，**不做插值、
///     不做样条平滑、不做速度推断、不做地图匹配**（规格 §6.2 ④）。
///
/// 因此本类型的 `isInferred` 是**恒真的 getter**，不是可解析字段：
/// 解析一个恒为 `true` 的字段没有意义，反而可能被服务端的错误值污染。
/// 客户端**在类型层面就无法表示一条"实测轨迹"**，也就无法忘记标注它
/// （规格 §2.4 / §11.3 T18）。
library;

import 'api_request.dart';
import 'geo.dart';
import 'json_read.dart';

/// 轨迹生成方法（契约冻结：只有一种，**明确不做插值**）。
enum TrackMethod {
  dbscanChain('dbscan-chain', 'DBSCAN 走廊连接'),
  unknown('unknown', '未知方法');

  const TrackMethod(this.wire, this.label);

  final String wire;
  final String label;

  static TrackMethod fromWire(String wire) {
    for (final TrackMethod method in TrackMethod.values) {
      if (wireEquals(method.wire, wire)) return method;
    }
    return TrackMethod.unknown;
  }
}

/// 推断轨迹（规格 §2.4）。
final class WildlifeTrack {
  const WildlifeTrack({
    required this.id,
    required this.speciesId,
    required this.path,
    required this.spanStartAt,
    required this.spanEndAt,
    required this.computedAt,
    this.speciesNameZh,
    this.individualId,
    this.individualName,
    this.spotIds = const <String>[],
    this.totalDistanceM = 0,
    this.sightingCount = 0,
    this.method = TrackMethod.dbscanChain,
    this.confidence = 0,
    this.disclaimer = '',
  });

  factory WildlifeTrack.fromJson(Map<String, Object?> json) {
    final Map<String, Object?>? geoJson =
        readMapOrNull(json, 'path') ?? readMapOrNull(json, 'pathGeoJson');
    final List<Wgs84Point> path = geoJson == null
        ? const <Wgs84Point>[]
        : parseGeoJsonLineString(geoJson);
    final int distance = readIntOr(json, 'totalDistanceM', 0);
    return WildlifeTrack(
      id: readString(json, 'id'),
      speciesId: readStringOr(json, 'speciesId', ''),
      path: path,
      spanStartAt: readDateTime(json, 'spanStartAt'),
      spanEndAt: readDateTime(json, 'spanEndAt'),
      computedAt: readDateTimeOrNull(json, 'computedAt') ?? readDateTime(json, 'spanEndAt'),
      speciesNameZh: readStringOrNull(json, 'speciesNameZh'),
      individualId: readStringOrNull(json, 'individualId'),
      individualName: readStringOrNull(json, 'individualName'),
      spotIds: readStringList(json, 'spotIds'),
      // 服务端没给长度时由折线现算 —— 避免 UI 显示 0 米。
      totalDistanceM: distance > 0 ? distance : polylineLengthMeters(path),
      sightingCount: readIntOr(json, 'sightingCount', 0),
      method: TrackMethod.fromWire(readStringOr(json, 'method', 'dbscan-chain')),
      confidence: readDoubleOr(json, 'confidence', 0),
      disclaimer: readStringOr(json, 'disclaimer', ''),
    );
  }

  /// 客户端兜底文案。
  ///
  /// 规格 §10.5 要求 `disclaimer` **由服务端下发**（这样文案不可能被某个端忘记加）。
  /// 但客户端仍然保留一份兜底：服务端漏发时宁可显示我们自己的文案，
  /// 也不要让「推断」这个前提在 UI 上消失。
  static const String fallbackDisclaimer = '本轨迹由同学上报推断得出，并非实测运动路径。';

  /// 列表/地图上的固定标注（规格 §6.1：**所有面向用户的文案必须写"推断"**）。
  static const String inferredLabel = '推断轨迹 · 非实测路径';

  final String id;
  final String speciesId;
  final String? speciesNameZh;

  /// 若已识别个体，则按个体出轨迹（此时才有名字）。
  final String? individualId;
  final String? individualName;

  /// 途经的聚合热点，**按时间排序**。
  final List<String> spotIds;

  /// 折线（WGS84，**已模糊化**）。
  final List<Wgs84Point> path;

  /// 折线长度（米）。
  final int totalDistanceM;

  final DateTime spanStartAt;
  final DateTime spanEndAt;

  /// 参与推断的上报条数。
  final int sightingCount;

  final TrackMethod method;
  final double confidence;

  /// 服务端下发的免责说明（可能为空 → 用 [inferredDisclaimer]）。
  final String disclaimer;

  final DateTime computedAt;

  /// **恒为 true**：见文件头注释（规格 §2.4：字段存在的唯一目的是让客户端
  /// 无法忘记标注它 —— 本端做得更彻底：它根本不是字段）。
  bool get isInferred => true;

  /// 客户端**不做**任何补点/平滑（规格 §6.2 ④）。恒为 false。
  bool get isSmoothed => false;

  /// 实际展示的免责说明：服务端文案优先，缺失时用兜底文案（**永不为空**）。
  String get inferredDisclaimer {
    final String text = disclaimer.trim();
    return text.isEmpty ? fallbackDisclaimer : text;
  }

  /// 含上报条数的完整说明（规格 §10.5 的示例文案）。
  String get fullDisclaimer =>
      '$inferredDisclaimer（基于 $sightingCount 次上报推断）';

  bool get hasNamedIndividual =>
      individualName != null && individualName!.trim().isNotEmpty;

  String get displayName => hasNamedIndividual
      ? individualName!
      : (speciesNameZh ?? speciesId);

  int get segmentCount => path.length < 2 ? 0 : path.length - 1;

  /// 能否画出来（少于 2 个点没有折线）。
  bool get isDrawable => path.length >= 2;

  Duration get span => spanEndAt.difference(spanStartAt);

  String get methodLabel => method.label;

  String get confidenceLabel {
    if (confidence >= 0.85) return '很可信';
    if (confidence >= 0.6) return '较可信';
    if (confidence >= 0.3) return '参考';
    return '不可信';
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'speciesId': speciesId,
    'speciesNameZh': speciesNameZh,
    'individualId': individualId,
    'individualName': individualName,
    'spotIds': spotIds,
    'path': <String, Object?>{
      'type': 'LineString',
      // GeoJSON 是 [lng, lat]，别写反（见 parseGeoJsonLineString）。
      'coordinates': path
          .map((Wgs84Point point) => <double>[point.lng, point.lat])
          .toList(growable: false),
    },
    'totalDistanceM': totalDistanceM,
    'spanStartAt': isoUtc(spanStartAt),
    'spanEndAt': isoUtc(spanEndAt),
    'sightingCount': sightingCount,
    'method': method.wire,
    'confidence': confidence,
    'isInferred': isInferred,
    'disclaimer': inferredDisclaimer,
    'computedAt': isoUtc(computedAt),
  };

  @override
  bool operator ==(Object other) => other is WildlifeTrack && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WildlifeTrack($id, $displayName, ${path.length} pts, ${totalDistanceM}m)';
}

/// 轨迹查询（规格 §10.1 #6）。
final class WildlifeTrackQuery {
  const WildlifeTrackQuery({
    this.speciesId,
    this.individualId,
    this.cursor,
    this.limit = defaultPageSize,
  });

  final String? speciesId;
  final String? individualId;
  final String? cursor;
  final int limit;

  Map<String, Object?> toQuery() => <String, Object?>{
    ...PageQuery(cursor: cursor, limit: limit).toQuery(),
    if (speciesId != null && speciesId!.isNotEmpty) 'species': speciesId,
    if (individualId != null && individualId!.isNotEmpty) 'individualId': individualId,
  };

  WildlifeTrackQuery copyWith({
    String? speciesId,
    String? individualId,
    String? cursor,
    int? limit,
  }) => WildlifeTrackQuery(
    speciesId: speciesId ?? this.speciesId,
    individualId: individualId ?? this.individualId,
    cursor: cursor ?? this.cursor,
    limit: limit ?? this.limit,
  );
}

/// GeoJSON `LineString` → WGS84 点串。
///
/// ⚠️ **GeoJSON 的坐标顺序是 `[lng, lat]`**（RFC 7946 §3.1.1），
/// 与我们的 `{lat, lng}` 字段顺序**相反**。这是本模块最高频的写错点，
/// 而且写反后「看起来只是偏了一点」实际上跑到了地球另一处，
/// 所以它被单独抽成函数并由单测锁住（`test/domain/wildlife_track_test.dart`）。
///
/// 非法坐标（非数字、长度不足）**丢弃**而不是抛错：一条轨迹里有 1 个坏点
/// 不该让整条轨迹消失。只支持 `LineString`（`MultiLineString` 不在契约里）。
List<Wgs84Point> parseGeoJsonLineString(Map<String, Object?> geoJson) {
  final List<Wgs84Point> points = <Wgs84Point>[];
  for (final Object? item in readListOrEmpty(geoJson, 'coordinates')) {
    if (item is! List<Object?> || item.length < 2) continue;
    final Object? lng = item[0];
    final Object? lat = item[1];
    if (lng is! num || lat is! num) continue;
    points.add(Wgs84Point(lat: lat.toDouble(), lng: lng.toDouble()));
  }
  return points;
}

/// 折线长度（米），用校园投影的等距圆柱近似逐段累加。
int polylineLengthMeters(
  List<Wgs84Point> path, {
  CampusProjection projection = CampusProjection.campus,
}) {
  if (path.length < 2) return 0;
  double total = 0;
  for (int i = 1; i < path.length; i++) {
    total += projection.metersBetween(path[i - 1], path[i]);
  }
  return total.round();
}
