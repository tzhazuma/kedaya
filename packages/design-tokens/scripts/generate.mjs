#!/usr/bin/env node
/**
 * 可达鸭设计令牌生成器
 *
 *   tokens.json  ──┬──> src/tokens.generated.ts    (TypeScript / Web / 小程序)
 *                  ├──> dist/tokens.css            (CSS 变量 + 暗色覆盖)
 *                  ├──> dist/tokens.scss           (SCSS 变量 / Taro 小程序)
 *                  ├──> dist/tokens.js             (运行时 ESM)
 *                  └──> dart/kedaya_tokens.dart    (Flutter)
 *
 * 命名规则（冻结）:  --kdy-<group>-<kebab-key>
 * 例: color.brandStrong -> --kdy-color-brand-strong
 *     space.4            -> --kdy-space-4
 *
 * 暗色模式（契约 §6.2 补丁 C3）:
 *   `colorDark` 是 `color` 的**覆盖组** —— 它复用同一批 CSS 变量名，
 *   在 `[data-theme="dark"]` 下重新赋值。因此**消费方代码零改动**：
 *   仍然写 `var(--kdy-color-surface)`，切主题由 `data-theme` 属性驱动。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const raw = readFileSync(join(pkgRoot, 'tokens.json'), 'utf8');
const tokens = JSON.parse(raw);
delete tokens.$comment;

/** 覆盖组 -> 被覆盖的基础组。这些组不进入 :root，而是生成主题覆盖块。 */
const THEME_OVERRIDES = { colorDark: 'color' };
const OVERRIDE_GROUPS = new Set(Object.keys(THEME_OVERRIDES));
/** 参与常规输出的组 */
const PLAIN_GROUPS = Object.keys(tokens).filter((g) => !OVERRIDE_GROUPS.has(g));

/** camelCase / 其它 -> kebab-case */
const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
/** camelCase -> PascalCase */
const pascal = (s) => String(s).replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
/** 清理为合法标识符片段 */
const ident = (s) => String(s).replace(/[^A-Za-z0-9]/g, '_');

const isNumericGroup = (g) => typeof Object.values(g)[0] === 'number';

/* ================================================================== *
 * 1. CSS 变量（含暗色覆盖）
 * ================================================================== */
const cssLines = [
  '/* 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。',
  ' * 真相来源: packages/design-tokens/tokens.json */',
  '',
  ':root {',
];
for (const group of PLAIN_GROUPS) {
  const g = tokens[group];
  const numeric = isNumericGroup(g);
  cssLines.push(`  /* ${group} */`);
  for (const [key, value] of Object.entries(g)) {
    cssLines.push(`  --kdy-${kebab(group)}-${kebab(key)}: ${numeric ? `${value}px` : value};`);
  }
}
cssLines.push('}', '');

for (const [overrideGroup, baseGroup] of Object.entries(THEME_OVERRIDES)) {
  const g = tokens[overrideGroup];
  if (!g) continue;
  const themeName = kebab(overrideGroup).replace(new RegExp(`^${kebab(baseGroup)}-?`), '') || 'dark';
  cssLines.push(`/* ${overrideGroup} —— 覆盖 ${baseGroup} 的同名变量，消费方无需改动 */`);
  cssLines.push(`[data-theme="${themeName}"] {`);
  for (const [key, value] of Object.entries(g)) {
    cssLines.push(`  --kdy-${kebab(baseGroup)}-${kebab(key)}: ${value};`);
  }
  cssLines.push('}', '');
  cssLines.push('@media (prefers-color-scheme: dark) {');
  cssLines.push('  :root:not([data-theme="light"]) {');
  for (const [key, value] of Object.entries(g)) {
    cssLines.push(`    --kdy-${kebab(baseGroup)}-${kebab(key)}: ${value};`);
  }
  cssLines.push('  }');
  cssLines.push('}', '');
}
const css = cssLines.join('\n');

/* ================================================================== *
 * 2. SCSS 变量（Taro 小程序）
 * ================================================================== */
