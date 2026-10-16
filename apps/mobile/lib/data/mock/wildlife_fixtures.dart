/// `wildlife` 的 mock 数据（**无后端可跑**，契约 §7 硬规则 4）。
///
/// ## 诚实标注（与规格 §2.5 / §12 U2 一致）
///
/// 下面的物种清单是**基于「上科大校园有猫、鸟、黑天鹅」这一前提的合理推测**，
/// **没有做过实地物种调查**。真实清单必须由校园动物社团 / 生物教师确认后录入。
/// 区域名与位置同样是**示意性的**（校园平面图与边界框的实测值至今未知，U3）。
///
/// 这些数据的作用是让 UI、三态、隐私规则、坐标映射**在没有后端时就能被验证**，
/// 不是"上科大的真实动物分布"。
library;

import '../../domain/models/geo.dart';
import '../../domain/models/wildlife.dart';
import '../../domain/models/wildlife_sighting.dart';
import '../../domain/models/wildlife_track.dart';
import 'mock_fixtures.dart';


/// mock 物种 id（真实环境是 ULID；mock 用可读 id，便于断言）。
const String mockSpeciesCat = 'sp-cat';
const String mockSpeciesSwan = 'sp-swan';
const String mockSpeciesDuck = 'sp-duck';
const String mockSpeciesSparrow = 'sp-sparrow';
const String mockSpeciesDove = 'sp-dove';
const String mockSpeciesEgret = 'sp-egret';
const String mockSpeciesMagpie = 'sp-magpie';

/// mock 区域 id。
const String mockZoneLibraryLawn = 'wz-lib-lawn';
const String mockZoneLake = 'wz-lake';
const String mockZoneDorm = 'wz-dorm';
const String mockZoneCanteen = 'wz-canteen';

/// 7 个物种（规格 §2.5 的种子表，**推测值**）。
const List<WildlifeSpecies> mockWildlifeSpecies = <WildlifeSpecies>[
  WildlifeSpecies(
    id: mockSpeciesCat,
    scientificName: 'Felis catus',
    commonNameZh: '猫',
    commonNameEn: 'Domestic cat',
    defaultFeedingPolicy: FeedingPolicy.discouraged,
  ),
  WildlifeSpecies(
    id: mockSpeciesSwan,
    scientificName: 'Cygnus atratus',
    commonNameZh: '黑天鹅',
    commonNameEn: 'Black swan',
    // 校方管理资产 → 保护级审核 + 繁殖期（3–6 月）加强模糊。
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: <int>[3, 4, 5, 6],
    defaultFeedingPolicy: FeedingPolicy.forbidden,
  ),
  WildlifeSpecies(
    id: mockSpeciesDuck,
    scientificName: 'Anas platyrhynchos',
    commonNameZh: '绿头鸭',
    commonNameEn: 'Mallard',
    isNestingSensitive: true,
    nestingMonths: <int>[3, 4, 5, 6],
    defaultFeedingPolicy: FeedingPolicy.discouraged,
  ),
  WildlifeSpecies(
    id: mockSpeciesSparrow,
    scientificName: 'Passer montanus',
    commonNameZh: '麻雀',
    commonNameEn: 'Eurasian tree sparrow',
    defaultFeedingPolicy: FeedingPolicy.forbidden,
  ),
  WildlifeSpecies(
    id: mockSpeciesDove,
    scientificName: 'Spilopelia chinensis',
    commonNameZh: '珠颈斑鸠',
    commonNameEn: 'Spotted dove',
    defaultFeedingPolicy: FeedingPolicy.forbidden,
  ),
  WildlifeSpecies(
    id: mockSpeciesEgret,
    scientificName: 'Egretta garzetta',
    commonNameZh: '白鹭',
    commonNameEn: 'Little egret',
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: <int>[4, 5, 6, 7],
    defaultFeedingPolicy: FeedingPolicy.forbidden,
  ),
  WildlifeSpecies(
    id: mockSpeciesMagpie,
    scientificName: 'Pica serica',
    commonNameZh: '喜鹊',
    commonNameEn: 'Oriental magpie',
    defaultFeedingPolicy: FeedingPolicy.forbidden,
  ),
];

