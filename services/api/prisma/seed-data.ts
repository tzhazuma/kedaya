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

/* ------------------------------------------------------------------ *
 * 营养管家（`canteen`）· 菜品库种子（ADR 0006 C2）
 * ------------------------------------------------------------------ */

/**
 * 口径（ADR 0006 D5）：营养值一律**每份**（= `servingG` 克），不是每 100 g。
 *
 * 数值参考《中国食物成分表》常见档口的量级，属于**演示量级**的合理估算，
 * **不是**食堂公示数据；真实上线应换成食堂公示值（页面会展示 `source`）。
 *
 * 为什么必须种菜品：空菜品库 → 搜索空、推荐空、拍照候选全是 `dish: null`，
 * 于是「真后端」从来没有被证明能用。72 道菜覆盖四个食堂与八种品类，
 * 推荐才做得成「品类均衡」。
 */
export interface DishSeed {
  canteen: string;
  name: string;
  category: string;
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  priceFen: number;
}

export const DISHES_SEED: DishSeed[] = [
  // ---------------- 一食堂 · 本帮家常 ----------------
  { canteen: '一食堂', name: '米饭', category: 'staple', servingG: 150, caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5, priceFen: 200 },
  { canteen: '一食堂', name: '二两馒头', category: 'staple', servingG: 100, caloriesKcal: 230, proteinG: 7, fatG: 1, carbG: 48, fiberG: 2, sodiumMg: 150, priceFen: 100 },
  { canteen: '一食堂', name: '红烧排骨', category: 'meat', servingG: 200, caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900, priceFen: 1400 },
  { canteen: '一食堂', name: '红烧肉', category: 'meat', servingG: 150, caloriesKcal: 480, proteinG: 20, fatG: 40, carbG: 8, fiberG: 0, sodiumMg: 850, priceFen: 1300 },
  { canteen: '一食堂', name: '番茄炒蛋', category: 'meat', servingG: 180, caloriesKcal: 180, proteinG: 8, fatG: 12, carbG: 6, fiberG: 2, sodiumMg: 300, priceFen: 800 },
  { canteen: '一食堂', name: '清炒菠菜', category: 'vegetable', servingG: 150, caloriesKcal: 90, proteinG: 3, fatG: 5, carbG: 4, fiberG: 3, sodiumMg: 200, priceFen: 500 },
  { canteen: '一食堂', name: '蒜蓉西兰花', category: 'vegetable', servingG: 150, caloriesKcal: 85, proteinG: 4, fatG: 4, carbG: 7, fiberG: 4, sodiumMg: 180, priceFen: 600 },
  { canteen: '一食堂', name: '上汤娃娃菜', category: 'vegetable', servingG: 200, caloriesKcal: 70, proteinG: 3, fatG: 4, carbG: 5, fiberG: 3, sodiumMg: 380, priceFen: 600 },
  { canteen: '一食堂', name: '紫菜蛋花汤', category: 'soup', servingG: 300, caloriesKcal: 60, proteinG: 4, fatG: 3, carbG: 4, fiberG: 1, sodiumMg: 600, priceFen: 300 },
  { canteen: '一食堂', name: '玉米排骨汤', category: 'soup', servingG: 300, caloriesKcal: 180, proteinG: 10, fatG: 12, carbG: 8, fiberG: 2, sodiumMg: 700, priceFen: 500 },
  { canteen: '一食堂', name: '麻婆豆腐', category: 'vegetable', servingG: 180, caloriesKcal: 220, proteinG: 12, fatG: 15, carbG: 10, fiberG: 2, sodiumMg: 780, priceFen: 900 },
  { canteen: '一食堂', name: '鱼香肉丝', category: 'meat', servingG: 180, caloriesKcal: 320, proteinG: 16, fatG: 22, carbG: 14, fiberG: 1, sodiumMg: 750, priceFen: 1200 },
  { canteen: '一食堂', name: '宫保鸡丁', category: 'meat', servingG: 180, caloriesKcal: 340, proteinG: 22, fatG: 20, carbG: 15, fiberG: 2, sodiumMg: 820, priceFen: 1300 },
  { canteen: '一食堂', name: '清蒸鲈鱼', category: 'meat', servingG: 200, caloriesKcal: 200, proteinG: 26, fatG: 8, carbG: 2, fiberG: 0, sodiumMg: 420, priceFen: 1800 },
  { canteen: '一食堂', name: '香煎鸡腿', category: 'meat', servingG: 150, caloriesKcal: 330, proteinG: 25, fatG: 22, carbG: 6, fiberG: 0, sodiumMg: 700, priceFen: 1200 },
  { canteen: '一食堂', name: '蒸玉米', category: 'staple', servingG: 150, caloriesKcal: 130, proteinG: 4, fatG: 1, carbG: 28, fiberG: 3, sodiumMg: 5, priceFen: 300 },
  { canteen: '一食堂', name: '红薯', category: 'staple', servingG: 150, caloriesKcal: 130, proteinG: 2, fatG: 0, carbG: 30, fiberG: 3, sodiumMg: 10, priceFen: 300 },
  { canteen: '一食堂', name: '白米粥', category: 'staple', servingG: 300, caloriesKcal: 110, proteinG: 3, fatG: 0, carbG: 24, fiberG: 1, sodiumMg: 20, priceFen: 200 },
  { canteen: '一食堂', name: '豆浆', category: 'drink', servingG: 300, caloriesKcal: 90, proteinG: 6, fatG: 4, carbG: 7, fiberG: 0, sodiumMg: 40, priceFen: 200 },
  { canteen: '一食堂', name: '西瓜', category: 'fruit', servingG: 200, caloriesKcal: 60, proteinG: 1, fatG: 0, carbG: 15, fiberG: 1, sodiumMg: 5, priceFen: 500 },
  { canteen: '一食堂', name: '苹果', category: 'fruit', servingG: 150, caloriesKcal: 80, proteinG: 0, fatG: 0, carbG: 20, fiberG: 2, sodiumMg: 2, priceFen: 400 },
  { canteen: '一食堂', name: '红豆布丁', category: 'dessert', servingG: 120, caloriesKcal: 180, proteinG: 3, fatG: 5, carbG: 30, fiberG: 1, sodiumMg: 60, priceFen: 600 },
  { canteen: '一食堂', name: '茶叶蛋', category: 'other', servingG: 60, caloriesKcal: 80, proteinG: 7, fatG: 5, carbG: 1, fiberG: 0, sodiumMg: 300, priceFen: 200 },
  { canteen: '一食堂', name: '可乐', category: 'drink', servingG: 330, caloriesKcal: 140, proteinG: 0, fatG: 0, carbG: 35, fiberG: 0, sodiumMg: 10, priceFen: 350 },

  // ---------------- 二食堂 · 川湘面食 ----------------
  { canteen: '二食堂', name: '牛肉面', category: 'staple', servingG: 450, caloriesKcal: 560, proteinG: 28, fatG: 16, carbG: 72, fiberG: 3, sodiumMg: 1200, priceFen: 1500 },
  { canteen: '二食堂', name: '重庆小面', category: 'staple', servingG: 400, caloriesKcal: 520, proteinG: 18, fatG: 18, carbG: 68, fiberG: 3, sodiumMg: 1400, priceFen: 1200 },
  { canteen: '二食堂', name: '水煮肉片', category: 'meat', servingG: 250, caloriesKcal: 480, proteinG: 28, fatG: 34, carbG: 14, fiberG: 2, sodiumMg: 1600, priceFen: 1600 },
  { canteen: '二食堂', name: '剁椒鱼头', category: 'meat', servingG: 250, caloriesKcal: 300, proteinG: 30, fatG: 18, carbG: 6, fiberG: 1, sodiumMg: 1300, priceFen: 1800 },
  { canteen: '二食堂', name: '辣子鸡', category: 'meat', servingG: 200, caloriesKcal: 420, proteinG: 26, fatG: 30, carbG: 10, fiberG: 1, sodiumMg: 1100, priceFen: 1500 },
  { canteen: '二食堂', name: '干煸四季豆', category: 'vegetable', servingG: 200, caloriesKcal: 240, proteinG: 7, fatG: 18, carbG: 14, fiberG: 5, sodiumMg: 700, priceFen: 900 },
  { canteen: '二食堂', name: '酸辣土豆丝', category: 'vegetable', servingG: 180, caloriesKcal: 180, proteinG: 3, fatG: 10, carbG: 20, fiberG: 2, sodiumMg: 500, priceFen: 600 },
  { canteen: '二食堂', name: '手撕包菜', category: 'vegetable', servingG: 180, caloriesKcal: 120, proteinG: 3, fatG: 7, carbG: 12, fiberG: 3, sodiumMg: 450, priceFen: 600 },
  { canteen: '二食堂', name: '酸辣汤', category: 'soup', servingG: 300, caloriesKcal: 90, proteinG: 5, fatG: 4, carbG: 10, fiberG: 1, sodiumMg: 900, priceFen: 400 },
  { canteen: '二食堂', name: '番茄牛腩', category: 'soup', servingG: 300, caloriesKcal: 260, proteinG: 18, fatG: 14, carbG: 16, fiberG: 2, sodiumMg: 800, priceFen: 1200 },
  { canteen: '二食堂', name: '卤肉饭', category: 'staple', servingG: 400, caloriesKcal: 620, proteinG: 24, fatG: 22, carbG: 80, fiberG: 2, sodiumMg: 1300, priceFen: 1400 },
  { canteen: '二食堂', name: '蛋炒饭', category: 'staple', servingG: 350, caloriesKcal: 560, proteinG: 16, fatG: 18, carbG: 78, fiberG: 2, sodiumMg: 900, priceFen: 1000 },
  { canteen: '二食堂', name: '烤鸭饭', category: 'staple', servingG: 400, caloriesKcal: 700, proteinG: 32, fatG: 30, carbG: 78, fiberG: 1, sodiumMg: 1400, priceFen: 1800 },
  { canteen: '二食堂', name: '凉皮', category: 'staple', servingG: 250, caloriesKcal: 330, proteinG: 8, fatG: 8, carbG: 58, fiberG: 1, sodiumMg: 800, priceFen: 800 },
  { canteen: '二食堂', name: '煎饺', category: 'staple', servingG: 200, caloriesKcal: 420, proteinG: 14, fatG: 18, carbG: 48, fiberG: 2, sodiumMg: 700, priceFen: 900 },
  { canteen: '二食堂', name: '小笼包', category: 'staple', servingG: 200, caloriesKcal: 380, proteinG: 16, fatG: 16, carbG: 42, fiberG: 1, sodiumMg: 600, priceFen: 900 },
  { canteen: '二食堂', name: '皮蛋瘦肉粥', category: 'staple', servingG: 350, caloriesKcal: 200, proteinG: 10, fatG: 4, carbG: 32, fiberG: 1, sodiumMg: 800, priceFen: 600 },
  { canteen: '二食堂', name: '酸奶', category: 'drink', servingG: 200, caloriesKcal: 140, proteinG: 6, fatG: 5, carbG: 18, fiberG: 0, sodiumMg: 80, priceFen: 500 },
  { canteen: '二食堂', name: '橙子', category: 'fruit', servingG: 200, caloriesKcal: 90, proteinG: 1, fatG: 0, carbG: 22, fiberG: 2, sodiumMg: 3, priceFen: 400 },
  { canteen: '二食堂', name: '香蕉', category: 'fruit', servingG: 150, caloriesKcal: 130, proteinG: 2, fatG: 0, carbG: 33, fiberG: 2, sodiumMg: 2, priceFen: 300 },
  { canteen: '二食堂', name: '绿豆汤', category: 'drink', servingG: 300, caloriesKcal: 150, proteinG: 2, fatG: 0, carbG: 36, fiberG: 3, sodiumMg: 20, priceFen: 300 },
  { canteen: '二食堂', name: '麻辣烫', category: 'other', servingG: 400, caloriesKcal: 450, proteinG: 20, fatG: 26, carbG: 36, fiberG: 4, sodiumMg: 1800, priceFen: 1500 },
  { canteen: '二食堂', name: '炸鸡腿', category: 'meat', servingG: 150, caloriesKcal: 400, proteinG: 24, fatG: 26, carbG: 16, fiberG: 0, sodiumMg: 900, priceFen: 1200 },
  { canteen: '二食堂', name: '关东煮', category: 'other', servingG: 250, caloriesKcal: 180, proteinG: 10, fatG: 6, carbG: 22, fiberG: 2, sodiumMg: 1200, priceFen: 800 },

  // ---------------- 三食堂 · 面档 / 轻食 ----------------
  { canteen: '三食堂', name: '兰州拉面', category: 'staple', servingG: 450, caloriesKcal: 540, proteinG: 26, fatG: 14, carbG: 76, fiberG: 3, sodiumMg: 1100, priceFen: 1400 },
  { canteen: '三食堂', name: '牛肉炒面', category: 'staple', servingG: 400, caloriesKcal: 620, proteinG: 24, fatG: 22, carbG: 80, fiberG: 2, sodiumMg: 1300, priceFen: 1500 },
  { canteen: '三食堂', name: '鸡丝凉面', category: 'staple', servingG: 350, caloriesKcal: 480, proteinG: 20, fatG: 14, carbG: 68, fiberG: 2, sodiumMg: 1000, priceFen: 1200 },
  { canteen: '三食堂', name: '手抓饭', category: 'staple', servingG: 400, caloriesKcal: 600, proteinG: 22, fatG: 20, carbG: 82, fiberG: 2, sodiumMg: 900, priceFen: 1600 },
  { canteen: '三食堂', name: '烤鸡胸肉沙拉', category: 'other', servingG: 250, caloriesKcal: 220, proteinG: 28, fatG: 8, carbG: 8, fiberG: 4, sodiumMg: 400, priceFen: 1600 },
  { canteen: '三食堂', name: '藜麦鸡胸碗', category: 'other', servingG: 350, caloriesKcal: 400, proteinG: 32, fatG: 10, carbG: 46, fiberG: 6, sodiumMg: 500, priceFen: 2000 },
  { canteen: '三食堂', name: '清炒芦笋', category: 'vegetable', servingG: 150, caloriesKcal: 80, proteinG: 3, fatG: 4, carbG: 6, fiberG: 3, sodiumMg: 200, priceFen: 800 },
  { canteen: '三食堂', name: '冬瓜排骨汤', category: 'soup', servingG: 300, caloriesKcal: 150, proteinG: 8, fatG: 10, carbG: 6, fiberG: 1, sodiumMg: 650, priceFen: 600 },
  { canteen: '三食堂', name: '蒸南瓜', category: 'staple', servingG: 200, caloriesKcal: 90, proteinG: 2, fatG: 0, carbG: 20, fiberG: 2, sodiumMg: 5, priceFen: 300 },
  { canteen: '三食堂', name: '无糖酸奶', category: 'drink', servingG: 200, caloriesKcal: 110, proteinG: 7, fatG: 4, carbG: 12, fiberG: 0, sodiumMg: 80, priceFen: 600 },
  { canteen: '三食堂', name: '黑咖啡', category: 'drink', servingG: 300, caloriesKcal: 5, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 5, priceFen: 800 },
  { canteen: '三食堂', name: '三明治', category: 'staple', servingG: 200, caloriesKcal: 380, proteinG: 14, fatG: 14, carbG: 46, fiberG: 2, sodiumMg: 800, priceFen: 1200 },
  { canteen: '三食堂', name: '水煮鸡胸', category: 'meat', servingG: 200, caloriesKcal: 230, proteinG: 40, fatG: 5, carbG: 4, fiberG: 0, sodiumMg: 350, priceFen: 1500 },
  { canteen: '三食堂', name: '番茄意面', category: 'staple', servingG: 350, caloriesKcal: 480, proteinG: 16, fatG: 14, carbG: 70, fiberG: 3, sodiumMg: 600, priceFen: 1600 },
  { canteen: '三食堂', name: '西兰花牛肉', category: 'meat', servingG: 250, caloriesKcal: 300, proteinG: 24, fatG: 14, carbG: 18, fiberG: 4, sodiumMg: 700, priceFen: 1800 },
  { canteen: '三食堂', name: '紫薯', category: 'staple', servingG: 150, caloriesKcal: 120, proteinG: 2, fatG: 0, carbG: 28, fiberG: 3, sodiumMg: 10, priceFen: 300 },

  // ---------------- 教工食堂 · 家常 ----------------
  { canteen: '教工食堂', name: '黄焖鸡米饭', category: 'staple', servingG: 450, caloriesKcal: 680, proteinG: 30, fatG: 26, carbG: 80, fiberG: 2, sodiumMg: 1400, priceFen: 1800 },
  { canteen: '教工食堂', name: '清炒虾仁', category: 'meat', servingG: 200, caloriesKcal: 200, proteinG: 24, fatG: 8, carbG: 6, fiberG: 0, sodiumMg: 600, priceFen: 2200 },
  { canteen: '教工食堂', name: '西芹百合', category: 'vegetable', servingG: 200, caloriesKcal: 110, proteinG: 3, fatG: 5, carbG: 12, fiberG: 3, sodiumMg: 400, priceFen: 900 },
  { canteen: '教工食堂', name: '山药排骨汤', category: 'soup', servingG: 300, caloriesKcal: 200, proteinG: 12, fatG: 12, carbG: 10, fiberG: 2, sodiumMg: 700, priceFen: 800 },
  { canteen: '教工食堂', name: '白灼菜心', category: 'vegetable', servingG: 200, caloriesKcal: 60, proteinG: 3, fatG: 3, carbG: 4, fiberG: 3, sodiumMg: 350, priceFen: 600 },
  { canteen: '教工食堂', name: '杂粮饭', category: 'staple', servingG: 200, caloriesKcal: 260, proteinG: 6, fatG: 2, carbG: 54, fiberG: 4, sodiumMg: 10, priceFen: 300 },
  { canteen: '教工食堂', name: '蒸蛋', category: 'other', servingG: 150, caloriesKcal: 110, proteinG: 9, fatG: 7, carbG: 2, fiberG: 0, sodiumMg: 300, priceFen: 400 },
  { canteen: '教工食堂', name: '冰糖雪梨', category: 'drink', servingG: 300, caloriesKcal: 120, proteinG: 0, fatG: 0, carbG: 30, fiberG: 1, sodiumMg: 10, priceFen: 400 },
];

