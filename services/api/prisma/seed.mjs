#!/usr/bin/env node
/**
 * wildlife · 种子脚本（规格 §2.5 / §7 / §9）
 *
 * ## 为什么是 `.mjs` 而不是 `.ts`
 *
 * `prisma/seed.ts` 会被 `node` 直接执行，而 Node 的 TypeScript 支持
 * **不会**对 `node_modules` 里的文件做类型剥离 —— 而 `@kedaya/shared` 的入口
 * 正是 `src/index.ts`。因此一个 .ts 种子脚本无法在运行时 import 工作区包。
 *
 * 本脚本改为：**数据**放在 `prisma/seed-data.ts`（纯数据、零 import，
 * 可被 Node 动态 import，也可被单元测试静态 import），
 * **隐私流水线**复用 `dist/` 里编译好的 `domain/fuzzing.js`（**同一份实现**，
 * 绝不在这里重写一遍加噪逻辑 —— 那会变成两套隐私实现）。
 *
 * 因此：**先 `npm run build`，再跑种子**。
 *
 * ## 两种运行模式
 *
 * | 条件 | 行为 |
 * | --- | --- |
 * | 没有 `DATABASE_URL` | **干跑（dry-run）**：打印统计与每条观测的模糊化预览，退出 0 |
 * | 有 `DATABASE_URL` | 连接数据库，upsert 物种 → 区域 → 个体 → 观测（含受限精确坐标） |
 *
 * ⚠️ 干跑**仍然执行真实的模糊化流水线**，所以它是可验证的证据：
 * 你能看到"敏感区内的观测只输出 zoneId"这件事真的发生了。
 *
 * ## 已知限制（如实声明）
 *
 * `reporterId` 用假 id（`seed-user-*`）：种子数据不能依赖真实用户表。
 * 真实部署应先建用户，或把这些行指向实际账号。
 */
import { createRequire } from 'node:module';

/**
 * `.mjs` 永远是 ESM，没有内建 `require`；用 createRequire 拿一个 CJS require
 * （加载编译产物与 `@prisma/client` 都需要它）。
 */
const require = createRequire(import.meta.url);
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..');

const {
  SPECIES_SEED,
  ZONES_SEED,
  SIGHTINGS_SEED,
  INDIVIDUALS_SEED,
  DISHES_SEED,
  CANTEEN_SOURCE,
  DISHES_VERIFIED_AT,
  inferAllergensFromSeedName,
  seedSummary,
} = await import('./seed-data.ts');

/* ------------------------------------------------------------------ *
 * 复用编译产物里的隐私流水线（同一份实现）
 * ------------------------------------------------------------------ */

const FUZZ_MODULE = join(API_ROOT, 'dist/services/api/src/modules/wildlife/domain/fuzzing.js');
const SHARED_DIST = join(API_ROOT, 'dist/packages/shared/src/index.js');

/**
 * 让编译产物里的 `require('@kedaya/shared')` 解析到 **dist** 而不是 TS 源码。
 *
 * 为什么需要：本仓库的工作区包入口是 `src/index.ts`（见 tsconfig 的注释），
 * 而 Node 的类型剥离**不作用于 node_modules**，且 TS 源码内部是 extensionless
 * 相对导入（ESM 解析器不接受）。因此纯 node 进程直接 require 工作区包会失败 ——
 * 这是本仓库 dist 布局的既有局限，不是本脚本引入的。
 *
 * 这里只做**最小重定向**（一个裸说明符 → 已编译的 CJS 入口），
 * 目的是让种子脚本复用**同一份**加噪实现，而不是在脚本里重写一遍隐私逻辑。
 */
function patchWorkspaceResolution() {
  if (!existsSync(SHARED_DIST)) return false;
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@kedaya/shared') return SHARED_DIST;
    return original.call(this, request, ...rest);
  };
  return true;
}

async function loadFuzzing() {
  if (!existsSync(FUZZ_MODULE)) {
    console.error(
      '[seed] 找不到编译后的模糊化模块：\n' +
        `        ${FUZZ_MODULE}\n` +
        '        请先运行 `npm run build -w @kedaya/api`。\n' +
        '        （本脚本刻意复用编译产物，而不是在这里重写一遍加噪逻辑 ——\n' +
        '          两套隐私实现意味着其中一套迟早会漂移。）',
    );
    process.exit(1);
  }
  patchWorkspaceResolution();
  return import(FUZZ_MODULE);
}