/// 黑天鹅告示位文案（规格 §8.3 的**草案**，未经校方或社团审核）。
const String mockSwanNotice =
    '黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂（面包、零食等人类食物会损害它们的健康）。'
    '请勿追撵、捕捉或近距离惊扰。繁殖期请勿靠近巢区，也请勿在平台上公开巢穴位置。'
    '发现受伤或异常，请在平台上标记「疑似受伤」，我们会通知社团处理。';

/// 4 个区域（人工定义 / 管理端维护，规格 §2.2）。
final List<WildlifeZone> mockWildlifeZones = <WildlifeZone>[
  WildlifeZone(
    id: mockZoneLibraryLawn,
    name: '图书馆后草坪',
    center: const Wgs84Point(lat: 31.17860, lng: 121.59020),
    radiusM: 80,
    speciesIds: const <String>[mockSpeciesCat, mockSpeciesMagpie],
    feedingPolicy: FeedingPolicy.discouraged,
    note: '猫群主要聚集地，傍晚出现频率最高。',
    noticeText: '请不要投喂人类食物；拍照请勿使用闪光灯。',
    sortOrder: 1,
  ),
  WildlifeZone(
    id: mockZoneLake,
    name: '人工湖（黑天鹅水域）',
    center: const Wgs84Point(lat: 31.17720, lng: 121.59130),
    radiusM: 120,
    speciesIds: const <String>[mockSpeciesSwan, mockSpeciesDuck, mockSpeciesEgret],
    feedingPolicy: FeedingPolicy.forbidden,
    note: '黑天鹅与绿头鸭的主要活动水域，繁殖期（3–6 月）请勿靠近岸边巢区。',
    noticeText: mockSwanNotice,
    sortOrder: 2,
  ),
  WildlifeZone(
    id: mockZoneCanteen,
    name: '一食堂后门',
    center: const Wgs84Point(lat: 31.17790, lng: 121.58900),
    radiusM: 60,
    speciesIds: const <String>[mockSpeciesCat],
    feedingPolicy: FeedingPolicy.discouraged,
    note: '流浪猫常在餐后出现。',
    sortOrder: 3,
  ),
  WildlifeZone(
    id: mockZoneDorm,
    name: '宿舍区（敏感区）',
    center: const Wgs84Point(lat: 31.17930, lng: 121.58880),
    radiusM: 100,
    speciesIds: const <String>[mockSpeciesCat],
    feedingPolicy: FeedingPolicy.forbidden,
    note: '宿舍区。公开数据**只给区域，不给任何坐标**（规格 §9.3 ①）。',
    // 敏感区：模糊半径更粗，且服务端不下发坐标。
    fuzzRadiusM: 200,
    isSensitive: true,
    sortOrder: 4,
  ),
];

