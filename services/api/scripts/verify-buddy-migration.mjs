#!/usr/bin/env node
/**
 * buddy · 手写迁移 + pgvector 查询的**真实 Postgres 验证**（离线，无需安装 PostgreSQL）
 *
 * 本机没有 PostgreSQL（任务书明确），但"手写迁移能不能建起来"、"`<=>` 到底能不能用"
 * 这两件事不能靠 `prisma migrate diff` 的文本产物来猜。这里用 **PGlite**
 * （PostgreSQL 的 WASM 构建）真实执行三份迁移，然后断言：
 *
 *   1. 7 张 buddy 表存在，脚手架占位 `BuddyGroup` 已被**真的删掉**；
 *   2. `BuddyProfile.embedding` / `BuddyPost.embedding` 是 `vector(768)`
 *      （`format_type(atttypid, atttypmod)` 读出来，不是猜的）；
 *   3. 维度约束真的生效（插 3 维向量被拒）；
 *   4. 外键真的建起来了（漏掉外键的表照样能建，肉眼看不出来）；
 *   5. `<=>` 余弦距离排序可用，且**参数绑定**让注入字符串无法成为 SQL；
 *   6. HNSW 索引**刻意不存在**（规格 §4.3：小数据量下建索引是纯负债）。
 *
 * 用法（在仓库根目录）：node services/api/scripts/verify-buddy-migration.mjs
 * ⚠️ 依赖 `@electric-sql/pglite`（node_modules 里已有）。它是**验证工具**，
 *    不是运行时依赖，因此不进 services/api/package.json。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'prisma', 'migrations');
const INIT = join(MIGRATIONS, '20261017030000_init', 'migration.sql');
const WILDLIFE = join(MIGRATIONS, '20261017040000_wildlife', 'migration.sql');
const BUDDY = join(MIGRATIONS, '20261017050000_buddy', 'migration.sql');

const TABLES = [
  'BuddyProfile',
  'BuddyPost',
  'BuddyApplication',
  'BuddyMatchFeedback',
  'BuddyQuestionnaire',
  'BuddyQuestionnaireResponse',
  'BuddyTag',
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

// `extensions: { vector }` 让 `CREATE EXTENSION vector` 在 WASM 里可用（pgvector 0.8.x）
const db = new PGlite({ extensions: { vector } });
try {
  console.log('[verify] 用 PGlite（PostgreSQL WASM + pgvector）真实执行迁移');
  await db.exec(readFileSync(INIT, 'utf8'));
  console.log('  ✓ init 迁移执行成功');
  await db.exec(readFileSync(WILDLIFE, 'utf8'));
  console.log('  ✓ wildlife 迁移执行成功');
  await db.exec(readFileSync(BUDDY, 'utf8'));
  console.log('  ✓ buddy 迁移执行成功（含 CREATE EXTENSION vector）');

  // —— 1. 表 ——
  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`,
    [TABLES],
  );
  check(`7 张 buddy 表全部存在`, tables.rows.length === TABLES.length, `实得 ${tables.rows.length}`);

  const retired = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name='BuddyGroup'`,
  );
  check('脚手架占位表 BuddyGroup 已被迁移真的删掉', retired.rows.length === 0);

  const ext = await db.query(
    `SELECT extname, extversion FROM pg_extension WHERE extname='vector'`,
  );
  check(
    'pgvector 扩展已安装',
    ext.rows.length === 1,
    JSON.stringify(ext.rows),
  );

  // —— 2. vector 列与维度 ——
  const vecCols = await db.query(
    `SELECT c.relname AS table_name, a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS formatted
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND NOT a.attisdropped AND a.attnum > 0
       AND a.attname='embedding' AND c.relname IN ('BuddyProfile','BuddyPost')
     ORDER BY c.relname`,
  );
  check(
    'embedding 列是 vector(768)（format_type 实测）',
    vecCols.rows.length === 2 && vecCols.rows.every((r) => r.formatted === 'vector(768)'),
    JSON.stringify(vecCols.rows),
  );

  // —— 3. 维度约束真的生效 ——
  await db.exec(`INSERT INTO "User" (id, "displayName", "updatedAt") VALUES ('u-buddy','鸭鸭', now());`);
  let dimEnforced = false;
  try {
    await db.exec(
      `INSERT INTO "BuddyProfile" ("userId", "updatedAt", "embedding") VALUES ('u-buddy', now(), '[1,2,3]');`,
    );
  } catch {
    dimEnforced = true;
  }
  check('维度约束真的生效（往 vector(768) 插 3 维被拒）', dimEnforced);

  // —— 4. 外键 ——
  const fks = await db.query(
    `SELECT conname FROM pg_constraint
     WHERE contype='f' AND connamespace='public'::regnamespace
       AND replace(conrelid::regclass::text, '"', '') = ANY($1)
     ORDER BY conname`,
    [TABLES],
  );
  check('外键已建立（8 条）', fks.rows.length === 8, `实得 ${fks.rows.length}`);

  let fkEnforced = false;
  try {
    await db.exec(
      `INSERT INTO "BuddyPost" (id, "creatorId", activity, title, location, "startsAt", capacity, "updatedAt")
       VALUES ('p-bad','u-does-not-exist','sport','x','体育馆', now(), 4, now());`,
    );
  } catch {
    fkEnforced = true;
  }
  check('外键约束真的生效（引用不存在的用户被拒）', fkEnforced);

  // —— 5. 唯一约束（反馈的 section 隔离维度） ——
  // 注意：Prisma 的 `@@unique` 在这里落成**唯一索引**（CREATE UNIQUE INDEX），
  // 不是 pg_constraint 里的表约束，所以要查 pg_indexes。
  const uniq = await db.query(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND tablename='BuddyMatchFeedback' AND indexdef ILIKE '%UNIQUE%'`,
  );
  check(
    '反馈唯一索引 (userId,targetPostId,section) 存在 —— UPSERT 语义由 DB 保证',
    uniq.rows.some(
      (r) =>
        r.indexname === 'BuddyMatchFeedback_userId_targetPostId_section_key' &&
        // pg 只给需要引用的标识符加引号，所以先去掉引号再比对
        r.indexdef.replaceAll('"', '').includes('(userId, targetPostId, section)'),
    ),
    JSON.stringify(uniq.rows),
  );

  // 唯一性真的生效：同 (user,post,section) 插两次必须被拒（这正是 UPSERT 的前提）
  await db.exec(
    `INSERT INTO "BuddyPost" (id,"creatorId",activity,status,title,location,"startsAt",capacity,"updatedAt")
     VALUES ('p-fb','u-buddy','sport','OPEN','fb','体育馆', now() + interval '3 day', 4, now());`,
  );
  await db.exec(
    `INSERT INTO "BuddyMatchFeedback" (id,"userId","targetPostId",section,action,"updatedAt")
     VALUES ('f-1','u-buddy','p-fb','academic','dislike', now());`,
  );
  let uniqueEnforced = false;
  try {
    await db.exec(
      `INSERT INTO "BuddyMatchFeedback" (id,"userId","targetPostId",section,action,"updatedAt")
       VALUES ('f-2','u-buddy','p-fb','academic','like', now());`,
    );
  } catch {
    uniqueEnforced = true;
  }
  check('同一 (user,post,section) 的重复反馈被唯一索引拒绝（可覆盖、不可累积）', uniqueEnforced);

  // —— 6. `<=>` 真实可用 + 参数绑定抗注入 ——
  const vec = (arr) => `[${arr.join(',')}]`;
  const dim = 768;
  const unit = (i) => {
    const v = new Array(dim).fill(0);
    v[i] = 1;
    return v;
  };
  await db.query(
    `INSERT INTO "BuddyPost" (id,"creatorId",activity,status,title,location,"startsAt",capacity,"updatedAt","embedding")
     VALUES ('p-near','u-buddy','sport','OPEN','near','体育馆', now() + interval '1 day', 4, now(), $1::vector),
            ('p-far','u-buddy','sport','OPEN','far','体育馆', now() + interval '2 day', 4, now(), $2::vector)`,
    [vec(unit(0)), vec(unit(1))],
  );
  const ranked = await db.query(
    `SELECT p."id", (p."embedding" <=> $1::vector) AS distance
     FROM "BuddyPost" p WHERE p."embedding" IS NOT NULL
     ORDER BY p."embedding" <=> $1::vector ASC LIMIT $2`,
    [vec(unit(0)), 2],
  );
  check(
    '`<=>` 余弦距离召回可用且排序正确（近的在前）',
    ranked.rows.length === 2 && ranked.rows[0].id === 'p-near' && Number(ranked.rows[0].distance) === 0,
    JSON.stringify(ranked.rows.map((r) => [r.id, Number(r.distance)])),
  );

  // —— 6b. 注入不可能：绑定参数 vs 字符串拼接（**对照实验**） ——
  //
  // 应用侧的写法是 `$queryRaw` 模板 + `${literal}::vector`（规格 §4.4），
  // Prisma 会把它变成绑定参数 $1。这里在真实 Postgres 上验证两件事：
  //   (a) 恶意字面量作为**绑定参数**传进去 → 只是数据，Postgres 报 vector 语法错，DROP 不执行；
  //   (b) 同样的字符串**拼接**进 SQL → DROP 真的执行（用一个替身表演示，不碰真表）。
  const EVIL = `[1,0,0]'); DROP TABLE "BuddyPost"; --`;
  const before = await db.query(`SELECT count(*)::int AS n FROM "BuddyPost"`);

  let boundRejected = false;
  try {
    await db.query(`SELECT $1::vector AS v`, [EVIL]);
  } catch {
    boundRejected = true;
  }
  const after = await db.query(`SELECT count(*)::int AS n FROM "BuddyPost"`);
  check(
    '绑定参数：恶意字面量只被当作数据（报 vector 语法错），真表未被删除',
    boundRejected && after.rows[0].n === before.rows[0].n,
    JSON.stringify({ before: before.rows[0].n, after: after.rows[0].n, boundRejected }),
  );

  // 对照：在替身表上做拼接，证明"如果没有参数绑定会怎样"
  await db.exec(`CREATE TABLE "InjectionProbe" ("id" text primary key);`);
  await db.exec(`SELECT '[1,0,0]'; DROP TABLE "InjectionProbe"; --'::vector;`);
  const probe = await db.query(
    `SELECT to_regclass('public."InjectionProbe"')::text AS t`,
  );
  check(
    '对照实验：字符串拼接时 DROP 真的执行了（替身表已消失）—— 这就是必须绑定参数的原因',
    probe.rows[0].t === null,
    JSON.stringify(probe.rows),
  );

  // —— 7. 刻意没有 HNSW 索引 ——
  const hnsw = await db.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename IN ('BuddyProfile','BuddyPost')
       AND (indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%ivfflat%')`,
  );
  check(
    '未建向量索引（规格 §4.3：几千行时顺序扫描更简单也更准）',
    hnsw.rows.length === 0,
    JSON.stringify(hnsw.rows),
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`[verify] 失败 ${failures.length} 项：${failures.join(' / ')}`);
    process.exitCode = 1;
  } else {
    console.log('[verify] 全部通过：手写迁移在真实 PostgreSQL + pgvector 上可执行，约束与 `<=>` 查询均成立。');
  }
} finally {
  await db.close();
}