const scssLines = [
  '// 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。',
  '// 真相来源: packages/design-tokens/tokens.json',
  '',
];
for (const group of PLAIN_GROUPS) {
  const g = tokens[group];
  const numeric = isNumericGroup(g);
  scssLines.push(`// ${group}`);
  for (const [key, value] of Object.entries(g)) {
    scssLines.push(`$kdy-${kebab(group)}-${kebab(key)}: ${numeric ? `${value}px` : value};`);
  }
  scssLines.push('');
}
scssLines.push('// 便捷 map，便于 SCSS 侧遍历');
scssLines.push('$kdy-tokens: (');
for (const group of PLAIN_GROUPS) {
  scssLines.push(`  "${kebab(group)}": (`);
  for (const [key, value] of Object.entries(tokens[group])) {
    scssLines.push(`    "${kebab(key)}": ${typeof value === 'number' ? `${value}px` : value},`);
  }
  scssLines.push('  ),');
}
scssLines.push(');', '');

for (const [overrideGroup, baseGroup] of Object.entries(THEME_OVERRIDES)) {
  const g = tokens[overrideGroup];
  if (!g) continue;
  scssLines.push(`// ${overrideGroup} —— ${baseGroup} 的暗色覆盖值`);
  scssLines.push(`$kdy-${kebab(baseGroup)}-dark: (`);
  for (const [key, value] of Object.entries(g)) {
    scssLines.push(`  "${kebab(key)}": ${value},`);
  }
  scssLines.push(');', '');
  scssLines.push(`// 小程序切换暗色时用这张表覆盖（小程序无 CSS 变量级联，需按类切换）`);
  scssLines.push(`@mixin kdy-theme-dark {`);
  for (const [key, value] of Object.entries(g)) {
    scssLines.push(`  .kdy-color-${kebab(key)} { color: ${value}; }`);
  }
  scssLines.push('}', '');
}
const scss = scssLines.join('\n');

/* ================================================================== *
 * 3. TypeScript
 * ================================================================== */
const ts = `/* 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。
 * 真相来源: packages/design-tokens/tokens.json */

export const tokens = ${JSON.stringify(tokens, null, 2)} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof Tokens['color'];
export type SpaceToken = keyof Tokens['space'];
export type RadiusToken = keyof Tokens['radius'];
export type FontSizeToken = keyof Tokens['fontSize'];

/** 主题名（CSS: [data-theme="<name>"]） */
export type ThemeName = 'light' | 'dark';

/** CSS 变量名，例: cssVar('color', 'brandStrong') -> 'var(--kdy-color-brand-strong)' */
export function cssVar(group: keyof Tokens, key: string): string {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return \`var(--kdy-\${kebab(String(group))}-\${kebab(key)})\`;
}

/** 取像素值，例: px('space', '4') -> '16px' */
export function px(group: keyof Tokens, key: string): string {
  const value = (tokens[group] as Record<string, unknown>)[key];
  return typeof value === 'number' ? \`\${value}px\` : String(value);
}

/**
 * 暗色主题的原始色值（不用于直接内联样式）。
 *
 * 在 Web 上**不要**用这个函数手动换色 —— 直接依赖 \`[data-theme="dark"]\`
 * 对 CSS 变量的覆盖即可，消费方代码零改动。
 * 它只用于需要 JS 拿到具体色值的场景（如 Canvas 绘制、图表库配置）。
 */
export function darkColor(key: ColorToken): string {
  return (tokens.colorDark as Record<string, string>)[key] ?? tokens.color[key];
}
`;

/* ================================================================== *
 * 4. 运行时 ESM
 * ================================================================== */
const esm = `/* 生成文件 —— 请勿手改。真相来源: tokens.json */
export const tokens = ${JSON.stringify(tokens, null, 2)};
export default tokens;
`;

/* ================================================================== *
 * 5. Dart (Flutter)
 * ================================================================== */
const hexToArgb = (hex) => {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `0xFF${full.toUpperCase()}`;
};

const dartLines = [
  '// 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。',
  '// 真相来源: packages/design-tokens/tokens.json',
  '',
  "import 'package:flutter/widgets.dart';",
  '',
  '/// 可达鸭设计令牌（Flutter）。',
  '///',
  '/// 所有颜色/间距/圆角/字号必须从这里取，禁止在 widget 里硬编码。',
  '///',
  '/// 暗色模式：用 [KedaYaTokens.darkColors] 覆盖 [colorXxx] 常量。',
  'abstract final class KedaYaTokens {',
  '  const KedaYaTokens._();',
  '',
  '  // ---------------- 亮色（默认） ----------------',
];

for (const [key, value] of Object.entries(tokens.color)) {
  dartLines.push(`  static const Color color${pascal(key)} = Color(${hexToArgb(value)});`);
}
dartLines.push('');