/** 干跑/写库共用的模糊化：与 API 走的是同一个函数 */
async function fuzzFor(sighting, speciesById, zoneById, secret) {
  const { fuzzSighting } = await loadFuzzing();
  const species = speciesById.get(sighting.species) ?? null;
  const zone = sighting.zoneId ? zoneById.get(sighting.zoneId) ?? null : null;
  return fuzzSighting({
    sightingId: sighting.id,
    point: { lat: sighting.exactLat, lng: sighting.exactLng },
    observedAt: new Date(sighting.observedAt),
    species: species
      ? {
          isProtected: species.isProtected,
          isNestingSensitive: species.isNestingSensitive,
          nestingMonths: species.nestingMonths,
        }
      : null,
    zone: zone
      ? { id: zone.id, fuzzRadiusM: zone.fuzzRadiusM, isSensitive: zone.isSensitive }
      : null,
    sensitiveAreas: ZONES_SEED.filter((z) => z.isSensitive && Array.isArray(z.sensitiveRing)).map((z) => ({
      id: z.id,
      ring: z.sensitiveRing,
      reason: 'sensitive-zone',
    })),
    secret,
    // 种子数据按"同格 3 人"处理，避免种子数据一律降级成 zone-only
    // （真实系统里这个数字来自 data 层的计数）
    distinctReportersInCell: 3,
  });
}

/* ------------------------------------------------------------------ *
 * 干跑
 * ------------------------------------------------------------------ */

async function dryRun() {
  const secret = process.env.WILDLIFE_FUZZ_SECRET ?? 'dev-only-seed-secret-32-bytes-minimum!';
  const speciesById = new Map(SPECIES_SEED.map((s) => [s.id, s]));
  const zoneById = new Map(ZONES_SEED.map((z) => [z.id, z]));

  console.log('[seed] 没有 DATABASE_URL → 干跑模式（不写库，但**真实执行**模糊化流水线）');
  console.log('[seed] 统计：', JSON.stringify(seedSummary()));
  console.log('[seed] 待实地核实（U2）的物种条目：', seedSummary().speciesPendingVerification);
  console.log(
    '[seed] 营养管家菜品库：',
    `${DISHES_SEED.length} 道，覆盖 ${seedSummary().dishCanteens} 个食堂（演示量级，非公示值）`,
  );
  console.log('');

  for (const sighting of SIGHTINGS_SEED) {
    const result = await fuzzFor(sighting, speciesById, zoneById, secret);
    const coords =
      result.geo === null
        ? `（无坐标，只给 zoneId=${result.zoneId ?? 'null'}）`
        : `(${result.geo.lat.toFixed(5)}, ${result.geo.lng.toFixed(5)})`;
    console.log(
      `[seed] ${sighting.id} ${sighting.species} → level=${result.level} ` +
        `radius=${result.fuzzRadiusM}m delay=${result.publishDelayDays}d ${coords}`,
    );
  }

  console.log('');
  console.log('[seed] 干跑完成：未写入任何数据。设置 DATABASE_URL 后重跑即会写库。');
}

/* ------------------------------------------------------------------ *
 * 营养管家（`canteen`）· 菜品库
 * ------------------------------------------------------------------ */

/**
 * 灌菜品库（ADR 0006 C2）。
 *
 * 幂等键选 `(canteen, name)` 而不是自增 id：菜品目录是**人工维护**的列表，
 * 重复执行种子脚本不应该产生第二份「红烧排骨」——那会让推荐里出现两道一样的菜。
 *
 * 过敏原按菜名初标（`inferAllergensFromSeedName`）；`source` / `lastVerifiedAt`
 * 一起写进去，页面才能回答「这个数字凭什么可信」。
 */
async function seedDishes(prisma) {
  let created = 0;
  let updated = 0;
  for (const dish of DISHES_SEED) {
    const data = {
      ...dish,
      source: CANTEEN_SOURCE[dish.canteen] ?? '人工录入',
      lastVerifiedAt: new Date(DISHES_VERIFIED_AT),
      allergens: inferAllergensFromSeedName(dish.name),
    };
    const existing = await prisma.canteenDish.findFirst({
      where: { canteen: dish.canteen, name: dish.name },
    });
    if (existing === null) {
      await prisma.canteenDish.create({ data });
      created += 1;
    } else {
      await prisma.canteenDish.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }
  console.log(`[seed] 菜品库：新增 ${created} 道，更新 ${updated} 道（共 ${DISHES_SEED.length} 道）`);
}

/** 与服务端一致的「一天」口径（分钟），用于把演示餐落在今天 */
const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? 480);

