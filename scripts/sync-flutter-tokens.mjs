#!/usr/bin/env node
/**
 * 把设计令牌同步到 Flutter 端。
 *
 * 为什么需要这一步：
 *   Flutter 包无法 import 包根目录之外的 Dart 文件，而 `apps/mobile/` 与
 *   `packages/design-tokens/dart/` 是两个独立的包边界。因此 Flutter 端必须持有
 *   一份 `kedaya_tokens.dart` 的**副本**。
 *
 * 副本会漂移 —— 所以这个脚本把它变成"生成物"而不是"手抄件"：
 *   `npm run tokens` = generate.mjs（生成 5 份产物）+ 本脚本（同步 Flutter 副本）
 *   任何一端都不可能再单独过期。
 *
 * 若未来给 `packages/design-tokens/dart/` 加 pubspec.yaml 走 path 依赖，
 * 本脚本即可删除（届时请同步更新 docs/architecture/04-client-architecture.md）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const SRC = join(repoRoot, 'packages/design-tokens/dart/kedaya_tokens.dart');
const DEST = join(repoRoot, 'apps/mobile/lib/presentation/theme/kedaya_tokens.dart');

const BANNER = `// ⚠️ 这是生成物的副本 —— 请勿手改。
//
// 真相来源：packages/design-tokens/tokens.json
// 由 \`npm run tokens\` 生成并同步（scripts/sync-flutter-tokens.mjs）。
//
// 为什么 Flutter 端要留一份副本：Flutter 无法 import 包边界之外的 Dart 文件。
// 改了令牌请回到仓库根目录跑 \`npm run tokens\`，不要直接编辑本文件。
//
// ---------------------------------------------------------------

`;

if (!existsSync(SRC)) {
  console.error(`[sync-flutter-tokens] 找不到源文件：${relative(repoRoot, SRC)}`);
  console.error('  请先运行：node packages/design-tokens/scripts/generate.mjs');
  process.exit(1);
}

const source = readFileSync(SRC, 'utf8');
const output = BANNER + source;

mkdirSync(dirname(DEST), { recursive: true });

let previous = null;
if (existsSync(DEST)) previous = readFileSync(DEST, 'utf8');

if (previous === output) {
  console.log(`  = ${relative(repoRoot, DEST)}  (已是最新)`);
} else {
  writeFileSync(DEST, output, 'utf8');
  console.log(`  ✓ ${relative(repoRoot, DEST)}  (${output.split('\n').length} 行, 已同步)`);
}
