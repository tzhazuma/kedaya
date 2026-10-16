/**
 * wildlife mock 数据集 —— 保证**无后端也能跑通**（契约 §7 硬规则 4）。
 *
 * ⚠️ 数据是**演示数据**，其中：
 * - 物种清单是**推测**（规格 §2.5 / 未决问题 U2，未做实地调查）；
 * - 控制点 WGS84 是**占位值**（未决问题 U3，未实测）；
 * - 坐标已经"模糊化"过（mock 用 `snapToGrid` 演示服务端的模糊化链路）。
 *
 * 时间基于传入的 `now` 相对生成，所以演示永远有"最近的上报"，
 * 而测试可以传固定 `now` 获得确定性。
 */
import { coarseTime, snapToGrid } from '@kedaya/shared';

import type { SpeciesTaxonomy, WildlifeZone } from '@/domain/models/wildlife/species';
import type { WildlifeSighting } from '@/domain/models/wildlife/sightings';
import type { WildlifeIndividual, WildlifeSpot, WildlifeTrack } from '@/domain/models/wildlife/tracks';

function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ *
 * 物种（规格 §2.5 —— **推测清单，待社团确认**）
 * ------------------------------------------------------------------ */

export function createSpeciesSeed(): SpeciesTaxonomy[] {
  return [
    {
      id: 'sp-cat',
      scientificName: 'Felis catus',
      commonNameZh: '猫（家猫/流浪猫）',
      commonNameEn: 'Cat',
      taxonRank: 'species',
      parentId: null,
      isProtected: false,
      isNestingSensitive: false,
      nestingMonths: [],
      defaultFeedingPolicy: 'discouraged',
      externalIds: { inaturalist: 118552 },
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-swan',
      scientificName: 'Cygnus atratus',
      commonNameZh: '黑天鹅',
      commonNameEn: 'Black Swan',
      taxonRank: 'species',
      parentId: null,
      isProtected: true,
      isNestingSensitive: true,
      nestingMonths: [3, 4, 5, 6],
      defaultFeedingPolicy: 'forbidden',
      externalIds: { inaturalist: 6901, baiduLabel: '黑天鹅' },
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-duck',
      scientificName: 'Anas platyrhynchos',
      commonNameZh: '绿头鸭',
      commonNameEn: 'Mallard',
      taxonRank: 'species',
      parentId: null,
      isProtected: false,
      isNestingSensitive: true,
      nestingMonths: [3, 4, 5, 6],
      defaultFeedingPolicy: 'discouraged',
      externalIds: { inaturalist: 6930 },
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-sparrow',
      scientificName: 'Passer montanus',
      commonNameZh: '麻雀',
      commonNameEn: 'Eurasian Tree Sparrow',
      taxonRank: 'species',
      parentId: null,
      isProtected: false,
      isNestingSensitive: false,
      nestingMonths: [],
      defaultFeedingPolicy: 'forbidden',
      externalIds: {},
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-dove',
      scientificName: 'Spilopelia chinensis',
      commonNameZh: '珠颈斑鸠',
      commonNameEn: 'Spotted Dove',
      taxonRank: 'species',
      parentId: null,
      isProtected: false,
      isNestingSensitive: false,
      nestingMonths: [],
      defaultFeedingPolicy: 'forbidden',
      externalIds: {},
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-egret',
      scientificName: 'Egretta garzetta',
      commonNameZh: '白鹭',
      commonNameEn: 'Little Egret',
      taxonRank: 'species',
      parentId: null,
      isProtected: true,
      isNestingSensitive: true,
      nestingMonths: [4, 5, 6, 7],
      defaultFeedingPolicy: 'forbidden',
      externalIds: { inaturalist: 4940 },
      iconUrl: null,
      isActive: true,
    },
    {
      id: 'sp-magpie',
      scientificName: 'Pica serica',
      commonNameZh: '喜鹊',
      commonNameEn: 'Oriental Magpie',
      taxonRank: 'species',
      parentId: null,
      isProtected: false,
      isNestingSensitive: false,
      nestingMonths: [],
      defaultFeedingPolicy: 'forbidden',
      externalIds: {},
      iconUrl: null,
      isActive: true,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 区域（人工定义，规格 §2.2）
 * ------------------------------------------------------------------ */

export function createZoneSeed(): WildlifeZone[] {
  return [
    {
      id: 'wz-lib-lawn',
      name: '图书馆后草坪',
      speciesIds: ['sp-cat', 'sp-sparrow', 'sp-magpie'],
      geo: { lat: 31.180398, lng: 121.589635, radiusM: 60 },
      feedingPolicy: 'discouraged',
      note: '猫在此区域活动较多，请不要集中投喂。',
      fuzzRadiusM: 50,
      isSensitive: false,
      noticeText:
        '图书馆后草坪是流浪猫的主要活动区。请勿投喂人类食物；不要追撵、捕捉或抱起它们。',
      sortOrder: 10,
    },
    {
      id: 'wz-lake',
      name: '人工湖（黑天鹅水域）',
      speciesIds: ['sp-swan', 'sp-duck', 'sp-egret'],
      geo: { lat: 31.177703, lng: 121.59205, radiusM: 120 },
      feedingPolicy: 'forbidden',
      note: '校方管理的黑天鹅栖息水域。',
      fuzzRadiusM: 50,
      isSensitive: false,
      noticeText:
        '黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂（面包、零食等人类食物会损害它们的健康）；请勿追撵、捕捉或近距离惊扰；繁殖期请勿靠近巢区，也请勿在平台上公开巢穴位置。',
      sortOrder: 20,
    },
    {
      id: 'wz-dorm-west',
      name: '宿舍区西侧（敏感区）',
      speciesIds: ['sp-cat'],
      geo: { lat: 31.176805, lng: 121.58701, radiusM: 90 },
      feedingPolicy: 'discouraged',
      note: '宿舍区内的猫活动点，属于位置敏感区。',
      fuzzRadiusM: 200,
      isSensitive: true,
      noticeText:
        '该区域位于宿舍区：公开展示只给出区域，不给任何坐标。请勿在此聚集围观，也不要投喂。',
      sortOrder: 30,
    },
    {
      id: 'wz-canteen',
      name: '一食堂周边',
      speciesIds: ['sp-cat', 'sp-sparrow'],
      geo: { lat: 31.178422, lng: 121.588165, radiusM: 70 },
      feedingPolicy: 'discouraged',
      note: '食堂门口常有猫等剩饭，请不要主动投喂。',
      fuzzRadiusM: 50,
      isSensitive: false,
      noticeText: '食堂周边食物残渣多，请不要主动投喂，也不要让动物进入食堂。',
      sortOrder: 40,
    },
    {
      id: 'wz-east-gate',
      name: '东门水边绿地',
      speciesIds: ['sp-egret', 'sp-magpie', 'sp-dove'],
      geo: { lat: 31.17932, lng: 121.595725, radiusM: 80 },
      feedingPolicy: 'forbidden',
      note: '水鸟停歇点。',
      fuzzRadiusM: 50,
      isSensitive: false,
      noticeText: '水鸟停歇点：请保持距离观察，禁止投喂与惊扰，夜间拍摄请勿使用闪光灯。',
      sortOrder: 50,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 观测（规格 §2.6）
 * ------------------------------------------------------------------ */

interface SightingSeedInput {
  id: string;
  species: string;
  zoneId: string | null;
  lat: number | null;
  lng: number | null;
  geoWithheld?: 'sensitive-zone' | 'k-anonymity' | null;
  hoursAgo: number;
  status: WildlifeSighting['status'];
  note?: string;
  healthConcern?: boolean;
  isAnonymous?: boolean;
  photos?: number;
  individualId?: string | null;
  autoSpeciesId?: string | null;
  autoConfidence?: number | null;
  classifiedBy?: WildlifeSighting['classifiedBy'];
  rejectReason?: string | null;
  moderatedBy?: string | null;
  /** 坐标是否已模糊化（默认 true，模拟服务端已处理） */
  fuzzed?: boolean;
}

function buildSighting(
  input: SightingSeedInput,
  species: readonly SpeciesTaxonomy[],
  now: Date,
): WildlifeSighting {
  const observedAt = new Date(now.getTime() - input.hoursAgo * HOUR);
  const speciesNameZh = species.find((s) => s.id === input.species)?.commonNameZh ?? '未知物种';
  const geo =
    input.lat === null || input.lng === null
      ? null
      : input.fuzzed === false
        ? { lat: input.lat, lng: input.lng }
        : snapToGrid({ lat: input.lat, lng: input.lng }, 50);

  return {
    id: input.id,
    zoneId: input.zoneId,
    species: input.species,
    speciesNameZh,
    status: input.status,
    geo,
    geoWithheld: geo === null ? (input.geoWithheld ?? 'sensitive-zone') : null,
    observedAt: observedAt.toISOString(),
    observedAtFuzzed: coarseTime(observedAt.toISOString(), input.geoWithheld ? 'day' : 'hour'),
    individualId: input.individualId ?? null,
    autoSpeciesId: input.autoSpeciesId ?? null,
    autoConfidence: input.autoConfidence ?? null,
    classifiedBy: input.classifiedBy ?? 'manual',
    correctedFromSpeciesId: null,
    note: input.note ?? null,
    isAnonymous: input.isAnonymous ?? false,
    reporterLabel: input.isAnonymous ? '匿名同学' : '鸭鸭先冲',
    photoUrls:
      input.photos && input.photos > 0
        ? Array.from({ length: input.photos }, (_, i) => `/wildlife/photos/${input.id}-${i + 1}.webp`)
        : [],
    healthConcern: input.healthConcern ?? false,
    createdAt: iso(now, -input.hoursAgo * HOUR + 5 * 60 * 1000),
    moderatedBy: input.moderatedBy ?? null,
    moderatedAt: input.status === 'PENDING' ? null : iso(now, -input.hoursAgo * HOUR + HOUR),
    rejectReason: input.rejectReason ?? null,
  };
}

export function createSightingSeed(now: Date): WildlifeSighting[] {
  const species = createSpeciesSeed();
  const seeds: SightingSeedInput[] = [
    { id: 'ws-1001', species: 'sp-cat', zoneId: 'wz-lib-lawn', lat: 31.180533, lng: 121.589478, hoursAgo: 6, status: 'PUBLISHED', photos: 1, note: '在草坪边上晒太阳，两只。' },
    { id: 'ws-1002', species: 'sp-cat', zoneId: 'wz-lib-lawn', lat: 31.180237, lng: 121.589866, hoursAgo: 30, status: 'PUBLISHED', photos: 1 },
    { id: 'ws-1003', species: 'sp-cat', zoneId: 'wz-canteen', lat: 31.178512, lng: 121.588081, hoursAgo: 52, status: 'PUBLISHED', photos: 2, note: '食堂门口蹲着等剩饭。' },
    { id: 'ws-1004', species: 'sp-swan', zoneId: 'wz-lake', lat: 31.177838, lng: 121.591945, hoursAgo: 8, status: 'PUBLISHED', photos: 2, note: '湖面北侧，两只成年个体。' },
    { id: 'ws-1005', species: 'sp-swan', zoneId: 'wz-lake', lat: 31.177596, lng: 121.592207, hoursAgo: 34, status: 'PUBLISHED', photos: 1, individualId: 'wi-swan-1' },
    { id: 'ws-1006', species: 'sp-swan', zoneId: 'wz-lake', lat: 31.177524, lng: 121.591714, hoursAgo: 80, status: 'PUBLISHED', photos: 1, autoSpeciesId: 'sp-swan', autoConfidence: 0.78, classifiedBy: 'vision_api' },
    { id: 'ws-1007', species: 'sp-duck', zoneId: 'wz-lake', lat: 31.177928, lng: 121.592417, hoursAgo: 12, status: 'PUBLISHED', photos: 1 },
    { id: 'ws-1008', species: 'sp-duck', zoneId: 'wz-lake', lat: 31.177928, lng: 121.592417, hoursAgo: 100, status: 'PUBLISHED' },
    { id: 'ws-1009', species: 'sp-cat', zoneId: 'wz-dorm-west', lat: null, lng: null, geoWithheld: 'sensitive-zone', hoursAgo: 4, status: 'PUBLISHED', photos: 1, isAnonymous: true, note: '宿舍楼下，不便公开具体位置。' },
    { id: 'ws-1010', species: 'sp-cat', zoneId: 'wz-dorm-west', lat: null, lng: null, geoWithheld: 'sensitive-zone', hoursAgo: 26, status: 'PUBLISHED', isAnonymous: true },
    { id: 'ws-1011', species: 'sp-egret', zoneId: 'wz-east-gate', lat: 31.179374, lng: 121.595641, hoursAgo: 2, status: 'PENDING', photos: 2, healthConcern: true, note: '左翅似乎有伤，走路不太稳。' },
    { id: 'ws-1012', species: 'sp-magpie', zoneId: 'wz-east-gate', lat: 31.179213, lng: 121.59583, hoursAgo: 5, status: 'PENDING', photos: 1 },
    { id: 'ws-1013', species: 'sp-sparrow', zoneId: null, lat: null, lng: null, geoWithheld: 'k-anonymity', hoursAgo: 1, status: 'PENDING', isAnonymous: true },
    { id: 'ws-1014', species: 'sp-cat', zoneId: 'wz-canteen', lat: 31.178305, lng: 121.588323, hoursAgo: 200, status: 'REJECTED', rejectReason: '照片里没有拍到动物，无法确认物种。', moderatedBy: 'u_admin_01' },
    { id: 'ws-1015', species: 'sp-cat', zoneId: 'wz-lib-lawn', lat: 31.180129, lng: 121.589215, hoursAgo: 300, status: 'PUBLISHED', individualId: 'wi-cat-1', photos: 1, note: '大橘又回来了。' },
    { id: 'ws-1016', species: 'sp-swan', zoneId: 'wz-lake', lat: 31.177838, lng: 121.591945, hoursAgo: 150, status: 'PUBLISHED', photos: 1, individualId: 'wi-swan-1' },
  ];
  return seeds.map((seed) => buildSighting(seed, species, now));
}

/* ------------------------------------------------------------------ *
 * 命名个体（规格 §2.8 / §5.6(b)）
 * ------------------------------------------------------------------ */

export function createIndividualSeed(): WildlifeIndividual[] {
  return [
    {
      id: 'wi-cat-1',
      name: '大橘',
      speciesId: 'sp-cat',
      speciesNameZh: '猫（家猫/流浪猫）',
      description: '橘色公猫，尾巴尖有一撮白毛，常出没于图书馆后草坪。',
      coverPhotoUrl: null,
      status: 'PUBLISHED',
      isActive: true,
    },
    {
      id: 'wi-cat-2',
      name: '小奶牛',
      speciesId: 'sp-cat',
      speciesNameZh: '猫（家猫/流浪猫）',
      description: '黑白花色，胆子小，多在食堂后门。',
      coverPhotoUrl: null,
      status: 'PUBLISHED',
      isActive: true,
    },
    {
      id: 'wi-swan-1',
      name: '鹅鹅',
      speciesId: 'sp-swan',
      speciesNameZh: '黑天鹅',
      description: '体型较大的一只，常在人工湖北岸活动。名字待校方/社团确认。',
      coverPhotoUrl: null,
      status: 'PENDING',
      isActive: true,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 热点（算法聚类产出，**只读**）
 * ------------------------------------------------------------------ */

function histogram(entries: Array<[number, number]>): number[] {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const [hour, count] of entries) buckets[hour] = count;
  return buckets;
}

export function createSpotSeed(now: Date): WildlifeSpot[] {
  // 规格 §8.1 E10 / 验收 T24：computedAt 与当前时间**至少相差 24 小时**
  const computedAt = iso(now, -26 * HOUR);
  const species = createSpeciesSeed();
  const nameOf = (id: string): string => species.find((s) => s.id === id)?.commonNameZh ?? '未知物种';

  return [
    {
      id: 'wsp-01',
      speciesId: 'sp-cat',
      speciesNameZh: nameOf('sp-cat'),
      zoneId: 'wz-lib-lawn',
      centroid: snapToGrid({ lat: 31.18038, lng: 121.589656 }, 50),
      radiusM: 62,
      sightingCount: 24,
      distinctReporters: 9,
      firstSeenAt: iso(now, -40 * DAY),
      lastSeenAt: iso(now, -2 * DAY),
      hourHistogram: histogram([[7, 2], [8, 5], [9, 8], [10, 4], [17, 3], [18, 2]]),
      confidence: 0.72,
      computedAt,
      isAggregated: true,
      aggregationDelayHours: 24,
    },
    {
      id: 'wsp-02',
      speciesId: 'sp-swan',
      speciesNameZh: nameOf('sp-swan'),
      zoneId: 'wz-lake',
      centroid: snapToGrid({ lat: 31.177703, lng: 121.59205 }, 50),
      radiusM: 48,
      sightingCount: 31,
      distinctReporters: 12,
      firstSeenAt: iso(now, -60 * DAY),
      lastSeenAt: iso(now, -1 * DAY),
      hourHistogram: histogram([[8, 3], [9, 6], [10, 7], [15, 4], [16, 5], [17, 3]]),
      confidence: 0.81,
      computedAt,
      isAggregated: true,
      aggregationDelayHours: 24,
    },
    {
      id: 'wsp-03',
      speciesId: 'sp-cat',
      speciesNameZh: nameOf('sp-cat'),
      zoneId: 'wz-dorm-west',
      centroid: snapToGrid({ lat: 31.176787, lng: 121.587136 }, 200),
      radiusM: 40,
      sightingCount: 9,
      distinctReporters: 4,
      firstSeenAt: iso(now, -20 * DAY),
      lastSeenAt: iso(now, -3 * DAY),
      hourHistogram: histogram([[21, 3], [22, 4], [23, 2]]),
      confidence: 0.42,
      computedAt,
      isAggregated: true,
      aggregationDelayHours: 24,
    },
    {
      id: 'wsp-04',
      speciesId: 'sp-egret',
      speciesNameZh: nameOf('sp-egret'),
      zoneId: 'wz-east-gate',
      centroid: snapToGrid({ lat: 31.17932, lng: 121.595725 }, 50),
      radiusM: 55,
      sightingCount: 6,
      // ⚠️ 只有 2 位上报人 → **不满足 k-匿名**（规格 §9.3 ④），地图上不应作为公开热点
      distinctReporters: 2,
      firstSeenAt: iso(now, -12 * DAY),
      lastSeenAt: iso(now, -2 * DAY),
      hourHistogram: histogram([[6, 2], [7, 4]]),
      confidence: 0.28,
      computedAt,
      isAggregated: true,
      aggregationDelayHours: 24,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 推断轨迹（规格 §2.4 / §6 —— **非实测路径**）
 * ------------------------------------------------------------------ */

export function createTrackSeed(now: Date): WildlifeTrack[] {
  const computedAt = iso(now, -26 * HOUR);
  const species = createSpeciesSeed();
  const nameOf = (id: string): string => species.find((s) => s.id === id)?.commonNameZh ?? '未知物种';

  const swanPath: Array<[number, number]> = [
    [121.591945, 31.177838],
    [121.592207, 31.177596],
    [121.591714, 31.177524],
    [121.592417, 31.177928],
  ];
  const catPath: Array<[number, number]> = [
    [121.589478, 31.180533],
    [121.589866, 31.180237],
    [121.589215, 31.180129],
    [121.588081, 31.178512],
  ];
  const orangeCatPath: Array<[number, number]> = [
    [121.589215, 31.180129],
    [121.589478, 31.180533],
    [121.589656, 31.18038],
  ];

  return [
    {
      id: 'wt-01',
      speciesId: 'sp-swan',
      speciesNameZh: nameOf('sp-swan'),
      individualId: null,
      spotIds: ['wsp-02'],
      path: { type: 'LineString', coordinates: swanPath },
      totalDistanceM: 180,
      spanStartAt: iso(now, -9 * DAY),
      spanEndAt: iso(now, -1 * DAY),
      sightingCount: 31,
      method: 'dbscan-chain',
      confidence: 0.58,
      isInferred: true,
      disclaimer: '本轨迹由 31 次同学上报推断得出，并非实测运动路径。',
      computedAt,
    },
    {
      id: 'wt-02',
      speciesId: 'sp-cat',
      speciesNameZh: nameOf('sp-cat'),
      individualId: null,
      spotIds: ['wsp-01'],
      path: { type: 'LineString', coordinates: catPath },
      totalDistanceM: 420,
      spanStartAt: iso(now, -14 * DAY),
      spanEndAt: iso(now, -1 * DAY),
      sightingCount: 24,
      method: 'dbscan-chain',
      confidence: 0.44,
      isInferred: true,
      disclaimer: '本轨迹由 24 次同学上报推断得出，并非实测运动路径。',
      computedAt,
    },
    {
      id: 'wt-03',
      speciesId: 'sp-cat',
      speciesNameZh: nameOf('sp-cat'),
      individualId: 'wi-cat-1',
      spotIds: ['wsp-01'],
      path: { type: 'LineString', coordinates: orangeCatPath },
      totalDistanceM: 150,
      spanStartAt: iso(now, -12 * DAY),
      spanEndAt: iso(now, -1 * DAY),
      sightingCount: 7,
      method: 'dbscan-chain',
      confidence: 0.36,
      isInferred: true,
      disclaimer: '本轨迹由 7 次同学上报推断得出，并非实测运动路径。',
      computedAt,
    },
  ];
}