/** 今天的某个时刻（按项目时区口径，与 `common/time/app-day.ts` 对齐） */
function todayAt(hour, minute, now = new Date()) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  const wallMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dayStart = wallMidnight - TZ_OFFSET_MINUTES * 60 * 1000;
  return new Date(dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000);
}

/**
 * 给**已存在的**账号灌一天演示饮食（每日需求 + 今日早/午餐）。
 *
 * 刻意**不新建账号**：账号由用户自己用邮箱注册或 CAS 登录产生，
 * 种子脚本凭空造一个能登录的账号是安全债（`docs/local-development.md` 的口径）。
 * 目标账号用 `SEED_NUTRITION_EMAIL` 指定（默认 `demo@kedaya.dev`）；
 * 找不到就如实说明并跳过，而不是静默成功。
 *
 * 幂等：今天已有记录时不写；每日需求用 upsert。
 */
async function seedNutritionDemo(prisma) {
  const email = (process.env.SEED_NUTRITION_EMAIL ?? 'demo@kedaya.dev').trim().toLowerCase();
  const credential = await prisma.userCredential.findUnique({
    where: { email },
    include: { user: true },
  });
  if (credential === null) {
    console.log(
      `[seed] 跳过营养管家演示数据：找不到账号 ${email}（用 SEED_NUTRITION_EMAIL 指定一个已注册邮箱）`,
    );
    return;
  }
  const userId = credential.userId;

  await prisma.nutritionTarget.upsert({
    where: { userId },
    create: {
      userId,
      caloriesKcal: 2400,
      proteinG: 96,
      fatG: 66,
      carbG: 336,
      fiberG: 34,
      sodiumMg: 2000,
      sex: 'male',
      age: 20,
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
    },
    // 已有需求就不覆盖：用户的真实需求优先于种子
    update: {},
  });

  const todayStart = todayAt(0, 0);
  const existingMeals = await prisma.mealRecord.count({
    where: { userId, eatenAt: { gte: todayStart } },
  });
  if (existingMeals > 0) {
    console.log(`[seed] ${email} 今天已有 ${existingMeals} 条饮食记录，跳过写入`);
    return;
  }

  const pick = async (name) => {
    const dish = await prisma.canteenDish.findFirst({ where: { name, deletedAt: null } });
    if (dish === null) throw new Error(`种子菜品缺失：${name}`);
    return dish;
  };
  const toItem = (dish, servings) => ({
    dishId: dish.id,
    dishName: dish.name,
    category: dish.category,
    servings,
    caloriesKcal: dish.caloriesKcal,
    proteinG: dish.proteinG,
    fatG: dish.fatG,
    carbG: dish.carbG,
    fiberG: dish.fiberG,
    sodiumMg: dish.sodiumMg,
  });

  const breakfast = [await pick('豆浆'), await pick('小笼包')];
  const lunch = [await pick('米饭'), await pick('红烧排骨'), await pick('清炒菠菜')];

  await prisma.mealRecord.create({
    data: {
      userId,
      mealType: 'breakfast',
      source: 'manual',
      eatenAt: todayAt(8, 5),
      items: { create: breakfast.map((dish) => toItem(dish, 1)) },
    },
  });
  await prisma.mealRecord.create({
    data: {
      userId,
      mealType: 'lunch',
      source: 'photo',
      eatenAt: todayAt(12, 10),
      note: '一食堂二楼',
      items: { create: lunch.map((dish) => toItem(dish, 1)) },
    },
  });
  console.log(`[seed] 营养管家演示数据：${email} 已写入每日需求 + 今日早餐/午餐`);
}

/* ------------------------------------------------------------------ *
 * 写库
 * ------------------------------------------------------------------ */

