/**
 * wildlife · 种子数据（规格 §2.5 / §8.3 / U2）
 *
 * ## ⚠️ 诚实标注（最重要的一段）
 *
 * 下面的物种清单是**基于"上科大校园有猫、鸟、黑天鹅"这一前提的合理推测**，
 * **未做实地物种调查**。真实物种清单必须由**校园动物社团/生物教师**确认后录入。
 *
 * 因此每条记录都带 `needsFieldVerification: true` 与 `verificationNote`，
 * 把这个未知项变成**机器可见**的标记（与 `CampusBasemap.license` 的 CI 校验同一思路）——
 * 而不是写在文档里靠人记住。
 *
 * **"黑天鹅是上科大校园真实存在的动物"是用户明确告知的事实，但具体数量、
 * 活动水域、是否有官方管理方，仍然未知（U2）。**
 *
 * 本文件**零 import**：它同时被 `prisma/seed.mjs`（运行时动态 import）与
 * 单元测试（静态 import）消费，保持纯净最省事。
 */

/** 待实地核实的统一标注文案 */
export const FIELD_VERIFICATION_NOTE = '待实地核实（规格 U2：未做实地物种调查，需社团/生物教师确认）';

export interface SpeciesSeed {
  id: string;
  scientificName: string;
  commonNameZh: string;
  commonNameEn: string | null;
  taxonRank: 'species' | 'genus' | 'family' | 'order';
  parentId: string | null;
  isProtected: boolean;
  isNestingSensitive: boolean;
  nestingMonths: number[];
  defaultFeedingPolicy: 'allowed' | 'discouraged' | 'forbidden';
  externalIds: Record<string, unknown>;
  needsFieldVerification: boolean;
  verificationNote: string;
}

/**
 * 物种分类树（规格 §2.5 的 7 个物种 + 3 个分类层级节点）。
 *
 * 加分类层级节点是为了让 `parentId` 自引用结构**真的被用起来**：
 * 客户端要按"鸭科/鹭科"折叠展示，而不是平铺 7 个物种。
 */
