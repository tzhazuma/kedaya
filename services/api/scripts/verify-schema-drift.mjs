#!/usr/bin/env node
/**
 * 迁移 ↔ Prisma schema 零漂移验证（离线，无需安装 PostgreSQL）
 *
 * ## 为什么需要这个脚本
 *
 * 迁移目录里既有 `prisma migrate dev` 自动生成的 SQL，也有**手写**的 SQL
 * （`vector` 列、列改名、默认值统一、存量数据回填这些 datamodel 差异推不出来的
 * 东西）。手写就有写歪的风险：漏一个索引、少一个 `DEFAULT`、外键少了
 * `ON DELETE CASCADE`、两条分支的基线混在一起 —— 这些**都不会**让迁移报错，
 * 只会表现为"数据库与 schema 不一致"，然后在某个半夜的查询上炸掉。
 *
 * 因此这里做一件确定性的事：
 *   1. 用 PGlite（PostgreSQL WASM + pgvector）**按文件名顺序真实执行全部迁移**；
 *   2. 把该库的 URL 交给 `prisma migrate diff --from-config-datasource --to-schema`；
 *   3. 用 `--exit-code` 断言 **diff 为空**（Empty: 0 / Not empty: 2）。
 *
 * diff 为空 ⟺ 迁移累计效果与 `schema.prisma` 完全一致。
 *
 * ## 与旧脚本的区别
 *
 * 原 `verify-buddy-schema-drift.mjs` 把迁移目录名**硬编码**在脚本里，于是
 * "新增/删除迁移时忘了同步脚本" 会让校验悄悄失效（并且它只跑 3 份迁移却断言
 * 全量 schema 零漂移，本身就是错的）。本脚本改为**自动发现**迁移目录
 * （`prisma/migrations/<数字开头>/migration.sql`，按文件名排序），
 * 与运行时用的测试夹具 `test/fixtures/pglite-prisma.ts` 用同一套发现规则。
 *
 * 用法（在仓库根目录）：node services/api/scripts/verify-schema-drift.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/** 本进程里跑的是 `.mjs`，不 import TS 夹具；发现规则与它保持一致（见其注释）。 */
function discoverMigrationDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * ⚠️ 必须用**异步** spawn，不能用 `spawnSync`。
 *
 * PGlite 的 socket 服务端跑在**本进程**里。`spawnSync` 会阻塞 Node 事件循环，
 * 于是子进程 `prisma` 连接过来时本进程根本没法 accept —— 表现为
 * `P1001 Can't reach database server`，看起来像"PGlite 不能用"，
 * 实际是把自己饿死了。这个坑值得写下来。
 */
function run(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const MIGRATIONS = join(API_DIR, 'prisma', 'migrations');
const MIGRATION_DIRS = discoverMigrationDirs(MIGRATIONS);

const db = new PGlite({ extensions: { vector } });
const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
try {
  console.log(`[drift] 在 PGlite（PostgreSQL WASM + pgvector）上执行 ${MIGRATION_DIRS.length} 份迁移`);
  for (const dir of MIGRATION_DIRS) {
    await db.exec(readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
    console.log(`  ✓ ${dir}`);
  }

  await server.start();
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  console.log('[drift] 迁移后数据库已就绪，交给 prisma migrate diff');

  const result = await run(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
      '--exit-code',
    ],
    {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
    },
  );

  // `--script` 在 diff 为空时会打印一行注释 `-- This is an empty migration.`，
  // 所以"空"的判据是**去掉注释与空白后没有语句**，而不是字符串长度为 0。
  const script = (result.stdout ?? '').trim();
  const statements = script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))
    .join('\n')
    .trim();

  if (result.status === 0 && statements.length === 0) {
    console.log(`  ✓ migrate diff 为空（--exit-code=0，输出仅 "${script}"）`);
    console.log('  ✓ 结论：迁移与 schema.prisma **零漂移**');
    console.log('');
    console.log('[drift] 全部通过。');
  } else {
    console.error(`  ✗ migrate diff 非空（exit=${result.status}）—— 迁移与 schema 不一致：`);
    console.error(statements || script || '(空输出)');
    if (result.stderr) console.error(result.stderr.trim());
    process.exitCode = 1;
  }
} finally {
  await server.stop();
  await db.close();
}
