/// `wildlife` 领域模型：物种 / 区域 / 聚合热点 / 命名个体 / 底图配置。
///
/// 规格 `docs/features/wildlife-map.md`：
///   - §2.2 `WildlifeZone`（契约 §2.10 冻结字段 + 本规格新增的可选字段）
///   - §2.3 `WildlifeSpot`（**算法聚类**的热点，与人工定义的区域不是一张表）
///   - §2.5 `SpeciesTaxonomy`
///   - §2.8 `WildlifeIndividual`（R6「手动给个名字」）
///   - §1.4 `CampusBasemap`
///
/// 本文件零框架依赖（冻结契约 §7 硬规则 1）：只用 `dart:core` + 自有模型。
library;

import 'api_request.dart';
import 'geo.dart';
import 'json_read.dart';

/// 默认位置模糊化半径（规格 §9.3 ②：默认网格 `G = 50 m`）。
const int defaultFuzzRadiusM = 50;

/// 聚合热点的最小延迟（规格 §8.1 E10：`computedAt` 与当前时间至少相差 24 小时）。
const int defaultAggregationDelayHours = 24;

/// 区域告示位气泡里的摘要长度（规格 §8.3：前 40 字）。
const int zoneNoticeSummaryLength = 40;

/// 投喂政策（契约冻结取值 `allowed | discouraged | forbidden`）。
enum FeedingPolicy {
  allowed('allowed', '可投喂', FeedingBadgeTone.success),
  discouraged('discouraged', '不建议投喂', FeedingBadgeTone.warning),
  forbidden('forbidden', '禁止投喂', FeedingBadgeTone.danger),

  /// 未知取值收敛：**绝不**当成「可投喂」（保守）。
  unknown('unknown', '投喂政策未知', FeedingBadgeTone.muted);

  const FeedingPolicy(this.wire, this.label, this.tone);

  final String wire;
  final String label;

  /// 徽章语义色（**不是色值**）：presentation 再把 tone 映射到 `KedaYaTokens`。
  /// 这样 domain 层不出现任何颜色，也不违反「禁止硬编码色值」。
  final FeedingBadgeTone tone;

  static FeedingPolicy fromWire(String wire) {
    for (final FeedingPolicy policy in FeedingPolicy.values) {
      if (policy.wire == wire) return policy;
    }
    return FeedingPolicy.unknown;
  }

  bool get isAllowed => this == FeedingPolicy.allowed;

  bool get isForbidden => this == FeedingPolicy.forbidden;

  /// 需要在上报表单里显示红色警告条（规格 §8.3）。
  bool get needsReportingWarning => this == FeedingPolicy.forbidden;
}

/// 徽章语义色（presentation 侧映射到设计令牌）。
enum FeedingBadgeTone { success, warning, danger, muted }

/// 分类层级（契约冻结 `species | genus | family | order`）。
enum TaxonRank {
  species('species', '种'),
  genus('genus', '属'),
  family('family', '科'),
  order('order', '目'),
  unknown('unknown', '未知层级');

  const TaxonRank(this.wire, this.label);

  final String wire;
  final String label;

  static TaxonRank fromWire(String wire) {
    for (final TaxonRank rank in TaxonRank.values) {
      if (rank.wire == wire) return rank;
    }
    return TaxonRank.unknown;
  }
}

/// 审核状态机（规格 §2.10）。
///
/// `WildlifeSighting` 与 `WildlifeIndividual` **刻意复用同一套状态机与队列**，
/// 因此这里只有一个枚举。
enum WildlifeModerationStatus {
  pending('PENDING', '待审核'),
  published('PUBLISHED', '已发布'),
  rejected('REJECTED', '未通过'),
  unknown('unknown', '未知状态');

  const WildlifeModerationStatus(this.wire, this.label);

  final String wire;
  final String label;

  /// wire 比较**忽略大小写**（`services/api` 的取值大小写不统一，见
  /// `json_read.dart` 的 `wireEquals` 说明）。
  static WildlifeModerationStatus fromWire(String wire) {
    for (final WildlifeModerationStatus status in WildlifeModerationStatus.values) {
      if (wireEquals(status.wire, wire)) return status;
    }
    return WildlifeModerationStatus.unknown;
  }

