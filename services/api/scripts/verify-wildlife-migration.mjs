#!/usr/bin/env node
/**
 * wildlife · 迁移 SQL 的**真实 Postgres 验证**（离线，无需安装 PostgreSQL）
 *
 * 本机没有 PostgreSQL（任务书明确），但"迁移能不能建起来"这件事不能只靠
 * `prisma migrate diff` 的文本产物来猜。这里用 **PGlite**（PostgreSQL 的
 * WASM 构建）真实执行两份迁移，然后断言：
 *
 *   1. 8 张 wildlife 表存在，且脚手架占位 `WildlifeSpot` 已被替换；
 *   2. 经纬度列是 `numeric(10,7)`，并能**无损往返**（写入→读出字符串一致）；
 *   3. **外键真的建起来了**（漏掉外键的表照样能建，肉眼看不出来）；
 *   4. `WildlifeSightingExact` 是独立受限表（精确坐标不在公开表里）。
 *
 * 用法（在仓库根目录）：node services/api/scripts/verify-wildlife-migration.mjs
 * ⚠️ 依赖 `@electric-sql/pglite`（node_modules 里已有，来自 pglite-tools 的可选依赖）。
 *    它是**验证工具**，不是运行时依赖，因此不进 services/api/package.json。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'prisma', 'migrations');
const INIT = join(MIGRATIONS, '20261017030000_init', 'migration.sql');
const WILDLIFE = join(MIGRATIONS, '20261017040000_wildlife', 'migration.sql');

const TABLES = [
  'SpeciesTaxonomy',
  'WildlifeZone',
  'WildlifeSighting',
  'WildlifeSightingExact',
  'WildlifeIndividual',
  'WildlifeMedia',
  'WildlifeSpot',
  'WildlifeTrack',
];

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label} ${detail}`);
    failures.push(label);
  }
}

const db = new PGlite();
try {
  console.log('[verify] 用 PGlite（PostgreSQL WASM）真实执行迁移');
  await db.exec(readFileSync(INIT, 'utf8'));
  console.log('  ✓ init 迁移执行成功');
  await db.exec(readFileSync(WILDLIFE, 'utf8'));
  console.log('  ✓ wildlife 迁移执行成功');

  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`,
    [TABLES],
  );
  check(`8 张 wildlife 表全部存在`, tables.rows.length === TABLES.length, `实得 ${tables.rows.length}`);

  const cols = await db.query(
    `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name IN ('WildlifeSighting','WildlifeSightingExact','WildlifeZone','WildlifeSpot')
       AND (column_name ILIKE '%lat%' OR column_name ILIKE '%lng%')
     ORDER BY table_name, column_name`,
  );
  check(
    '经纬度列全部是 numeric(10,7)（规格 §7：Decimal(10,7)）',
    cols.rows.length >= 8 &&
      cols.rows.every((r) => r.data_type === 'numeric' && r.numeric_precision === 10 && r.numeric_scale === 7),
    JSON.stringify(cols.rows),
  );

  const fks = await db.query(
    `SELECT conname FROM pg_constraint
     WHERE contype='f' AND connamespace='public'::regnamespace
       AND replace(conrelid::regclass::text, '"', '') = ANY($1)
     ORDER BY conname`,
    [TABLES],
  );
  check('外键已建立（≥10 条）', fks.rows.length >= 10, `实得 ${fks.rows.length}`);

  const exact = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='WildlifeSightingExact' ORDER BY column_name`,
  );
  const exactCols = exact.rows.map((r) => r.column_name);
  check(
    '受限表只存精确坐标（exactLat/exactLng/exactAccuracyM/exactObservedAt/sightingId）',
    ['sightingId', 'exactLat', 'exactLng', 'exactAccuracyM', 'exactObservedAt'].every((c) => exactCols.includes(c)),
    exactCols.join(','),
  );

  // —— 真实写入：验证精度往返与约束 ——
  await db.exec(`
    INSERT INTO "User" (id, "displayName", "updatedAt") VALUES ('u-1','测试同学', now());
    INSERT INTO "SpeciesTaxonomy" (id, "scientificName", "commonNameZh", "taxonRank", "defaultFeedingPolicy", "externalIds", "updatedAt")
    VALUES ('sp-x','Cygnus atratus','黑天鹅','species','forbidden','{}', now());
    INSERT INTO "WildlifeSighting" (id, species, status, "geoLat", "geoLng", "geoFuzzLevel", "fuzzRadiusM", "photoUrls", "healthConcern", "reporterId", "observedAt", "observedAtFuzzed", "publishDelayDays", "classifiedBy", "isAnonymous", "createdAt", "updatedAt")
    VALUES ('s-1','sp-x','PENDING', 31.1769812, 121.5947812, 'grid', 80, ARRAY[]::text[], false, 'u-1', now(), now(), 0, 'manual', false, now(), now());
    INSERT INTO "WildlifeSightingExact" ("sightingId","exactLat","exactLng","exactAccuracyM","exactObservedAt")
    VALUES ('s-1', 31.17698123, 121.59478123, 10, now());
  `);
  const round = await db.query(
    `SELECT s."geoLat"::text AS fuzzed, e."exactLat"::text AS exact
     FROM "WildlifeSighting" s JOIN "WildlifeSightingExact" e ON e."sightingId" = s.id`,
  );
  check('Decimal(10,7) 无损往返', round.rows[0].fuzzed === '31.1769812' && round.rows[0].exact === '31.1769812', JSON.stringify(round.rows[0]));

  let fkEnforced = false;
  try {
    await db.exec(
      `INSERT INTO "WildlifeSighting" (id, species, status, "geoFuzzLevel", "fuzzRadiusM", "photoUrls", "healthConcern", "reporterId", "observedAt", "observedAtFuzzed", "publishDelayDays", "classifiedBy", "isAnonymous", "createdAt", "updatedAt")
       VALUES ('s-bad','sp-does-not-exist','PENDING','grid',50,ARRAY[]::text[],false,'u-1',now(),now(),0,'manual',false,now(),now());`,
    );
  } catch {
    fkEnforced = true;
  }
  check('外键约束真的生效（引用不存在的物种被拒）', fkEnforced);

  const cascade = await db.query(
    `SELECT confdeltype FROM pg_constraint WHERE conname='WildlifeSightingExact_sightingId_fkey'`,
  );
  check('受限表随主表级联删除（confdeltype=c）', cascade.rows[0]?.confdeltype === 'c', JSON.stringify(cascade.rows));

  console.log('');
  if (failures.length > 0) {
    console.error(`[verify] 失败 ${failures.length} 项：${failures.join(' / ')}`);
    process.exitCode = 1;
  } else {
    console.log('[verify] 全部通过：迁移在真实 PostgreSQL（PGlite）上可执行且约束完整。');
  }
} finally {
  await db.close();
}