export const SPECIES_SEED: SpeciesSeed[] = [
  // —— 分类层级（推测的科名，同样待核实） ——
  {
    id: 'tax-anatidae',
    scientificName: 'Anatidae',
    commonNameZh: '鸭科',
    commonNameEn: 'Ducks, geese and swans',
    taxonRank: 'family',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
    externalIds: {},
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'tax-ardeidae',
    scientificName: 'Ardeidae',
    commonNameZh: '鹭科',
    commonNameEn: 'Herons and bitterns',
    taxonRank: 'family',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
    externalIds: {},
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'tax-felidae',
    scientificName: 'Felidae',
    commonNameZh: '猫科',
    commonNameEn: 'Cats',
    taxonRank: 'family',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
    externalIds: {},
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },

  // —— 物种（规格 §2.5 表格逐行落地） ——
  {
    id: 'sp-felis-catus',
    scientificName: 'Felis catus',
    commonNameZh: '猫（家猫/流浪猫）',
    commonNameEn: 'Domestic cat',
    taxonRank: 'species',
    parentId: 'tax-felidae',
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
    externalIds: { inaturalist: 118552 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'sp-cygnus-atratus',
    scientificName: 'Cygnus atratus',
    commonNameZh: '黑天鹅',
    commonNameEn: 'Black swan',
    taxonRank: 'species',
    parentId: 'tax-anatidae',
    // 外来引进，校方管理资产（规格 §2.5）
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: [3, 4, 5, 6],
    defaultFeedingPolicy: 'forbidden',
    externalIds: { inaturalist: 6907 },
    needsFieldVerification: true,
    verificationNote: `${FIELD_VERIFICATION_NOTE}；黑天鹅为校方管理动物，数量与活动水域未知`,
  },
  {
    id: 'sp-anas-platyrhynchos',
    scientificName: 'Anas platyrhynchos',
    commonNameZh: '绿头鸭',
    commonNameEn: 'Mallard',
    taxonRank: 'species',
    parentId: 'tax-anatidae',
    isProtected: false,
    isNestingSensitive: true,
    nestingMonths: [3, 4, 5, 6],
    defaultFeedingPolicy: 'discouraged',
    externalIds: { inaturalist: 6930 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'sp-egretta-garzetta',
    scientificName: 'Egretta garzetta',
    commonNameZh: '白鹭',
    commonNameEn: 'Little egret',
    taxonRank: 'species',
    parentId: 'tax-ardeidae',
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: [4, 5, 6, 7],
    defaultFeedingPolicy: 'forbidden',
    externalIds: { inaturalist: 4940 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'sp-passer-montanus',
    scientificName: 'Passer montanus',
    commonNameZh: '麻雀',
    commonNameEn: 'Eurasian tree sparrow',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
    externalIds: { inaturalist: 13859 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'sp-spilopelia-chinensis',
    scientificName: 'Spilopelia chinensis',
    commonNameZh: '珠颈斑鸠',
    commonNameEn: 'Spotted dove',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
    externalIds: { inaturalist: 204524 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
  {
    id: 'sp-pica-serica',
    scientificName: 'Pica serica',
    commonNameZh: '喜鹊',
    commonNameEn: 'Oriental magpie',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'forbidden',
    externalIds: { inaturalist: 979325 },
    needsFieldVerification: true,
    verificationNote: FIELD_VERIFICATION_NOTE,
  },
];

export interface ZoneSeed {
  id: string;
  name: string;
  speciesIds: string[];
  centerLat: number;
  centerLng: number;
  radiusM: number;
  feedingPolicy: 'allowed' | 'discouraged' | 'forbidden';
  note: string | null;
  fuzzRadiusM: number;
  isSensitive: boolean;
  sensitiveRing: Array<{ lat: number; lng: number }> | null;
  noticeText: string | null;
  sortOrder: number;
}

/**
 * 区域种子（人工定义的管理区域）。
 *
 * ⚠️ 坐标是**占位值**（校园平面图尚未实测，规格 U3），
 * 但都落在 `CAMPUS_BBOX` 内 —— 由 `seed-data.spec.ts` 断言。
 *
 * `noticeText` 是**草案**，未经校方或动物社团审核（规格 §8.3 / U7）。
 * 上线前必须确认，否则我们可能在替学校表态。
 */
export const ZONES_SEED: ZoneSeed[] = [
  {
    id: 'zone-lib-lawn',
    name: '图书馆后草坪',
    speciesIds: ['sp-felis-catus', 'sp-passer-montanus'],
    centerLat: 31.178,
    centerLng: 121.59,
    radiusM: 180,
    feedingPolicy: 'discouraged',
    note: '流浪猫常驻区域，已有同学自发照护',
    fuzzRadiusM: 50,
    isSensitive: false,
    sensitiveRing: null,
    noticeText: '请勿投喂人类食物（面包、零食含盐含糖，会损害动物健康）。',
    sortOrder: 1,
  },
  {
    id: 'zone-artificial-lake',
    name: '人工湖水域',
    speciesIds: ['sp-cygnus-atratus', 'sp-anas-platyrhynchos', 'sp-egretta-garzetta'],
    centerLat: 31.1768,
    centerLng: 121.5949,
    radiusM: 220,
    feedingPolicy: 'forbidden',
    note: '黑天鹅主要活动水域',
    // 黑天鹅是保护物种 + 繁殖期敏感：区域基准半径取大一些（§9.4 还会再放大）
    fuzzRadiusM: 80,
    isSensitive: false,
    sensitiveRing: null,
    noticeText:
      '🦢 黑天鹅是校园的重要成员，也是校方管理的动物。请勿投喂（面包、零食等人类食物会损害它们的健康）。请勿追撵、捕捉或近距离惊扰。繁殖期请勿靠近巢区，也请勿在平台上公开巢穴位置。发现受伤或异常，请标记"疑似受伤"。',
    sortOrder: 2,
  },
  {
    id: 'zone-dorm-area',
    name: '宿舍区（保育敏感区）',
    speciesIds: ['sp-felis-catus'],
    centerLat: 31.1836,
    centerLng: 121.5852,
    radiusM: 160,
    feedingPolicy: 'forbidden',
    note: '宿舍楼周边：涉及同学作息隐私，且校方禁止投喂',
    fuzzRadiusM: 50,
    // ⚠️ 敏感区：命中的观测**只给 zoneId，不给任何坐标**（规格 §9.3 ①）
    isSensitive: true,
    sensitiveRing: [
      { lat: 31.1822, lng: 121.5836 },
      { lat: 31.1822, lng: 121.5868 },
      { lat: 31.185, lng: 121.5868 },
      { lat: 31.185, lng: 121.5836 },
    ],
    noticeText: '该区域禁止投喂，请勿在宿舍区聚集围观动物。',
    sortOrder: 3,
  },
  {
    id: 'zone-canteen-back',
    name: '一食堂后门',
    speciesIds: ['sp-felis-catus'],
    centerLat: 31.1802,
    centerLng: 121.5864,
    radiusM: 90,
    feedingPolicy: 'discouraged',
    note: '猫常在饭点出现',
    fuzzRadiusM: 50,
    isSensitive: false,
    sensitiveRing: null,
    noticeText: '请勿用食物引诱以获取照片。',
    sortOrder: 4,
  },
];

export interface SightingSeed {
  id: string;
  species: string;
  zoneId: string | null;
  status: 'PENDING' | 'PUBLISHED';
  /** 精确坐标（只写受限表；公开行写模糊后的值，由 seed 脚本计算） */
  exactLat: number;
  exactLng: number;
  observedAt: string;
  reporterId: string;
  note: string | null;
  healthConcern: boolean;
  isAnonymous: boolean;
}

/**
 * 观测种子。
 *
 * ⚠️ `reporterId` 是**假 id**（`seed-user-*`）—— 种子数据不能依赖真实用户表，
 * 否则在没有账号的库里跑不起来。真实部署应先建用户，或把这些行的 `reporterId`
 * 指向实际账号。
 *
 * 公开坐标**不在这里**：seed 脚本会跑一遍 §9 的四层流水线，
 * 保证"种子数据的公开坐标也是模糊后的"，不会出现"种子数据泄漏精确坐标"这种事。
 */
export const SIGHTINGS_SEED: SightingSeed[] = [
  {
    id: 'seed-sighting-0001',
    species: 'sp-cygnus-atratus',
    zoneId: 'zone-artificial-lake',
    status: 'PUBLISHED',
    exactLat: 31.1768,
    exactLng: 121.5949,
    observedAt: '2026-10-10T08:30:00.000Z',
    reporterId: 'seed-user-1',
    note: '两只黑天鹅在湖东岸',
    healthConcern: false,
    isAnonymous: false,
  },
  {
    id: 'seed-sighting-0002',
    species: 'sp-felis-catus',
    zoneId: 'zone-lib-lawn',
    status: 'PUBLISHED',
    exactLat: 31.1781,
    exactLng: 121.5902,
    observedAt: '2026-10-11T12:10:00.000Z',
    reporterId: 'seed-user-2',
    note: '大橘在草坪晒太阳',
    healthConcern: false,
    isAnonymous: true,
  },
  {
    id: 'seed-sighting-0003',
    species: 'sp-felis-catus',
    zoneId: 'zone-dorm-area',
    status: 'PUBLISHED',
    exactLat: 31.1838,
    exactLng: 121.5854,
    observedAt: '2026-10-12T22:40:00.000Z',
    reporterId: 'seed-user-3',
    note: '宿舍楼下有一只小猫',
    healthConcern: false,
    isAnonymous: true,
  },
  {
    id: 'seed-sighting-0004',
    species: 'sp-passer-montanus',
    zoneId: 'zone-lib-lawn',
    status: 'PUBLISHED',
    exactLat: 31.1779,
    exactLng: 121.5898,
    observedAt: '2026-10-13T07:20:00.000Z',
    reporterId: 'seed-user-4',
    note: null,
    healthConcern: false,
    isAnonymous: false,
  },
  {
    id: 'seed-sighting-0005',
    species: 'sp-cygnus-atratus',
    zoneId: 'zone-artificial-lake',
    status: 'PUBLISHED',
    exactLat: 31.1769,
    exactLng: 121.5951,
    observedAt: '2026-10-14T16:05:00.000Z',
    reporterId: 'seed-user-1',
    note: '疑似翅膀有伤，已标记疑似受伤',
    healthConcern: true,
    isAnonymous: false,
  },
  {
    id: 'seed-sighting-0006',
    species: 'sp-egretta-garzetta',
    zoneId: 'zone-artificial-lake',
    status: 'PENDING',
    exactLat: 31.1766,
    exactLng: 121.5945,
    observedAt: '2026-10-15T09:00:00.000Z',
    reporterId: 'seed-user-5',
    note: '湖边有一只白鹭（待审核）',
    healthConcern: false,
    isAnonymous: true,
  },
];

/** 命名个体种子（"手动给个名字"，规格 §2.8） */
export interface IndividualSeed {
  id: string;
  name: string;
  speciesId: string;
  description: string;
  status: 'PENDING' | 'PUBLISHED';
  createdBy: string;
}

export const INDIVIDUALS_SEED: IndividualSeed[] = [
  {
    id: 'ind-daju',
    name: '大橘',
    speciesId: 'sp-felis-catus',
    description: '橘色长毛，右耳有缺口，常在图书馆后草坪',
    status: 'PUBLISHED',
    createdBy: 'seed-user-2',
  },
  {
    id: 'ind-e-e',
    name: '鹅鹅',
    speciesId: 'sp-cygnus-atratus',
    description: '人工湖东岸，颈环编号待核实',
    status: 'PENDING',
    createdBy: 'seed-user-1',
  },
];

/** 种子数据的整体统计（seed 脚本与测试共用） */
export function seedSummary(): Record<string, number> {
  return {
    species: SPECIES_SEED.length,
    speciesPendingVerification: SPECIES_SEED.filter((s) => s.needsFieldVerification).length,
    zones: ZONES_SEED.length,
    sensitiveZones: ZONES_SEED.filter((z) => z.isSensitive).length,
    sightings: SIGHTINGS_SEED.length,
    individuals: INDIVIDUALS_SEED.length,
  };
}