  /// 只有 [published] 才对外公开（`GET /items` 只返回 PUBLISHED，规格 §10.1）。
  bool get isPublic => this == WildlifeModerationStatus.published;

  bool get isPending => this == WildlifeModerationStatus.pending;
}

/// 物种（规格 §2.5 `SpeciesTaxonomy`）。
final class WildlifeSpecies {
  const WildlifeSpecies({
    required this.id,
    required this.scientificName,
    required this.commonNameZh,
    required this.defaultFeedingPolicy,
    this.commonNameEn,
    this.taxonRank = TaxonRank.species,
    this.parentId,
    this.isProtected = false,
    this.isNestingSensitive = false,
    this.nestingMonths = const <int>[],
    this.iconUrl,
    this.isActive = true,
    this.externalIds = const <String, Object?>{},
  });

  factory WildlifeSpecies.fromJson(Map<String, Object?> json) => WildlifeSpecies(
    id: readString(json, 'id'),
    scientificName: readStringOr(json, 'scientificName', ''),
    commonNameZh: readStringOr(json, 'commonNameZh', ''),
    defaultFeedingPolicy: FeedingPolicy.fromWire(
      readStringOr(json, 'defaultFeedingPolicy', 'discouraged'),
    ),
    commonNameEn: readStringOrNull(json, 'commonNameEn'),
    taxonRank: TaxonRank.fromWire(readStringOr(json, 'taxonRank', 'species')),
    parentId: readStringOrNull(json, 'parentId'),
    isProtected: readBoolOr(json, 'isProtected', false),
    isNestingSensitive: readBoolOr(json, 'isNestingSensitive', false),
    nestingMonths: _readIntList(json, 'nestingMonths'),
    iconUrl: readStringOrNull(json, 'iconUrl'),
    isActive: readBoolOr(json, 'isActive', true),
    externalIds: readMapOrNull(json, 'externalIds') ?? const <String, Object?>{},
  );

  final String id;

  /// 学名，如 `Cygnus atratus`。契约里唯一。
  final String scientificName;

  /// 中文名，如「黑天鹅」。
  final String commonNameZh;

  final String? commonNameEn;
  final TaxonRank taxonRank;
  final String? parentId;

  /// 国家/地方保护动物 → 审核更严（双人复核）且模糊半径加倍。
  final bool isProtected;

  /// 繁殖期敏感 → 触发规格 §9.4 的季节性加强模糊。
  final bool isNestingSensitive;

  /// 繁殖月份（1–12）。仅 [isNestingSensitive] 时有意义。
  final List<int> nestingMonths;

  final FeedingPolicy defaultFeedingPolicy;
  final String? iconUrl;
  final bool isActive;
  final Map<String, Object?> externalIds;

  /// 展示名：中文名优先，退化到学名。
  String get displayName => commonNameZh.isNotEmpty ? commonNameZh : scientificName;

  /// [month]（1–12）是否落在该物种的繁殖月内（规格 §9.4）。
  bool isNestingInMonth(int month) => isNestingSensitive && nestingMonths.contains(month);

  String get protectionLabel => isProtected ? '保护物种' : '非保护物种';

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'scientificName': scientificName,
    'commonNameZh': commonNameZh,
    'commonNameEn': commonNameEn,
    'taxonRank': taxonRank.wire,
    'parentId': parentId,
    'isProtected': isProtected,
    'isNestingSensitive': isNestingSensitive,
    'nestingMonths': nestingMonths,
    'defaultFeedingPolicy': defaultFeedingPolicy.wire,
    'iconUrl': iconUrl,
    'isActive': isActive,
    'externalIds': externalIds,
  };

  @override
  bool operator ==(Object other) => other is WildlifeSpecies && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'WildlifeSpecies($id, $commonNameZh / $scientificName)';
}