/** 营养数据来源（按食堂给一个可追溯的来源；真实上线应换成公示文件链接/编号） */
export const CANTEEN_SOURCE: Readonly<Record<string, string>> = {
  一食堂: '一食堂公告栏公示',
  二食堂: '二食堂公告栏公示',
  三食堂: '人工录入（营养社整理）',
  教工食堂: '教工食堂公示',
};

/** 这批数据的核对日期 */
export const DISHES_VERIFIED_AT = '2026-10-12T00:00:00.000Z';

/**
 * 菜名 → 过敏原（与 `@kedaya/shared` 的 `inferAllergensFromName` 同一套关键词）。
 *
 * 为什么这里复制一份：seed 是**独立脚本**（`node prisma/seed.mjs`），
 * 直接 import 工作区的 TS 源码在 Node 类型剥离下不稳；这份映射只是初标，
 * 真实标注以录入为准（页面展示「未标注 ≠ 无过敏原」）。
 */
export const ALLERGEN_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['peanut', ['花生', '宫保']],
  ['tree-nut', ['核桃', '杏仁', '腰果', '坚果']],
  ['seafood', ['鱼', '虾', '蟹', '贝', '蛤', '鱿鱼', '海参', '生蚝', '扇贝']],
  ['egg', ['蛋', '皮蛋', '咸蛋']],
  ['milk', ['奶', '芝士', '奶酪', '黄油', '奶油', '布丁', '拿铁']],
  ['soy', ['豆腐', '豆浆', '豆干', '腐竹', '豆皮', '黄豆']],
  ['gluten', ['面', '馒头', '包', '饺', '饼', '蛋糕', '面包', '意面', '拉面', '凉皮', '油条']],
  ['beef', ['牛肉', '牛腩', '牛排', '肥牛']],
  ['pork', ['猪', '排骨', '里脊', '肉包', '卤肉', '红烧肉', '五花', '腊肉', '肘子']],
  ['chili', ['辣', '麻婆', '水煮', '剁椒', '麻辣', '干锅', '香辣']],
  ['cilantro', ['香菜', '芫荽']],
  ['sesame', ['芝麻', '麻酱']],
];

/** 按菜名初标过敏原（命中即标；空数组 = 未标注） */
export function inferAllergensFromSeedName(name: string): string[] {
  return ALLERGEN_KEYWORDS.filter(([, keywords]) => keywords.some((keyword) => name.includes(keyword))).map(
    ([allergen]) => allergen,
  );
}

export function seedSummary(): Record<string, number> {
  return {
    species: SPECIES_SEED.length,
    speciesPendingVerification: SPECIES_SEED.filter((s) => s.needsFieldVerification).length,
    zones: ZONES_SEED.length,
    sensitiveZones: ZONES_SEED.filter((z) => z.isSensitive).length,
    sightings: SIGHTINGS_SEED.length,
    individuals: INDIVIDUALS_SEED.length,
    // 营养管家：菜品库种子（`canteen`，ADR 0006）
    dishes: DISHES_SEED.length,
    dishCanteens: new Set(DISHES_SEED.map((dish) => dish.canteen)).size,
  };
}