if (tokens.colorDark) {
  dartLines.push('  // ---------------- 暗色 ----------------');
  for (const [key, value] of Object.entries(tokens.colorDark)) {
    dartLines.push(`  static const Color colorDark${pascal(key)} = Color(${hexToArgb(value)});`);
  }
  dartLines.push('');
  dartLines.push('  /// 暗色覆盖表：key 为亮色常量名后缀，value 为暗色值。');
  dartLines.push('  /// 例: darkColors[\'brand\'] == colorDarkBrand');
  dartLines.push('  static const Map<String, Color> darkColors = <String, Color>{');
  for (const [key, value] of Object.entries(tokens.colorDark)) {
    dartLines.push(`    '${key}': Color(${hexToArgb(value)}),`);
  }
  dartLines.push('  };');
  dartLines.push('');
  dartLines.push('  /// 按亮/暗取色。');
  dartLines.push('  static Color resolveColor(String key, {required bool isDark}) {');
  dartLines.push('    if (isDark) {');
  dartLines.push('      final dark = darkColors[key];');
  dartLines.push('      if (dark != null) return dark;');
  dartLines.push('    }');
  dartLines.push('    return _lightColors[key] ?? colorInk;');
  dartLines.push('  }');
  dartLines.push('');
  dartLines.push('  static const Map<String, Color> _lightColors = <String, Color>{');
  for (const [key, value] of Object.entries(tokens.color)) {
    dartLines.push(`    '${key}': Color(${hexToArgb(value)}),`);
  }
  dartLines.push('  };');
  dartLines.push('');
}

for (const group of ['space', 'radius', 'fontSize']) {
  dartLines.push(`  // ${group}`);
  for (const [key, value] of Object.entries(tokens[group])) {
    dartLines.push(`  static const double ${ident(group)}${pascal(key)} = ${Number(value)};`);
  }
  dartLines.push('');
}

dartLines.push('  // lineHeight (无单位倍数)');
for (const [key, value] of Object.entries(tokens.lineHeight)) {
  dartLines.push(`  static const double lineHeight${pascal(key)} = ${Number(value)};`);
}
dartLines.push('');

dartLines.push('  // fontWeight');
const weightMap = { 400: 'w400', 500: 'w500', 600: 'w600', 700: 'w700', 800: 'w800', 900: 'w900' };
for (const [key, value] of Object.entries(tokens.fontWeight)) {
  dartLines.push(
    `  static const FontWeight fontWeight${pascal(key)} = FontWeight.${weightMap[value] ?? 'w400'};`,
  );
}
dartLines.push('');

dartLines.push('  // shadow');
for (const [key, value] of Object.entries(tokens.shadow)) {
  dartLines.push(`  static const String shadow${pascal(key)} = '${String(value).replace(/'/g, "\\'")}';`);
}
dartLines.push('');

dartLines.push('  // fontFamily');
for (const [key, value] of Object.entries(tokens.fontFamily)) {
  dartLines.push(`  static const String fontFamily${pascal(key)} = '${value.split(',')[0].trim()}';`);
}
dartLines.push('');

dartLines.push('  // zIndex');
for (const [key, value] of Object.entries(tokens.zIndex)) {
  dartLines.push(`  static const int zIndex${pascal(key)} = ${Number(value)};`);
}
dartLines.push('}');
dartLines.push('');

const dart = dartLines.join('\n');

/* ================================================================== *
 * 写出
 * ================================================================== */
const outputs = [
  ['src/tokens.generated.ts', ts],
  ['dist/tokens.css', css],
  ['dist/tokens.scss', scss],
  ['dist/tokens.js', esm],
  ['dart/kedaya_tokens.dart', dart],
];

for (const [rel, content] of outputs) {
  const abs = join(pkgRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ ${rel}  (${content.split('\n').length} 行, ${content.length} 字节)`);
}

const tokenCount = Object.keys(tokens).reduce((n, g) => n + Object.keys(tokens[g]).length, 0);
const darkCount = tokens.colorDark ? Object.keys(tokens.colorDark).length : 0;
console.log(
  `\n可达鸭设计令牌已生成: ${Object.keys(tokens).length} 组 / ${tokenCount} 个令牌` +
    (darkCount ? `（含暗色覆盖 ${darkCount} 个）` : ''),
);