/// 人工定义的活动区域（规格 §2.2；契约 §2.10 的字段 + 本规格新增字段）。
///
/// 与 [WildlifeSpot] 的区别（规格 §2.3 的表格，**实现时最容易混淆的一点**）：
/// 本类型是**管理端维护**的稳定区域（投喂政策 / 告示位 / 管理边界）；
/// [WildlifeSpot] 是**算法聚类**出来的热点，只读、每次重算可能变化。
final class WildlifeZone {
  const WildlifeZone({
    required this.id,
    required this.name,
    required this.center,
    required this.radiusM,
    this.speciesIds = const <String>[],
    this.feedingPolicy = FeedingPolicy.discouraged,
    this.note,
    this.fuzzRadiusM = defaultFuzzRadiusM,
    this.isSensitive = false,
    this.noticeText,
    this.sortOrder = 0,
  });

  /// 解析：区域是圆形的，契约把半径放在 `geo.radiusM` 里，
  /// 而 `services/api` 的 Prisma 草案用的是顶层标量列 `radiusM` —— **两种都读**。
  factory WildlifeZone.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> geo = readMap(json, 'geo');
    return WildlifeZone(
      id: readString(json, 'id'),
      name: readStringOr(json, 'name', ''),
      center: Wgs84Point.fromJson(geo),
      radiusM: readIntOr(geo, 'radiusM', readIntOr(json, 'radiusM', 0)),
      speciesIds: _readSpeciesIds(json),
      feedingPolicy: FeedingPolicy.fromWire(
        readStringOr(json, 'feedingPolicy', 'discouraged'),
      ),
      note: readStringOrNull(json, 'note'),
      fuzzRadiusM: readIntOr(json, 'fuzzRadiusM', defaultFuzzRadiusM),
      isSensitive: readBoolOr(json, 'isSensitive', false),
      noticeText: readStringOrNull(json, 'noticeText'),
      sortOrder: readIntOr(json, 'sortOrder', 0),
    );
  }

  final String id;
  final String name;

  /// 区域是**圆形**（契约冻结：`geo: { lat, lng, radiusM }`）。
  final Wgs84Point center;

  final int radiusM;

  /// 主要物种标签（`WildlifeSpecies.id` 列表）。
  final List<String> speciesIds;

  final FeedingPolicy feedingPolicy;
  final String? note;

  /// 该区域的位置模糊化半径（规格 §9.3 ②）。
  final int fuzzRadiusM;

  /// 敏感区（宿舍 / 保育区）→ **公开展示时只给区域不给坐标**（规格 §9.3 ①）。
  final bool isSensitive;

  /// 告示位文案（规格 §8.3）。
  final String? noticeText;

  final int sortOrder;

  bool get hasNotice => noticeText != null && noticeText!.trim().isNotEmpty;

  /// 地图气泡里的摘要（规格 §8.3：前 [zoneNoticeSummaryLength] 字）。
  String get noticeSummary {
    final String text = (noticeText ?? '').trim();
    if (text.isEmpty) return '';
    if (text.length <= zoneNoticeSummaryLength) return text;
    return '${text.substring(0, zoneNoticeSummaryLength)}…';
  }

  /// 该点是否落在区域内（校园尺度用平面距离即可）。
  bool covers(Wgs84Point point, {CampusProjection projection = CampusProjection.campus}) =>
      projection.metersBetween(center, point) <= radiusM;

  /// 到区域中心的距离（米）。
  double distanceToMeters(
    Wgs84Point point, {
    CampusProjection projection = CampusProjection.campus,
  }) => projection.metersBetween(center, point);

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'name': name,
    'species': speciesIds,
    'geo': <String, Object?>{...center.toJson(), 'radiusM': radiusM},
    'feedingPolicy': feedingPolicy.wire,
    'note': note,
    'fuzzRadiusM': fuzzRadiusM,
    'isSensitive': isSensitive,
    'noticeText': noticeText,
    'sortOrder': sortOrder,
  };

  @override
  bool operator ==(Object other) => other is WildlifeZone && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'WildlifeZone($id, $name, ${feedingPolicy.wire})';
}

