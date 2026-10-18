#!/usr/bin/env node
/**
 * 从 `@kedaya/design-tokens` 的**真相来源** `tokens.json` 生成 SCSS 变量。
 *
 * 为什么需要这个脚本（而不是直接 @import 包里的 dist/tokens.scss）：
 * ------------------------------------------------------------------
 * `packages/design-tokens/dist/tokens.scss` 目前**不是合法 SCSS**，dart-sass 直接报语法错：
 *
 *     expected ":".
 *     155 │     "sans": PingFang SC, Hiragino Sans GB, Microsoft YaHei, ...,
 *         │                                          ^
 *
 * 原因：生成器把 `fontFamily` 的「逗号分隔字体列表」原样塞进了 `$kdy-tokens` 这个 map，
 * 顶层逗号在 map 里会被当作新的键值对分隔符 → 语法错误。
 * 同一份生成器还有第二类缺陷：`lineHeight` / `fontWeight` / `zIndex` 这些**无单位**的量
 * 被加上了 `px`（`1.5px` / `600px` / `1000px`）。
 *
 * 因此本端改为「从 tokens.json 重新派生一份类型正确的 SCSS」：
 * - 值仍然只有一个来源（tokens.json），**没有手写色值**（契约 §6.2 的核心要求）；
 * - 字体列表按 CSS 规则处理（具体字族加引号，通用字族不加）；
 * - lineHeight / fontWeight / zIndex 保持无单位。
 *
 * 该缺陷已上报给 Lead；一旦 `packages/design-tokens/scripts/generate.mjs` 修好，
 * `src/presentation/theme/tokens.scss` 可以换回一行 `@import` 包内产物，本脚本即可删除。
 *
 * 用法：npm run tokens:scss -w @kedaya/miniapp（dev/build 脚本会自动先跑它）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(here, '..', 'src', 'presentation', 'theme', 'tokens.generated.scss')

const tokensPath = require.resolve('@kedaya/design-tokens/tokens.json')
const tokens = require(tokensPath)

/** camelCase / PascalCase → kebab-case */
function kebab(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/**
 * 分组里可以写 `$comment` 之类的说明键（JSON 没有注释）。
 * 生成 SCSS 时必须跳过它们，否则会产出 `$kdy-color-campus-$comment: ...`。
 */
function entries(group) {
  return Object.entries(group).filter(([name]) => !name.startsWith('$'))
}

const px = (value) => `${value}px`
const bare = (value) => String(value)
const raw = (value) => String(value)

/** CSS 通用字族：不加引号；其余具体字族加引号，避免被当成一个字族名 */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

function fontFamilyList(value) {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (GENERIC_FAMILIES.has(part.toLowerCase()) ? part : `"${part}"`))
    .join(', ')
}

/** 需要 `px` 后缀的组（长度类） */
const GROUPS = [
  { key: 'color', scss: 'color', format: raw, variables: true },
  // 校园贴纸簿（主视觉）：白底 + 墨蓝黑 + 鸭黄 + 淡粉/淡绿。
  { key: 'colorCampus', scss: 'color-campus', format: raw, variables: true },
  // 夜间玻璃（深色主题）：只生成变量、不进 $kdy-tokens map —— 主题映射表在
  // src/presentation/theme/tokens.scss，页面不该到处写 $kdy-color-night-*。
  { key: 'colorNight', scss: 'color-night', format: raw, variables: true },
  { key: 'space', scss: 'space', format: px, variables: true },
  { key: 'radius', scss: 'radius', format: px, variables: true },
  { key: 'fontSize', scss: 'font-size', format: px, variables: true },
  { key: 'lineHeight', scss: 'line-height', format: bare, variables: true },
  { key: 'fontWeight', scss: 'font-weight', format: bare, variables: true },
  { key: 'shadow', scss: 'shadow', format: raw, variables: true },
  { key: 'fontFamily', scss: 'font-family', format: fontFamilyList, variables: true },
  { key: 'zIndex', scss: 'z-index', format: bare, variables: true },
  // 暗色覆盖：与上游一致，只作为 map 暴露，不生成单变量
  { key: 'colorDark', scss: 'color-dark', format: raw, variables: false },
]

const lines = []
lines.push('// 由 apps/miniapp/scripts/generate-tokens-scss.mjs 生成 —— 请勿手改。')
lines.push('// 真相来源: packages/design-tokens/tokens.json（契约 §6.2 唯一真相）')
lines.push('//')
lines.push('// 生成原因见脚本头注释：上游 dist/tokens.scss 目前不是合法 SCSS。')
lines.push('')

for (const group of GROUPS) {
  const values = tokens[group.key]
  if (values === undefined || values === null || typeof values !== 'object') {
    throw new Error(`tokens.json 缺少分组 "${group.key}"`)
  }

  lines.push(`// ${group.key}`)
  if (group.variables) {
    for (const [name, value] of entries(values)) {
      lines.push(`$kdy-${group.scss}-${kebab(name)}: ${group.format(value)};`)
    }
  }
  lines.push('')
}

/* ---- $kdy-tokens：便捷 map（字体列表必须用括号包住，否则顶层逗号会破坏 map 语法） ---- */
lines.push('// 便捷 map，便于 SCSS 侧遍历')
lines.push('$kdy-tokens: (')
for (const group of GROUPS) {
  if (group.key === 'colorDark' || group.key === 'colorNight') continue
  lines.push(`  "${group.scss}": (`)
  for (const [name, value] of entries(tokens[group.key])) {
    const formatted = group.format(value)
    const needsParens = group.key === 'fontFamily'
    lines.push(`    "${kebab(name)}": ${needsParens ? `(${formatted})` : formatted},`)
  }
  lines.push('  ),')
}
lines.push(');')
lines.push('')

/* ---- $kdy-color-dark ---- */
lines.push('// colorDark —— color 的暗色覆盖值')
lines.push('$kdy-color-dark: (')
for (const [name, value] of entries(tokens.colorDark)) {
  lines.push(`  "${kebab(name)}": ${value},`)
}
lines.push(');')
lines.push('')

/* ---- $kdy-color-night ---- */
lines.push('// colorNight —— 深色主题（夜间玻璃）的完整取值');
lines.push('$kdy-color-night: (')
for (const [name, value] of entries(tokens.colorNight)) {
  lines.push(`  "${kebab(name)}": ${value},`)
}
lines.push(');')
lines.push('')

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, lines.join('\n'), 'utf8')

console.log(
  `[tokens] 已从 ${tokensPath}\n[tokens] 生成 ${outFile}（${lines.length} 行）`,
)
