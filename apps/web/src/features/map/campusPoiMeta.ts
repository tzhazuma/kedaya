/**
 * 校园地图 · 数据来源元信息（**页面展示用**）
 *
 * 这些数字必须与 `public/map/campus-poi.json` 一致 —— `campusAssets.test.ts`
 * 会读 JSON 逐项比对。**不要**在这里手写"大约 200 个 POI"这类无法核对的数字：
 * 页面上写的每个数都要能被文件验证。
 */

/** 数据来源与许可（页面「底图与数据来源」区块逐条渲染） */
export const CAMPUS_POI_META = {
  source: 'OpenStreetMap',
  sourceUrl: 'https://www.openstreetmap.org/relation/5390610',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL 1.0',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  licenseNotice:
    '底图与 POI 数据来自 OpenStreetMap，按 ODbL 1.0 提供：必须保留署名，衍生数据库同样按 ODbL 分发。',
  endpoint: 'https://overpass-api.de/api/interpreter',
  nominatimUrl:
    'https://nominatim.openstreetmap.org/search?q=%E4%B8%8A%E6%B5%B7%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6&format=jsonv2&limit=5&extratags=1',
  /** OSM 数据快照（UTC） */
  osmBaseTimestamp: '2026-10-17T11:19:01Z',
  /** 本次抓取时间（+08:00） */
  fetchedAt: '2026-10-17T19:07:00+08:00 — 2026-10-17T19:31:00+08:00',
  /** 实测/推算的校园范围（WGS84） */
  campusBounds: {
    minLat: 31.175546,
    maxLat: 31.1830156,
    minLng: 121.5844916,
    maxLng: 121.5960882,
  },
  campusCenter: { lat: 31.1794305, lng: 121.5902345 },
  campusAreaM2: 609167.4,
  /** POI 要素数（不含 25 个地点） */
  featureCount: 186,
  /** 分类计数（与 JSON `counts` 逐项比对） */
  featureCounts: {
    building: 86,
    water: 14,
    leisure: 8,
    landuse: 38,
    amenity: 20,
    gate: 15,
    transit: 5,
  },
  /** 数据文件（同源静态资源，可离线使用） */
  files: {
    poi: '/map/campus-poi.json',
    geojson: '/map/campus-basemap.geojson',
    svgLight: '/map/campus-basemap.svg',
    svgDark: '/map/campus-basemap-dark.svg',
    geometry: '/map/campus-basemap.geometry.json',
  },
} as const;

/** 精度声明（**必须与文档一致**，不允许只写"高精度"） */
export const CAMPUS_ACCURACY_NOTES: readonly string[] = [
  '校园边界来自 OSM relation 5390610（面积约 60.9 万 m²），未与校方红线核对。',
  '建筑/POI 坐标是 OSM 节点或 way 中心点，平面误差估计 3–15 m（依赖航拍描图与志愿编辑），本任务未实测。',
  '25 个地点中 10 个已确证、7 个推断、8 个近似；每个地点的依据写在 campus-poi.json 的 locations[].evidence。',
  'OSM 的人工湖没有名称，图上只写「人工湖」，不臆造正式湖名。',
];