/// 聚合热点（规格 §2.3）—— **派生只读资源**，由服务端 Worker 重算（§6.4）。
///
/// 客户端**没有任何写端点**，因此本类型也没有 `copyWith`。
/// [isAggregated] 与 [aggregationDelayHours] 是契约的一部分（规格 §10.4）：
/// 它们让客户端**无法**把聚合热点误当成「实时位置」展示（§8.1 E10）。
final class WildlifeSpot {
  const WildlifeSpot({
    required this.id,
    required this.speciesId,
    required this.centroid,
    required this.radiusM,
    required this.sightingCount,
    required this.firstSeenAt,
    required this.lastSeenAt,
    required this.computedAt,
    this.speciesNameZh,
    this.zoneId,
    this.distinctReporters = 0,
    this.hourHistogram = const <int>[],
    this.confidence = 0,
    this.algorithmVersion = '',
    this.isAggregated = true,
    this.aggregationDelayHours = defaultAggregationDelayHours,
  });

  factory WildlifeSpot.fromJson(Map<String, Object?> json) => WildlifeSpot(
    id: readString(json, 'id'),
    speciesId: readStringOr(json, 'speciesId', ''),
    centroid: Wgs84Point.fromJson(readMap(json, 'centroid')),
    radiusM: readIntOr(json, 'radiusM', 0),
    sightingCount: readIntOr(json, 'sightingCount', 0),
    firstSeenAt: readDateTime(json, 'firstSeenAt'),
    lastSeenAt: readDateTime(json, 'lastSeenAt'),
    computedAt: readDateTime(json, 'computedAt'),
    speciesNameZh: readStringOrNull(json, 'speciesNameZh'),
    zoneId: readStringOrNull(json, 'zoneId'),
    distinctReporters: readIntOr(json, 'distinctReporters', 0),
    hourHistogram: _normalizeHourHistogram(_readIntList(json, 'hourHistogram')),
    confidence: readDoubleOr(json, 'confidence', 0),
    algorithmVersion: readStringOr(json, 'algorithmVersion', ''),
    isAggregated: readBoolOr(json, 'isAggregated', true),
    aggregationDelayHours: readIntOr(
      json,
      'aggregationDelayHours',
      defaultAggregationDelayHours,
    ),
  );

  final String id;
  final String speciesId;
  final String? speciesNameZh;

  /// 落在哪个管理区域内（可空）。
  final String? zoneId;

  /// 聚类质心，**已模糊化**（规格 §9.3）。
  final Wgs84Point centroid;

  /// 95 分位半径。
  final int radiusM;

  /// 参与聚类的观测数（原始条数）。
  final int sightingCount;

  /// **去重上报人数** —— 反作弊的关键（规格 §6.2 ②：同一人多次上报只计 1 次）。
  final int distinctReporters;

  final DateTime firstSeenAt;
  final DateTime lastSeenAt;

  /// 24 小时分布直方图（"常见出没时段"）。解析时被规范为恰好 24 项。
  final List<int> hourHistogram;

  /// 0.000–1.000。
  final double confidence;

  final String algorithmVersion;
  final DateTime computedAt;

  /// 契约字段：**恒为 true**（聚合结果，不是实时位置）。
  final bool isAggregated;

  /// 契约字段：聚合延迟小时数（≥24）。
  final int aggregationDelayHours;

  /// 客户端**永远**不把它当实时位置 —— 这个 getter 存在就是为了让 UI 无法搞错。
  bool get isRealtime => false;

  /// 规格 §8.1 E10 / T24：`computedAt` 与当前时间至少相差 [aggregationDelayHours]。
  bool isAggregationDelayed(DateTime now) =>
      now.difference(computedAt) >= Duration(hours: aggregationDelayHours);

  /// 出现最多的 3 个时段（小时），供「常见出没时段」展示。纯逻辑，可测。
  List<int> get peakHours {
    final List<int> hours = <int>[
      for (int hour = 0; hour < hourHistogram.length; hour++)
        if (hourHistogram[hour] > 0) hour,
    ];
    hours.sort((int a, int b) {
      final int byCount = hourHistogram[b].compareTo(hourHistogram[a]);
      return byCount != 0 ? byCount : a.compareTo(b);
    });
    return hours.length <= 3 ? hours : hours.sublist(0, 3);
  }

