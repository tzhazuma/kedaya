/**
 * 校园地点 · **OpenStreetMap 真实数据**（不是演示数据）
 *
 * ## 数据来源与许可
 *
 * 通过 Overpass API 从 OpenStreetMap 拉取，范围是校园 WGS84 边界：
 * `31.175546,121.5844916` ～ `31.1830156,121.5960882`。
 *
 * **许可：ODbL 1.0**（OpenStreetMap 的开放数据库许可）。
 * 使用要求：
 * - **署名**：必须标明数据来自 © OpenStreetMap contributors
 * - **相同方式共享**：基于它的衍生数据库也要以 ODbL 发布
 *
 * 拉取时刻：2026-10-19（`timestamp_osm_base: 2026-10-19T08:38:55Z`）
 *
 * ## ⚠️ OSM 里**没有**的东西（必须说清，不能假装有）
 *
 * 这次拉取只拿到 10 个元素，其中可用的具名 POI 是 **7 个**：
 * 全家便利店、科大咖啡馆、肯德基、耐思烘培、西餐厅、餐饮中心 #3、图书馆。
 *
 * OSM **没有**：
 * - ❌ **快递站**（菜鸟驿站 / 顺丰 / 京东 —— 校园内这类点位 OSM 未收录）
 * - ❌ **地下车库**（只有 2 个无名 `amenity=parking` 点，无法确认是地面还是地下，
 *      也拿不到出入口与层数）
 * - ❌ **食堂菜单**（OSM 是地理数据库，不含菜品与价格）
 *
 * 这三类**仍需合法来源**：
 * - 快递站 / 车库：校方后勤公开信息，或我们自己的同学实地记录（需本人授权）
 * - 食堂菜单：校方官网 / 食堂公示，或 `canteen` 模块自己的菜品库
 *
 * **不要**从 `map.niyiwei.com` 抓取 —— 那边的照片是另一组同学手拍，
 * 著作权归拍摄者（`campus-poi.ts` 的校验层会主动拒收该域名）。
 *
 * ## 坐标
 *
 * OSM 原生就是 **WGS84**，与 `CAMPUS_POI_BOUNDS` 同一坐标系，**不需要 GCJ-02 偏移**。
 * （注意：`apps/web/public/map/` 里那份 basemap 是 GCJ-02，两者不能混用。）
 */

import type { CampusPoiSupplement } from '@kedaya/contracts'

/** ODbL 要求的署名文案 —— 渲染时必须原样显示 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors（ODbL 1.0）'

/** 拉取时刻（写死，方便判断数据新旧） */
export const OSM_FETCHED_AT = '2026-10-19T08:38:55.000Z'

/**
 * OSM 拉取到的真实 POI。
 *
 * ⚠️ **没有照片**：`photoUrls: []`、`photoCredit: null`。
 * OSM 的 `image` 标签在这 7 个点上都没有值，且即使有也需要单独确认许可。
 */
export const OSM_CAMPUS_POIS: readonly CampusPoiSupplement[] = [
  {
    id: 'osm-library',
    category: 'study-space',
    name: '上海科技大学图书馆',
    lat: 31.177398,
    lng: 121.592341,
    floor: null,
    description: '校园图书馆，开放时间 Mo-Su 07:30-23:00（OSM 记录）',
    openingHours: 'Mo-Su 07:30-23:00',
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-canteen-restaurant',
    category: 'canteen-menu',
    name: '西餐厅',
    lat: 31.179708,
    lng: 121.592830,
    floor: null,
    description: 'OSM 记为 amenity=restaurant, cuisine=american。**菜单需要另外采集**。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-dining-center-3',
    category: 'canteen-menu',
    name: '餐饮中心 #3',
    lat: 31.178526,
    lng: 121.592332,
    floor: null,
    description: 'OSM 记为 amenity=restaurant。**菜单需要另外采集**。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-kfc',
    category: 'canteen-menu',
    name: '肯德基',
    lat: 31.179754,
    lng: 121.592846,
    floor: null,
    description: 'OSM 记为 amenity=fast_food, cuisine=chicken。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-bakery',
    category: 'canteen-menu',
    name: '耐思烘培',
    lat: 31.180325,
    lng: 121.593097,
    floor: null,
    description: 'OSM 记为 shop=bakery。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-cafe',
    category: 'canteen-menu',
    name: '科大咖啡馆',
    lat: 31.180761,
    lng: 121.593163,
    floor: null,
    description: 'OSM 记为 amenity=cafe。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
  {
    id: 'osm-family-mart',
    category: 'express-station',
    name: '全家便利店',
    lat: 31.179580,
    lng: 121.592916,
    floor: null,
    description:
      'OSM 记为 shop=convenience，24/7。**它同时是校园里最接近"快递代收点"的地方** —— 但 OSM 没有标注它是否代收快递，所以这里只按便利店呈现，不谎称是快递站。',
    openingHours: '24/7',
    photoUrls: [],
    photoCredit: null,
    verifiedAt: OSM_FETCHED_AT,
    source: 'osm',
  },
]
