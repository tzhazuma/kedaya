#!/usr/bin/env node
/**
 * 可达鸭 · Dart 镜像生成器
 *
 * 为什么需要它：Flutter 端有两份「生成物」必须与唯一真相逐字一致 ——
 *   1. 设计令牌：`packages/design-tokens/tokens.json` → `kedaya_tokens.dart`
 *   2. 搭子标签 / 校园地点：`packages/contracts/src/buddy-tags.ts` → `buddy_tags.g.dart`
 *
 * Dart 不能 import 包边界之外的 TS/JSON，所以只能生成镜像。手抄必然漂移
 * （这正是 `buddy-tags.ts` 文件头记录的「Web 46 vs 服务端 62」缺陷）。
 *
 * 用法：
 *   node scripts/sync-flutter-mirrors.mjs          # 写盘
 *   node scripts/sync-flutter-mirrors.mjs --check  # 只校验，过期 exit 1（CI）
 *
 * 生成文件头会写入源文件的 **git blob hash**：源改动后即使内容恰好相同，
 * 也能从头部看出「生成时基于哪个版本的源」。
 */
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const checkOnly = process.argv.includes('--check');

const TOKENS_SRC = 'packages/design-tokens/tokens.json';
const BUDDY_SRC = 'packages/contracts/src/buddy-tags.ts';

const TOKENS_OUT = 'apps/mobile/lib/presentation/theme/kedaya_tokens.dart';
const BUDDY_OUT = 'apps/mobile/lib/domain/models/buddy_tags.g.dart';

const SCRIPT = 'scripts/sync-flutter-mirrors.mjs';