  /// 「07:00–09:00 等时段」这类文案的纯数据部分（格式化留在 presentation）。
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
    'zoneId': zoneId,
    'centroid': centroid.toJson(),
    'radiusM': radiusM,
    'sightingCount': sightingCount,
    'distinctReporters': distinctReporters,
    'firstSeenAt': isoUtc(firstSeenAt),
    'lastSeenAt': isoUtc(lastSeenAt),
    'hourHistogram': hourHistogram,
    'confidence': confidence,
    'algorithmVersion': algorithmVersion,
    'computedAt': isoUtc(computedAt),
    'isAggregated': isAggregated,
    'aggregationDelayHours': aggregationDelayHours,
  };

  @override
  bool operator ==(Object other) => other is WildlifeSpot && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WildlifeSpot($id, ${speciesNameZh ?? speciesId}, n=$sightingCount, '
      'reporters=$distinctReporters)';
}

/// 已命名的个体（规格 §2.8）—— R6「也可以手动给个名字」的第二种解读。
final class WildlifeIndividual {
  const WildlifeIndividual({
    required this.id,
    required this.name,
    required this.speciesId,
    this.speciesNameZh,
    this.description,
    this.coverPhotoUrl,
    this.status = WildlifeModerationStatus.pending,
    this.isActive = true,
  });

  factory WildlifeIndividual.fromJson(Map<String, Object?> json) => WildlifeIndividual(
    id: readString(json, 'id'),
    name: readStringOr(json, 'name', ''),
    speciesId: readStringOr(json, 'speciesId', ''),
    speciesNameZh: readStringOrNull(json, 'speciesNameZh'),
    description: readStringOrNull(json, 'description'),
    coverPhotoUrl: readStringOrNull(json, 'coverPhotoUrl'),
    status: WildlifeModerationStatus.fromWire(readStringOr(json, 'status', 'PENDING')),
    isActive: readBoolOr(json, 'isActive', true),
  );

  /// 个体名（≤24 字），如「大橘」「鹅鹅」。
  final String name;

  final String id;
  final String speciesId;
  final String? speciesNameZh;
  final String? description;
  final String? coverPhotoUrl;
  final WildlifeModerationStatus status;
  final bool isActive;

  /// 只有**已审核通过**且启用的个体才对外可见（规格 §2.8：防止恶搞命名）。
  bool get isPublic => status.isPublic && isActive;

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'name': name,
    'speciesId': speciesId,
    'speciesNameZh': speciesNameZh,
    'description': description,
    'coverPhotoUrl': coverPhotoUrl,
    'status': status.wire,
    'isActive': isActive,
  };

  @override
  bool operator ==(Object other) => other is WildlifeIndividual && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'WildlifeIndividual($id, $name)';
}

/// 底图许可标识（规格 §1.4）。
enum BasemapLicense {
  /// 原创自绘示意图（Phase 1 采用，无授权风险）。
  original('original', '原创自绘'),

  /// OpenStreetMap 数据渲染（ODbL，需署名 + share-alike）。
  odbl('odbl', 'OSM / ODbL'),

  /// 校方授权（需 `docs/legal/basemap-authorization.md`，由 CI 校验）。
  schoolAuthorized('school-authorized', '校方授权'),

  unknown('unknown', '未知许可');

  const BasemapLicense(this.wire, this.label);

  final String wire;
  final String label;

  static BasemapLicense fromWire(String wire) {
    for (final BasemapLicense license in BasemapLicense.values) {
      if (license.wire == wire) return license;
    }
    return BasemapLicense.unknown;
  }
}

/// 校园底图配置（规格 §1.4 `CampusBasemap`）。
///
/// 底图是**可配置资源**：拿到校方授权（未决问题 U1）后只需替换配置，
/// 客户端代码不变。P1 阶段 [imageUrl] 为空 —— 此时本端渲染内置的**示意图**
/// （`presentation/components/campus_sketch.dart`），叠加层逻辑完全相同。
final class CampusBasemap {
  const CampusBasemap({
    required this.version,
    required this.affine,
    required this.calibrationRmsePx,
    required this.controlPointCount,
    this.imageUrl = '',
    this.widthPx = 0,
    this.heightPx = 0,
    this.attribution = '',
    this.license = BasemapLicense.original,
  });

