#!/usr/bin/env node
/**
 * buddy · 「手写迁移 ↔ Prisma schema」零漂移验证（离线，无需安装 PostgreSQL）
 *
 * ## 为什么需要这个脚本
 *
 * `BuddyProfile.embedding` / `BuddyPost.embedding` 是 `Unsupported("vector(768)")`，
 * Prisma **不能**为它生成迁移，所以 `20261017050000_buddy/migration.sql` 是手写的。
 * 手写就有写歪的风险：漏一个索引、少一个 `DEFAULT`、外键少了 `ON DELETE CASCADE` ——
 * 这些**都不会**让迁移报错，只会在生产上表现为"行为和 schema 不一致"。
 *
 * 因此这里做一件确定性的事：
 *   1. 用 PGlite（PostgreSQL WASM + pgvector）**真实执行全部三份迁移**；
 *   2. 把该库的 URL 交给 `prisma migrate diff --from-config-datasource --to-schema`；
 *   3. 用 `--exit-code` 断言 **diff 为空**（Empty: 0 / Not empty: 2）。
 *
 * diff 为空 ⟺ 迁移累计效果与 schema 完全一致。这比"肉眼看 SQL"强得多。
 *
 * 用法（在仓库根目录）：node services/api/scripts/verify-buddy-schema-drift.mjs
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

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

const MIGRATION_DIRS = [
  '20261017030000_init',
  '20261017040000_wildlife',
  '20261017050000_buddy',
];

const db = new PGlite({ extensions: { vector } });
const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
try {
  console.log('[drift] 在 PGlite（PostgreSQL WASM + pgvector）上执行全部迁移');
  for (const dir of MIGRATION_DIRS) {
    await db.exec(readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
    console.log(`  ✓ ${dir}`);
  }

  await server.start();
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  console.log(`[drift] 迁移后数据库已就绪，交给 prisma migrate diff`);

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
    console.log('  ✓ 结论：手写迁移与 schema.prisma **零漂移**');
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