/** 源文件的 git blob hash（`git hash-object` 与仓库历史里的 blob 是同一个算法）。 */
function blobHash(relPath) {
  return execFileSync('git', ['hash-object', relPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function header(source, hash, extra = '') {
  return `// DO NOT EDIT —— 由 ${SCRIPT} 从 ${source} 生成。
// source: ${source}
// source-blob-sha1: ${hash}
${extra}// 重新生成: node ${SCRIPT}
// 校验:     node ${SCRIPT} --check
//
// 手改本文件会在 CI 的 --check 步骤失败；请改源文件后重新生成。
//
// ---------------------------------------------------------------
`;
}

const dartString = (value) =>
  `'${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('$', '\\$')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')}'`;

const pascal = (key) => key.charAt(0).toUpperCase() + key.slice(1);

const hexToDart = (hex) => {
  const value = String(hex).replace('#', '').toUpperCase();
  const argb = value.length === 6 ? `FF${value}` : value;
  return `Color(0x${argb})`;
};

/* ================================================================== *
 * 1. 设计令牌
 * ================================================================== */
function generateTokens() {
  const rel = TOKENS_SRC;
  const raw = readFileSync(join(repoRoot, rel), 'utf8');
  const tokens = JSON.parse(raw);
  delete tokens.$comment;

  const known = new Set([
    'color',
    'colorDark',
    'space',
    'radius',
    'fontSize',
    'lineHeight',
    'fontWeight',
    'shadow',
    'fontFamily',
    'zIndex',
  ]);
  for (const group of Object.keys(tokens)) {
    if (!known.has(group)) {
      throw new Error(`未知令牌组 "${group}"：请先扩展 ${SCRIPT} 的命名规则`);
    }
  }
  for (const required of ['color', 'colorDark', 'space', 'radius', 'fontSize']) {
    if (!tokens[required]) throw new Error(`tokens.json 缺少必需组 "${required}"`);
  }

  const lines = [
    header(
      rel,
      blobHash(rel),
      `// 生成物覆盖: ${Object.keys(tokens).length} 组 / ` +
        Object.values(tokens).reduce((n, g) => n + Object.keys(g).length, 0) +
        ' 个令牌\n',
    ),
    "import 'package:flutter/widgets.dart';",
    '',
    '/// 可达鸭设计令牌（Flutter）。',
    '///',
    '/// 所有颜色 / 间距 / 圆角 / 字号必须从这里取，**禁止在 widget 里硬编码**。',
    '/// 暗色模式：用 [KedaYaTokens.darkColors] 覆盖 `colorXxx` 常量。',
    'abstract final class KedaYaTokens {',
    '  const KedaYaTokens._();',
    '',
  ];

  lines.push('  // ---------------- 亮色（默认） ----------------');
  for (const [key, value] of Object.entries(tokens.color)) {
    lines.push(`  static const Color color${pascal(key)} = ${hexToDart(value)};`);
  }
  lines.push('');

  lines.push('  // ---------------- 暗色 ----------------');
  for (const [key, value] of Object.entries(tokens.colorDark)) {
    lines.push(`  static const Color colorDark${pascal(key)} = ${hexToDart(value)};`);
  }
  lines.push('');

  lines.push('  /// 暗色覆盖表：key 为亮色常量名后缀，value 为暗色值。');
  lines.push('  static const Map<String, Color> darkColors = <String, Color>{');
  for (const [key, value] of Object.entries(tokens.colorDark)) {
    lines.push(`    ${dartString(key)}: ${hexToDart(value)},`);
  }
  lines.push('  };', '');

  lines.push('  /// 按亮/暗取色。');
  lines.push('  static Color resolveColor(String key, {required bool isDark}) {');
  lines.push('    if (isDark) {');
  lines.push('      final Color? dark = darkColors[key];');
  lines.push('      if (dark != null) return dark;');
  lines.push('    }');
  lines.push('    return _lightColors[key] ?? colorInk;');
  lines.push('  }', '');

  lines.push('  static const Map<String, Color> _lightColors = <String, Color>{');
  for (const [key, value] of Object.entries(tokens.color)) {
    lines.push(`    ${dartString(key)}: ${hexToDart(value)},`);
  }
  lines.push('  };', '');

  const numericGroups = [
    ['space', 'double', (v) => `${v}`],
    ['radius', 'double', (v) => `${v}`],
    ['fontSize', 'double', (v) => `${v}`],
    ['lineHeight', 'double', (v) => `${v}`],
  ];
  for (const [group, type, format] of numericGroups) {
    lines.push(`  // ${group}`);
    for (const [key, value] of Object.entries(tokens[group])) {
      lines.push(`  static const ${type} ${group}${pascal(key)} = ${format(value)};`);
    }
    lines.push('');
  }

  lines.push('  // fontWeight');
  for (const [key, value] of Object.entries(tokens.fontWeight)) {
    lines.push(`  static const FontWeight fontWeight${pascal(key)} = FontWeight.w${value};`);
  }
  lines.push('');

  lines.push('  // shadow');
  for (const [key, value] of Object.entries(tokens.shadow)) {
    lines.push(`  static const String shadow${pascal(key)} = ${dartString(value)};`);
  }
  lines.push('');

  lines.push('  // fontFamily（取首个 family；完整字体栈由平台回退）');
  for (const [key, value] of Object.entries(tokens.fontFamily)) {
    lines.push(`  static const String fontFamily${pascal(key)} = ${dartString(value.split(',')[0].trim())};`);
  }
  lines.push('');

  lines.push('  // zIndex');
  for (const [key, value] of Object.entries(tokens.zIndex)) {
    lines.push(`  static const int zIndex${pascal(key)} = ${value};`);
  }
  lines.push('}', '');

  return lines.join('\n');
}

/* ================================================================== *
 * 2. 搭子标签 / 校园地点
 * ================================================================== */
function sliceArray(source, exportName) {
  const marker = `export const ${exportName}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${exportName}`);
  const equals = source.indexOf('=', start);
  const open = source.indexOf('[', equals);
  if (equals < 0 || open < 0) throw new Error(`${exportName} 不是数组初始化`);
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      quote = ch;
    } else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${exportName} 数组没有闭合`);
}

function parseObjectLiterals(body) {
  const objects = [];
  let depth = 0;
  let inString = false;
  let quote = '';
  let start = -1;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      quote = ch;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(body.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return objects;
}

function parseStringList(value) {
  if (!value) return [];
  return [...value.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

function parseBuddyTags(rel) {
  const source = readFileSync(join(repoRoot, rel), 'utf8');
  const tagObjects = parseObjectLiterals(sliceArray(source, 'BUDDY_TAGS'));
  const tags = tagObjects.map((text) => {
    const get = (re) => text.match(re)?.[1];
    const key = get(/\bkey:\s*'([^']+)'/);
    const label = get(/\blabel:\s*'([^']+)'/);
    const group = get(/\bgroup:\s*'([^']+)'/);
    if (!key || !label || !group) {
      throw new Error(`无法解析标签: ${text.slice(0, 80)}`);
    }
    const aliases = parseStringList(get(/\baliases:\s*\[([^\]]*)\]/));
    const isActive = !/\bisActive:\s*false/.test(text);
    return { key, label, group, aliases, isActive };
  });

  const locationObjects = parseObjectLiterals(
    sliceArray(source, 'CAMPUS_LOCATION_DEFS'),
  );
  const locations = locationObjects.map((text) => {
    const key = text.match(/\bkey:\s*'([^']+)'/)?.[1];
    const label = text.match(/\blabel:\s*'([^']+)'/)?.[1];
    if (!key || !label) throw new Error(`无法解析校园地点: ${text.slice(0, 80)}`);
    return { key, label };
  });

  const limit = (name) => {
    const match = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`));
    if (!match) throw new Error(`找不到限额 ${name}`);
    return Number(match[1]);
  };

  const limits = {
    buddyInterestTagMaxCount: limit('MAX_INTEREST_TAGS'),
    buddyActivityTagMaxCount: limit('MAX_ACTIVITY_TAGS'),
    buddyPostTagMaxCount: limit('MAX_POST_TAGS'),
    buddyPreferredAreaMaxCount: limit('MAX_PREFERRED_AREAS'),
  };

  return { tags, locations, limits };
}

