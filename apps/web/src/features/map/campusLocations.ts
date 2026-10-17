/**
 * 校园地图 · 25 个地点（`CAMPUS_LOCATION_DEFS`）在真实校园里的坐标
 * =====================================================================
 *
 * ## 这份表是什么
 *
 * `@kedaya/contracts` 的 `CAMPUS_LOCATION_DEFS` 定义了 25 个**地点名**（白名单），
 * 但它**没有坐标** —— 它服务的是"用户选地点"，不是"地图上画点"。
 * 本文件给每个地点补上 **WGS84 坐标 + 定位依据 + 可信度**，供地图标注使用。
 *
 * ## 可信度必须诚实标注（本仓库的硬要求）
 *
 * | `confidence` | 含义 | 本表数量 |
 * | --- | --- | --- |
 * | `high` | 直接命中 OSM 的命名要素，或由多栋宿舍的几何中心导出 | 10 |
 * | `medium` | 就近推断（同名/同功能要素，或按区域类型对应） | 7 |
 * | `low` | 近似放置（OSM **没有**测绘该要素，按相邻地标推断） | 8 |
 *
 * `evidence` 是给人看的一句话，必须说清"凭什么"。
 * **禁止**把 `low` 写成 `high`：那会让"图书馆后草坪的猫"落到一栋没有名字的楼上，
 * 而且看起来像数据错了。
 *
 * ## 与数据文件的关系
 *
 * 这里是应用层的**唯一真相**；`public/map/campus-poi.json` 的 `locations` 是
 * 同一批数据的**可离线分发副本**。`campusAssets.test.ts` 会断言两者逐项相等，
 * 任何一边手改都会红。
 */
import type { LatLng } from '@kedaya/shared';

/** 定位可信度（见文件头表格） */
export type CampusLocationConfidence = 'high' | 'medium' | 'low';

/** 定位依据的种类（机器可读；`evidence` 是给人看的一句话） */
export type CampusLocationEvidenceKind =
  | 'osm-named'
  | 'osm-inferred'
  | 'osm-derived'
  | 'approximate'
  | 'off-campus-inferred';

export interface CampusLocation {
  /** 与 `CAMPUS_LOCATION_DEFS[].key` 一致 */
  readonly key: string;
  /** 与 `CAMPUS_LOCATION_DEFS[].label` 一致（**上线值**） */
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly confidence: CampusLocationConfidence;
  readonly evidenceKind: CampusLocationEvidenceKind;
  /** 相关 OSM 要素 id（way/node/relation 的 id，不含类型前缀） */
  readonly osmIds: readonly number[];
  /** 定位依据（人话，必须能解释"凭什么"） */
  readonly evidence: string;
}