/// 4 个聚合热点（**派生只读**，`computedAt` 至少比当前时间早 24 小时）。
final List<WildlifeSpot> mockWildlifeSpots = <WildlifeSpot>[
  WildlifeSpot(
    id: 'ws-lib-cat',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    zoneId: mockZoneLibraryLawn,
    centroid: const Wgs84Point(lat: 31.17855, lng: 121.59015),
    radiusM: 62,
    sightingCount: 24,
    distinctReporters: 9,
    firstSeenAt: mockNow.subtract(const Duration(days: 45)),
    lastSeenAt: mockNow.subtract(const Duration(days: 1)),
    computedAt: mockNow.subtract(const Duration(hours: 26)),
    hourHistogram: const <int>[
      0, 0, 0, 0, 0, 0, 2, 5, 8, 4, 1, 0,
      0, 0, 0, 0, 0, 3, 7, 9, 5, 2, 0, 0,
    ],
    confidence: 0.72,
    algorithmVersion: 'dbscan-v1',
  ),
  WildlifeSpot(
    id: 'ws-lake-swan',
    speciesId: mockSpeciesSwan,
    speciesNameZh: '黑天鹅',
    zoneId: mockZoneLake,
    centroid: const Wgs84Point(lat: 31.17715, lng: 121.59135),
    radiusM: 88,
    sightingCount: 31,
    distinctReporters: 12,
    firstSeenAt: mockNow.subtract(const Duration(days: 60)),
    lastSeenAt: mockNow.subtract(const Duration(hours: 20)),
    computedAt: mockNow.subtract(const Duration(hours: 30)),
    hourHistogram: const <int>[
      0, 0, 0, 0, 0, 1, 3, 6, 9, 7, 4, 2,
      1, 0, 0, 0, 2, 4, 6, 5, 3, 1, 0, 0,
    ],
    confidence: 0.81,
    algorithmVersion: 'dbscan-v1',
  ),
  WildlifeSpot(
    id: 'ws-canteen-cat',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    zoneId: mockZoneCanteen,
    centroid: const Wgs84Point(lat: 31.17785, lng: 121.58905),
    radiusM: 40,
    sightingCount: 12,
    distinctReporters: 5,
    firstSeenAt: mockNow.subtract(const Duration(days: 20)),
    lastSeenAt: mockNow.subtract(const Duration(days: 2)),
    computedAt: mockNow.subtract(const Duration(hours: 26)),
    hourHistogram: const <int>[
      0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 3,
      8, 6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    confidence: 0.45,
    algorithmVersion: 'dbscan-v1',
  ),
  WildlifeSpot(
    id: 'ws-dorm-cat',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    zoneId: mockZoneDorm,
    centroid: const Wgs84Point(lat: 31.17925, lng: 121.58885),
    radiusM: 55,
    sightingCount: 9,
    distinctReporters: 4,
    firstSeenAt: mockNow.subtract(const Duration(days: 15)),
    lastSeenAt: mockNow.subtract(const Duration(days: 3)),
    computedAt: mockNow.subtract(const Duration(hours: 28)),
    hourHistogram: const <int>[
      1, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0,
    ],
    confidence: 0.5,
    algorithmVersion: 'dbscan-v1',
  ),
];

/// 2 条推断轨迹（规格 §6：**不是**实测路径）。
final List<WildlifeTrack> mockWildlifeTracks = <WildlifeTrack>[
  WildlifeTrack(
    id: 'wt-lake-swan',
    speciesId: mockSpeciesSwan,
    speciesNameZh: '黑天鹅',
    spotIds: const <String>['ws-lake-swan'],
    path: const <Wgs84Point>[
      Wgs84Point(lat: 31.17705, lng: 121.59095),
      Wgs84Point(lat: 31.17720, lng: 121.59130),
      Wgs84Point(lat: 31.17742, lng: 121.59158),
    ],
    totalDistanceM: 78,
    spanStartAt: mockNow.subtract(const Duration(days: 30)),
    spanEndAt: mockNow.subtract(const Duration(hours: 20)),
    sightingCount: 31,
    confidence: 0.58,
    computedAt: mockNow.subtract(const Duration(hours: 30)),
    disclaimer: '本轨迹由 31 次同学上报推断得出，并非实测运动路径。',
  ),
  WildlifeTrack(
    id: 'wt-campus-cat',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    spotIds: const <String>['ws-lib-cat', 'ws-canteen-cat'],
    path: const <Wgs84Point>[
      Wgs84Point(lat: 31.17855, lng: 121.59015),
      Wgs84Point(lat: 31.17820, lng: 121.58960),
      Wgs84Point(lat: 31.17785, lng: 121.58905),
    ],
    totalDistanceM: 152,
    spanStartAt: mockNow.subtract(const Duration(days: 21)),
    spanEndAt: mockNow.subtract(const Duration(days: 1)),
    sightingCount: 36,
    confidence: 0.41,
    computedAt: mockNow.subtract(const Duration(hours: 26)),
    // 刻意留空：客户端必须用兜底文案，**不能让"推断"这个前提消失**。
    disclaimer: '',
  ),
];

/// 3 个命名个体（规格 §2.8；其中 1 个仍在审核中 → 公开列表里不应出现）。
final List<WildlifeIndividual> mockWildlifeIndividuals = <WildlifeIndividual>[
  WildlifeIndividual(
    id: 'wi-daju',
    name: '大橘',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    description: '橘色短毛，右耳缺一小块，常在图书馆后草坪。',
    status: WildlifeModerationStatus.published,
  ),
  WildlifeIndividual(
    id: 'wi-eer',
    name: '鹅鹅',
    speciesId: mockSpeciesSwan,
    speciesNameZh: '黑天鹅',
    description: '体型偏大，左腿有浅色环志。',
    status: WildlifeModerationStatus.published,
  ),
  WildlifeIndividual(
    id: 'wi-xiaohei',
    name: '小黑',
    speciesId: mockSpeciesCat,
    description: '待审核的命名，**不应出现在公开列表**。',
    status: WildlifeModerationStatus.pending,
  ),
];

/// 观测记录（`GET /items` 只返回 `PUBLISHED`，规格 §10.1 #9）。
///
/// 覆盖：已发布 / 待审核（本人）/ 未通过 / **敏感区无坐标** / 自动分类 / 疑似受伤。
final List<WildlifeSighting> mockWildlifeSightings = <WildlifeSighting>[
  WildlifeSighting(
    id: 'wl-1001',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    status: WildlifeModerationStatus.published,
    // 模糊化后的公开坐标（网格吸附到 50 m）。
    geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
    observedAt: mockNow.subtract(const Duration(hours: 3)),
    observedAtFuzzed: mockNow.subtract(const Duration(hours: 3)),
    createdAt: mockNow.subtract(const Duration(hours: 2, minutes: 40)),
    zoneId: mockZoneLibraryLawn,
    zoneName: '图书馆后草坪',
    photoUrls: const <String>['https://cdn.kedaya.local/wildlife/mock/wl-1001/thumb.webp'],
    individualId: 'wi-daju',
    individualName: '大橘',
    note: '在草坪长椅下面，两只。',
    reporterDisplayName: '鸭鸭一号',
  ),
  WildlifeSighting(
    id: 'wl-1002',
    speciesId: mockSpeciesSwan,
    speciesNameZh: '黑天鹅',
    status: WildlifeModerationStatus.published,
    geo: const Wgs84Point(lat: 31.17720, lng: 121.59130),
    observedAt: mockNow.subtract(const Duration(hours: 26)),
    observedAtFuzzed: mockNow.subtract(const Duration(hours: 26)),
    createdAt: mockNow.subtract(const Duration(hours: 25)),
    zoneId: mockZoneLake,
    zoneName: '人工湖（黑天鹅水域）',
    photoUrls: const <String>['https://cdn.kedaya.local/wildlife/mock/wl-1002/thumb.webp'],
    individualId: 'wi-eer',
    individualName: '鹅鹅',
    reporterDisplayName: '湖边散步者',
  ),
  WildlifeSighting(
    id: 'wl-1003',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    // 待审核：**只有本人**能看到（列表页不出现）。
    status: WildlifeModerationStatus.pending,
    geo: const Wgs84Point(lat: 31.17790, lng: 121.58900),
    observedAt: mockNow.subtract(const Duration(hours: 1)),
    createdAt: mockNow.subtract(const Duration(minutes: 50)),
    zoneId: mockZoneCanteen,
    zoneName: '一食堂后门',
    reporterDisplayName: '可达鸭测试账号',
  ),
  WildlifeSighting(
    id: 'wl-1004',
    speciesId: mockSpeciesMagpie,
    speciesNameZh: '喜鹊',
    // 未通过：对外按不存在处理。
    status: WildlifeModerationStatus.rejected,
    geo: const Wgs84Point(lat: 31.17800, lng: 121.59000),
    observedAt: mockNow.subtract(const Duration(days: 2)),
    createdAt: mockNow.subtract(const Duration(days: 2)),
    reporterDisplayName: '路人甲',
  ),
  WildlifeSighting(
    id: 'wl-1005',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    status: WildlifeModerationStatus.published,
    // ⚠️ 敏感区（宿舍）：**没有 geo**（规格 §9.3 ① / T10）。
    zoneId: mockZoneDorm,
    zoneName: '宿舍区（敏感区）',
    observedAt: mockNow.subtract(const Duration(days: 5)),
    observedAtFuzzed: mockNow.subtract(const Duration(days: 5)),
    createdAt: mockNow.subtract(const Duration(days: 5)),
    reporterDisplayName: '匿名同学',
    isAnonymous: true,
  ),
  WildlifeSighting(
    id: 'wl-1006',
    speciesId: mockSpeciesDuck,
    speciesNameZh: '绿头鸭',
    status: WildlifeModerationStatus.published,
    geo: const Wgs84Point(lat: 31.17715, lng: 121.59135),
    observedAt: mockNow.subtract(const Duration(hours: 8)),
    observedAtFuzzed: mockNow.subtract(const Duration(hours: 8)),
    createdAt: mockNow.subtract(const Duration(hours: 7)),
    zoneId: mockZoneLake,
    zoneName: '人工湖（黑天鹅水域）',
    // 自动分类的结果：**必须**显示"仅供参考，请确认"（规格 §5.7）。
    autoSpeciesId: mockSpeciesDuck,
    autoConfidence: 0.71,
    classifiedBy: ClassifiedBy.visionApi,
    reporterDisplayName: '观鸟社同学',
  ),
  WildlifeSighting(
    id: 'wl-1007',
    speciesId: mockSpeciesCat,
    speciesNameZh: '猫',
    status: WildlifeModerationStatus.published,
    geo: const Wgs84Point(lat: 31.17850, lng: 121.59000),
    observedAt: mockNow.subtract(const Duration(hours: 30)),
    observedAtFuzzed: mockNow.subtract(const Duration(hours: 30)),
    createdAt: mockNow.subtract(const Duration(hours: 29)),
    zoneId: mockZoneLibraryLawn,
    zoneName: '图书馆后草坪',
    healthConcern: true,
    note: '左前腿有点瘸，走路一瘸一拐。',
    reporterDisplayName: '夜跑同学',
  ),
];

/// mock 认为「是当前用户上报的」记录 id（用于验证"自己的待审核记录可见"）。
const Set<String> mockOwnSightingIds = <String>{'wl-1001', 'wl-1003', 'wl-1007'};

/// mock 底图配置。
///
/// [CampusBasemap.imageUrl] 为空 → 客户端渲染内置的示意图
/// （`presentation/components/campus_sketch.dart`），叠加层逻辑完全相同。
/// 仿射矩阵：[u, v] = [x + 500, -y + 400]，即 **1 米 ≈ 1 像素**、y 轴向上为北。
/// 这不是"实测标定"（U3 未解决），而是与示意图尺寸自洽的占位标定。
final CampusBasemap mockCampusBasemap = CampusBasemap(
  version: 'mock-sketch-v1',
  widthPx: 1000,
  heightPx: 700,
  affine: const BasemapAffine(a: 1, b: 0, c: 500, d: 0, e: -1, f: 400),
  // 标定残差与控制点数满足规格 §1.4 的 CI 阈值（否则客户端会拒绝渲染）。
  calibrationRmsePx: 1.8,
  controlPointCount: 8,
  attribution: '底图为示意性自绘（P1 路径），非测绘精度',
  license: BasemapLicense.original,
);