function generateBuddyTags() {
  const rel = BUDDY_SRC;
  const { tags, locations, limits } = parseBuddyTags(rel);

  // 文件头的两个数字是契约里写死的验收值。数量变了必须显式改这里，
  // 防止「源被截断/解析漏项」这类静默事故。
  if (tags.length !== 62) throw new Error(`BUDDY_TAGS 应为 62 条，实际 ${tags.length}`);
  if (locations.length !== 25) {
    throw new Error(`CAMPUS_LOCATION_DEFS 应为 25 条，实际 ${locations.length}`);
  }

  const lines = [
    header(
      rel,
      blobHash(rel),
      `// 生成物覆盖: BUDDY_TAGS ${tags.length} 条 / CAMPUS_LOCATION_DEFS ${locations.length} 条\n`,
    ),
    "import 'buddy_tag.dart';",
    '',
    '/// 封闭标签表 —— **唯一真相**是 `packages/contracts/src/buddy-tags.ts`。',
    'const List<BuddyTag> buddyTagCatalog = <BuddyTag>[',
  ];

  for (const tag of tags) {
    const parts = [
      `key: ${dartString(tag.key)}`,
      `label: ${dartString(tag.label)}`,
      `group: BuddyTagGroup.${tag.group}`,
    ];
    if (tag.aliases.length > 0) {
      parts.push(`aliases: <String>[${tag.aliases.map(dartString).join(', ')}]`);
    }
    if (!tag.isActive) parts.push('isActive: false');
    lines.push(`  BuddyTag(${parts.join(', ')}),`);
  }
  lines.push('];', '');

  lines.push('/// 校园地点（`label` 是提交给服务端的 wire value，`key` 只用于埋点/i18n）。');
  lines.push('const List<CampusLocationDef> buddyCampusLocationDefs = <CampusLocationDef>[');
  for (const location of locations) {
    lines.push(
      `  CampusLocationDef(key: ${dartString(location.key)}, label: ${dartString(location.label)}),`,
    );
  }
  lines.push('];', '');

  lines.push('/// 地点白名单（**上线值**，即中文名）。服务端校验的就是这些字符串。');
  lines.push('const List<String> buddyCampusLocations = <String>[');
  for (const location of locations) {
    lines.push(`  ${dartString(location.label)},`);
  }
  lines.push('];', '');

  lines.push('// ---------------------------------------------------------- 数量上限（契约 §3.2）');
  for (const [name, value] of Object.entries(limits)) {
    lines.push(`const int ${name} = ${value};`);
  }
  lines.push('');

  return lines.join('\n');
}

/* ================================================================== *
 * 写出 / 校验
 * ================================================================== */
/**
 * 用 Dart 官方 formatter 规范化生成物。
 *
 * 生成器输出的换行不可能永远与 `dart format` 一致；如果不在生成阶段格式化，
 * `dart format --set-exit-if-changed` 与生成器的 `--check` 会互相打架。
 * 没有 dart 的环境（例如只跑 Node 的 CI）退回原文，`--check` 仍能发现内容漂移。
 */
function resolveDart() {
  const candidates = [
    process.env.DART,
    process.env.HOME ? join(process.env.HOME, 'toolchains/flutter/bin/dart') : null,
    'dart',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // 继续试下一个
    }
  }
  return null;
}

function formatDart(content) {
  const dart = resolveDart();
  if (!dart) {
    throw new Error(
      '找不到 dart。生成物必须经 `dart format` 规范化（否则与 format 门禁冲突）；请把 Flutter 的 bin 加入 PATH，或设置 DART=/path/to/dart。',
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'kedaya-dart-mirror-'));
  const tmp = join(dir, 'mirror.dart');
  try {
    writeFileSync(tmp, content, 'utf8');
    execFileSync(dart, ['format', tmp], { stdio: 'ignore' });
    return readFileSync(tmp, 'utf8');
  } catch {
    return content;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const outputs = [
  [TOKENS_OUT, formatDart(generateTokens())],
  [BUDDY_OUT, formatDart(generateBuddyTags())],
];

let stale = 0;
for (const [rel, content] of outputs) {
  const abs = join(repoRoot, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === content) {
    console.log(`  ✓ ${rel}  已同步`);
    continue;
  }
  if (checkOnly) {
    stale += 1;
    console.error(`  ✗ ${rel}  已过期（与源不一致）`);
    continue;
  }
  writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ ${rel}  已生成（${content.length} 字节）`);
}

if (checkOnly && stale > 0) {
  console.error(
    `\n有 ${stale} 个 Dart 镜像已过期。请运行: node ${SCRIPT}  (不要手改生成物)`,
  );
  process.exit(1);
}

if (checkOnly) {
  console.log('\nDart 镜像与唯一真相一致。');
}