export const CAMPUS_MAP_LOCATIONS: readonly CampusLocation[] = [
  {
    key: 'library',
    label: '图书馆',
    lat: 31.177398,
    lng: 121.592341,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [832289398],
    evidence: 'OSM way 832289398「上海科技大学图书馆」中心点',
  },
  {
    key: 'canteen-1',
    label: '一食堂',
    lat: 31.18028,
    lng: 121.593059,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [1478884442],
    evidence:
      'OSM「餐饮中心 #1」（food_court）。OSM 未把序号与「一/二/三」对应，按 #1→一、#2→二、#3→三 推测',
  },
  {
    key: 'canteen-2',
    label: '二食堂',
    lat: 31.179473,
    lng: 121.592747,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [1478884443],
    evidence: 'OSM「餐饮中心 #2」（food_court）；序号到中文名的映射为推测',
  },
  {
    key: 'canteen-3',
    label: '三食堂',
    lat: 31.178526,
    lng: 121.592332,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [587651665],
    evidence: 'OSM「餐饮中心 #3」（food_court）；序号到中文名的映射为推测',
  },
  {
    key: 'gym',
    label: '体育馆',
    lat: 31.178667,
    lng: 121.59381,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [587691936],
    evidence: 'OSM「上海科技大学体育馆」（leisure=fitness_centre）',
  },
  {
    key: 'badminton-hall',
    label: '羽毛球馆',
    lat: 31.1788,
    lng: 121.59413,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [],
    evidence: 'OSM 未单独测绘羽毛球馆；按通常与体育馆同址，放在体育馆东侧约 25 m（推测）',
  },
  {
    key: 'swimming-pool',
    label: '游泳馆',
    lat: 31.182029,
    lng: 121.592869,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [832289364],
    evidence: 'OSM「上海科技大学游泳馆」（leisure=sports_centre, sport=swimming）',
  },
  {
    key: 'track-field',
    label: '田径场',
    lat: 31.17849,
    lng: 121.595232,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [832685906],
    evidence: 'OSM leisure=track, sport=running 的东侧跑道；未命名，按校园唯一标准田径场推测',
  },
  {
    key: 'basketball-court',
    label: '篮球场',
    lat: 31.1782,
    lng: 121.5946,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [],
    evidence: 'OSM 无 sport=basketball 要素；按体育馆东南侧运动场地近似放置（推测）',
  },
  {
    key: 'tennis-court',
    label: '网球场',
    lat: 31.181699,
    lng: 121.591759,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [832289379],
    evidence: 'OSM leisure=pitch, sport=tennis；未命名，按位置与场地类型对应',
  },
  {
    key: 'fitness-room',
    label: '健身房',
    lat: 31.17865,
    lng: 121.59388,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [],
    evidence: 'OSM 无独立要素；按位于体育馆内/同址处理（推测）',
  },
  {
    key: 'teaching-a',
    label: '教学楼A',
    lat: 31.177736,
    lng: 121.59062,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [542603582],
    evidence:
      'OSM「上海科技大学教学中心」是一整栋长条建筑（约 110 m）；A/B/C 三栋未分别标注，沿建筑长轴等距近似',
  },
  {
    key: 'teaching-b',
    label: '教学楼B',
    lat: 31.177736,
    lng: 121.590927,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [542603582],
    evidence: '同上：教学中心中段近似位置（推测）',
  },
  {
    key: 'teaching-c',
    label: '教学楼C',
    lat: 31.177736,
    lng: 121.591235,
    confidence: 'low',
    evidenceKind: 'approximate',
    osmIds: [542603582],
    evidence: '同上：教学中心东段近似位置（推测）',
  },
  {
    key: 'student-center',
    label: '学生活动中心',
    lat: 31.179787,
    lng: 121.592136,
    confidence: 'low',
    evidenceKind: 'osm-inferred',
    osmIds: [587638228],
    evidence:
      'OSM「校园服务中心（H1楼）」；「学生活动中心」在 OSM 无同名要素，H1/H2 二者取其一为推测',
  },
  {
    key: 'academic-exchange-center',
    label: '学术交流中心',
    lat: 31.182203,
    lng: 121.593374,
    confidence: 'medium',
    evidenceKind: 'osm-inferred',
    osmIds: [832289363],
    evidence: 'OSM「上海科技大学会议中心」；与「学术交流中心」名称不同但功能最接近，属推测',
  },
  {
    key: 'school-entrepreneurship',
    label: '创管学院',
    lat: 31.178724,
    lng: 121.590606,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [508053661],
    evidence: 'OSM「创业与管理学院」',
  },
  {
    key: 'school-information',
    label: '信息学院',
    lat: 31.179781,
    lng: 121.590529,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [587641185],
    evidence: 'OSM「信息科学与技术学院 #1」（#1/#2/#3 三栋，取 #1 作为学院代表点）',
  },
  {
    key: 'school-physical',
    label: '物质学院',
    lat: 31.179588,
    lng: 121.589103,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [508053663],
    evidence: 'OSM「物质科学与技术学院」（另有 #1–#8 多栋，取主楼）',
  },
  {
    key: 'school-life',
    label: '生命学院',
    lat: 31.181799,
    lng: 121.590176,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [587638224],
    evidence: 'OSM「生命科学与技术学院」',
  },
  {
    key: 'dorm-area',
    label: '宿舍区',
    lat: 31.179416,
    lng: 121.593619,
    confidence: 'high',
    evidenceKind: 'osm-derived',
    osmIds: [
      587641174, 587641175, 587641176, 587651637, 587651639, 587651642, 587651669, 587651676,
      587691938, 1480634994,
    ],
    evidence: 'OSM 学生公寓（building=dormitory）10 栋 + 博士公寓的几何中心；区域而非单栋',
  },
  {
    key: 'lakeside-lawn',
    label: '湖畔草坪',
    lat: 31.17685,
    lng: 121.5911,
    confidence: 'medium',
    evidenceKind: 'osm-derived',
    osmIds: [832289399, 832289412],
    evidence:
      'OSM 两个相邻无名水面（合计 7,632 m²）西侧的草地（landuse=grass, 12,440 m²）；「湖畔草坪」非 OSM 名称，按位置推测',
  },
  {
    key: 'cafe',
    label: '咖啡厅',
    lat: 31.180761,
    lng: 121.593163,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [5613200354],
    evidence: 'OSM node 5613200354「科大咖啡馆」（amenity=cafe）',
  },
  {
    key: 'campus-gate',
    label: '校门口',
    lat: 31.175952,
    lng: 121.590476,
    confidence: 'high',
    evidenceKind: 'osm-named',
    osmIds: [4571133482],
    evidence: 'OSM node 4571133482「正门」（barrier=gate），位于华夏中路一侧',
  },
  {
    key: 'zhangjiang-metro',
    label: '张江地铁站',
    lat: 31.181028,
    lng: 121.597539,
    confidence: 'low',
    evidenceKind: 'off-campus-inferred',
    osmIds: [659461032],
    evidence:
      'OSM「中科路站」（上海地铁 13 号线）是距校园最近的车站（约 0.9 km）。「张江地铁站」在占位白名单里语义模糊，也可能指张江高科站（2 号线，约 2.9 km 北）；此处为推测',
  },
];

/** 按 key 查地点（不存在返回 `undefined`） */
export function findCampusLocation(key: string): CampusLocation | undefined {
  return CAMPUS_MAP_LOCATIONS.find((location) => location.key === key);
}

/** 地点坐标 → WGS84 */
export function campusLocationPoint(location: CampusLocation): LatLng {
  return { lat: location.lat, lng: location.lng };
}

export const CAMPUS_LOCATION_CONFIDENCE_LABEL: Record<CampusLocationConfidence, string> = {
  high: '已确证',
  medium: '推断',
  low: '近似',
};

/** 各可信度的数量（页面上要显示，避免"看起来都很准"） */
export function campusLocationConfidenceCounts(): Record<CampusLocationConfidence, number> {
  const counts: Record<CampusLocationConfidence, number> = { high: 0, medium: 0, low: 0 };
  for (const location of CAMPUS_MAP_LOCATIONS) counts[location.confidence] += 1;
  return counts;
}