  factory CampusBasemap.fromJson(Map<String, Object?> json) {
    final Object? rawAffine = json['affine'];
    return CampusBasemap(
      version: readStringOr(json, 'version', ''),
      imageUrl: readStringOr(json, 'imageUrl', ''),
      widthPx: readIntOr(json, 'widthPx', 0),
      heightPx: readIntOr(json, 'heightPx', 0),
      affine: BasemapAffine.fromCoefficients(
        rawAffine is List<Object?> ? rawAffine : const <Object?>[],
      ),
      calibrationRmsePx: readDoubleOr(json, 'calibrationRmsePx', double.infinity),
      controlPointCount: readIntOr(json, 'controlPointCount', 0),
      attribution: readStringOr(json, 'attribution', ''),
      license: BasemapLicense.fromWire(readStringOr(json, 'license', 'original')),
    );
  }

  /// 规格 §1.4 的 CI 规则编号（`details.reason` 风格）。
  static const String rmseTooHigh = 'BASEMAP_RMSE_TOO_HIGH';
  static const String controlPointsInsufficient = 'BASEMAP_CONTROL_POINTS_INSUFFICIENT';
  static const String attributionRequired = 'BASEMAP_ATTRIBUTION_REQUIRED';
  static const String licenseUnknown = 'BASEMAP_LICENSE_UNKNOWN';
  static const String sizeInvalid = 'BASEMAP_SIZE_INVALID';

  /// 版本号，用于缓存失效。
  final String version;

  /// 底图图片 URL；空表示使用内置示意图。
  final String imageUrl;

  final int widthPx;
  final int heightPx;

  /// WGS84 → 像素的 6 参数仿射（规格 §3.4）。
  final BasemapAffine affine;

  /// 标定残差 RMSE（像素），必须 < [basemapMaxRmsePx]。
  final double calibrationRmsePx;

  /// 控制点数量，必须 ≥ [basemapMinControlPoints]。
  final int controlPointCount;

  /// 署名文本（[BasemapLicense.odbl] 时非空）。
  final String attribution;

  final BasemapLicense license;

  bool get hasImage => imageUrl.trim().isNotEmpty;

  /// 规格 §1.4 的机器可检查约束。
  ///
  /// **为什么客户端也要校验**：底图配置错了会让**所有**点位整体偏移，
  /// 而这种错误「看起来像数据错了」，极难排查（规格 §3.1 的原话）。
  /// 因此宁可整页显示「底图配置不可用」，也不要画一张标定错误的图。
  List<String> validate() {
    final List<String> issues = <String>[];
    if (!(calibrationRmsePx < basemapMaxRmsePx)) {
      issues.add(rmseTooHigh);
    }
    if (controlPointCount < basemapMinControlPoints) {
      issues.add(controlPointsInsufficient);
    }
    if (license == BasemapLicense.unknown) {
      issues.add(licenseUnknown);
    }
    if (license == BasemapLicense.odbl && attribution.trim().isEmpty) {
      issues.add(attributionRequired);
    }
    if (widthPx <= 0 || heightPx <= 0) {
      issues.add(sizeInvalid);
    }
    return issues;
  }

  bool get isRenderable => validate().isEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
    'version': version,
    'imageUrl': imageUrl,
    'widthPx': widthPx,
    'heightPx': heightPx,
    'affine': affine.coefficients,
    'calibrationRmsePx': calibrationRmsePx,
    'controlPointCount': controlPointCount,
    'attribution': attribution,
    'license': license.wire,
  };

  @override
  bool operator ==(Object other) =>
      other is CampusBasemap && other.version == version && other.imageUrl == imageUrl;

  @override
  int get hashCode => Object.hash(version, imageUrl);

  @override
  String toString() =>
      'CampusBasemap($version, ${widthPx}x$heightPx, ${license.wire}, '
      'rmse=${calibrationRmsePx.toStringAsFixed(2)}px)';
}

/// 热点查询参数（规格 §10.4：`species` / `zoneId` / `minConfidence` / `limit`）。
final class WildlifeSpotQuery {
  const WildlifeSpotQuery({
    this.speciesId,
    this.zoneId,
    this.minConfidence = defaultMinConfidence,
    this.cursor,
    this.limit = defaultPageSize,
  });

  /// 规格 §10.4：默认 `0.3`。
  static const double defaultMinConfidence = 0.3;