async function writeToDatabase() {
  const secret = process.env.WILDLIFE_FUZZ_SECRET;
  if (!secret || secret.length < 32) {
    console.error('[seed] 缺少 WILDLIFE_FUZZ_SECRET（≥32 字节）：位置模糊化不能降级，拒绝写库');
    process.exit(1);
  }

  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const speciesById = new Map(SPECIES_SEED.map((s) => [s.id, s]));
  const zoneById = new Map(ZONES_SEED.map((z) => [z.id, z]));

  try {
    // —— 物种：父级先写（自引用外键） ——
    const ordered = [...SPECIES_SEED].sort(
      (a, b) => (a.parentId === null ? 0 : 1) - (b.parentId === null ? 0 : 1),
    );
    for (const species of ordered) {
      const data = {
        scientificName: species.scientificName,
        commonNameZh: species.commonNameZh,
        commonNameEn: species.commonNameEn,
        taxonRank: species.taxonRank,
        parentId: species.parentId,
        isProtected: species.isProtected,
        isNestingSensitive: species.isNestingSensitive,
        nestingMonths: species.nestingMonths,
        defaultFeedingPolicy: species.defaultFeedingPolicy,
        externalIds: species.externalIds,
        isActive: true,
        needsFieldVerification: species.needsFieldVerification,
        verificationNote: species.verificationNote,
      };
      await prisma.speciesTaxonomy.upsert({
        where: { id: species.id },
        create: { id: species.id, ...data },
        update: data,
      });
    }

    // —— 区域 ——
    for (const zone of ZONES_SEED) {
      const data = {
        name: zone.name,
        speciesIds: zone.speciesIds,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusM: zone.radiusM,
        feedingPolicy: zone.feedingPolicy,
        note: zone.note,
        fuzzRadiusM: zone.fuzzRadiusM,
        isSensitive: zone.isSensitive,
        sensitiveRing: zone.sensitiveRing,
        noticeText: zone.noticeText,
        sortOrder: zone.sortOrder,
      };
      await prisma.wildlifeZone.upsert({
        where: { id: zone.id },
        create: { id: zone.id, ...data },
        update: data,
      });
    }

    // —— 命名个体 ——
    for (const individual of INDIVIDUALS_SEED) {
      const data = {
        name: individual.name,
        speciesId: individual.speciesId,
        description: individual.description,
        status: individual.status,
        isActive: true,
        createdBy: individual.createdBy,
      };
      await prisma.wildlifeIndividual.upsert({
        where: { id: individual.id },
        create: { id: individual.id, ...data },
        update: data,
      });
    }

    // —— 观测：公开行只写**模糊后**的坐标，精确坐标只进受限表 ——
    for (const sighting of SIGHTINGS_SEED) {
      const fuzz = await fuzzFor(sighting, speciesById, zoneById, secret);
      const publicData = {
        zoneId: sighting.zoneId,
        species: sighting.species,
        status: sighting.status,
        geoLat: fuzz.geo?.lat ?? null,
        geoLng: fuzz.geo?.lng ?? null,
        geoFuzzLevel: fuzz.level,
        fuzzRadiusM: fuzz.fuzzRadiusM,
        gridCellKey: fuzz.gridCellKey,
        photoUrls: [],
        healthConcern: sighting.healthConcern,
        reporterId: sighting.reporterId,
        observedAt: new Date(sighting.observedAt),
        observedAtFuzzed: new Date(fuzz.observedAtFuzzed),
        publishDelayDays: fuzz.publishDelayDays,
        classifiedBy: 'manual',
        note: sighting.note,
        isAnonymous: sighting.isAnonymous,
        moderatedBy: sighting.status === 'PUBLISHED' ? 'seed-moderator' : null,
        moderatedAt: sighting.status === 'PUBLISHED' ? new Date() : null,
      };
      await prisma.wildlifeSighting.upsert({
        where: { id: sighting.id },
        create: { id: sighting.id, ...publicData },
        update: publicData,
      });
      await prisma.wildlifeSightingExact.upsert({
        where: { sightingId: sighting.id },
        create: {
          sightingId: sighting.id,
          exactLat: sighting.exactLat,
          exactLng: sighting.exactLng,
          exactAccuracyM: 10,
          exactObservedAt: new Date(sighting.observedAt),
        },
        update: {
          exactLat: sighting.exactLat,
          exactLng: sighting.exactLng,
          exactObservedAt: new Date(sighting.observedAt),
        },
      });
    }

    // —— 营养管家：菜品库（ADR 0006 C2）——
    await seedDishes(prisma);
    await seedNutritionDemo(prisma);

    console.log('[seed] 写入完成：', JSON.stringify(seedSummary()));
    console.log('[seed] 热点/轨迹是**派生只读**资源，需由 Worker 调用 recomputeAll() 生成。');
  } finally {
    await prisma.$disconnect();
  }
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

if (process.env.DATABASE_URL) {
  await writeToDatabase();
} else {
  await dryRun();
}
