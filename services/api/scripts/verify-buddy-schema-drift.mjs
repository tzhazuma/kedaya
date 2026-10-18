#!/usr/bin/env node
/**
 * ⚠️ 已由 `verify-schema-drift.mjs` 取代，这里只是一个**兼容入口**。
 *
 * ## 为什么
 *
 * 本脚本原先把迁移目录名**硬编码**为三份（init / wildlife / buddy），
 * 却断言"迁移累计效果 == `prisma/schema.prisma`"。这在它写下的那一刻就不成立
 * （techpie、校园卡与合并对齐都不在那三份里），于是它的结论永远是"有漂移"，
 * 而"永远失败的检查"等价于没有检查 —— 更糟的是，它会让人以为漂移只发生在 buddy。
 *
 * `verify-schema-drift.mjs` 改为**自动发现** `prisma/migrations/<数字开头>/`，
 * 且与运行时测试夹具（`test/fixtures/pglite-prisma.ts`）用同一套发现规则，
 * 因此新增迁移时不会再出现"忘了同步脚本"的静默失效。
 *
 * 用法（在仓库根目录）：node services/api/scripts/verify-buddy-schema-drift.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

console.log('[deprecated] verify-buddy-schema-drift → verify-schema-drift（全量迁移）');

const child = spawn(process.execPath, [join(HERE, 'verify-schema-drift.mjs')], {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (status) => {
  process.exitCode = status ?? 1;
});