  final String? speciesId;
  final String? zoneId;
  final double minConfidence;
  final String? cursor;
  final int limit;

  Map<String, Object?> toQuery() => <String, Object?>{
    ...PageQuery(cursor: cursor, limit: limit).toQuery(),
    if (speciesId != null && speciesId!.isNotEmpty) 'species': speciesId,
    if (zoneId != null && zoneId!.isNotEmpty) 'zoneId': zoneId,
    'minConfidence': minConfidence,
  };

  WildlifeSpotQuery copyWith({
    String? speciesId,
    String? zoneId,
    double? minConfidence,
    String? cursor,
    int? limit,
  }) => WildlifeSpotQuery(
    speciesId: speciesId ?? this.speciesId,
    zoneId: zoneId ?? this.zoneId,
    minConfidence: minConfidence ?? this.minConfidence,
    cursor: cursor ?? this.cursor,
    limit: limit ?? this.limit,
  );
}

/// 找出包含该点的区域；命中多个时取**半径最小**的那个（最具体的区域）。
///
/// 纯逻辑，供「在地图上点选位置 → 自动选中区域」使用（规格 §8.3：
/// 选中 `forbidden` 区域时上报表单要出红色警告条）。
WildlifeZone? zoneContaining(
  Wgs84Point point,
  List<WildlifeZone> zones, {
  CampusProjection projection = CampusProjection.campus,
}) {
  WildlifeZone? best;
  for (final WildlifeZone zone in zones) {
    if (!zone.covers(point, projection: projection)) continue;
    if (best == null || zone.radiusM < best.radiusM) best = zone;
  }
  return best;
}

/// 上科大所在时区的月份（规格 §9.4 的 `monthInShanghai`）。
///
/// 本端不引时区库：东八区是固定偏移（无夏令时），因此直接加 8 小时后取月份。
int shanghaiMonth(DateTime at) => at.toUtc().add(const Duration(hours: 8)).month;

/// 伦理提示的精简版（规格 §8.2：**≤5 条，每条 ≤20 字**）。
///
/// 这是**上报表单的一次性操作确认**，不是同意门：缺它只拒绝**该次提交**，
/// 浏览地图 / 看区域 / 看别人的上报完全不受影响（契约 §9 的同意门只适用于
/// `wellbeing` / `dorm-harmony` / `ai-portrait`，`wildlife` 不在其中）。
const List<String> wildlifeEthicsRules = <String>[
  '禁止投喂人类食物',
  '禁止追撵、捕捉、触摸',
  '禁止用食物引诱拍摄',
  '夜间禁用闪光灯',
  '不公开巢穴与育雏位置',
];

/// 伦理确认的勾选文案（规格 §8.2）。
const String wildlifeEthicsAckLabel = '我已阅读并遵守';

/// 健康异常时给用户的处置提示（规格 §8.1 E7：**不得自行处理**）。
const String wildlifeHealthConcernNotice = '发现受伤或异常动物请勿自行处理，我们会通知校园动物社团。';

/// 位置模糊化的公开说明（规格 §9：**不能说"完全匿名"**）。
const String wildlifeLocationFuzzedNotice = '位置已模糊化到片区级（约百米），不显示精确坐标。';

/// 读取区域的物种标签：契约字段是 `species`，Prisma 草案是 `speciesIds`，两种都读。
List<String> _readSpeciesIds(Map<String, Object?> json) {
  final List<String> primary = readStringList(json, 'species');
  return primary.isNotEmpty ? primary : readStringList(json, 'speciesIds');
}

/// 读取 `List<int>`（容忍字符串数字；非数字元素丢弃）。
List<int> _readIntList(Map<String, Object?> json, String key) => readListOrEmpty(json, key)
    .map((Object? value) => value is int ? value : int.tryParse('$value'))
    .whereType<int>()
    .toList(growable: false);

/// 把直方图规范为恰好 24 项（后端多给/少给都不至于让 UI 崩）。
List<int> _normalizeHourHistogram(List<int> raw) => <int>[
  for (int hour = 0; hour < 24; hour++)
    if (hour < raw.length) raw[hour] else 0,
];
