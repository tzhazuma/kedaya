/**
 * 静态冒烟检查（无 node_modules 也可运行）：
 * 1. 收集营养管家 / canteen 相关新增文件里的相对导入
 * 2. 解析到目标文件，检查被导入的命名符号是否在目标文件里导出
 * 3. 报告缺失的导出 / 缺失的文件
 *
 * 用法：node scripts/check-nutrition-imports.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** 本次新增/改动的目录（相对 ROOT） */
const SCAN_DIRS = [
  'apps/miniapp/src/app',
  'apps/miniapp/src/domain/models',
  'apps/miniapp/src/domain/ports',
  'apps/miniapp/src/data/mock',
  'apps/miniapp/src/data/repositories',
  'apps/miniapp/src/application/nutrition',
  'apps/miniapp/src/presentation/components/KdyProgress',
  'apps/miniapp/src/presentation/pages/nutrition',
  'apps/miniapp/src/presentation/pages/home',
  'apps/web/src/domain/models',
  'apps/web/src/domain/ports',
  'apps/web/src/data/schemas',
  'apps/web/src/data/mock',
  'apps/web/src/data/repositories',
  'apps/web/src/presentation/components/admin',
  'apps/web/src/app',
  'services/api/src/modules/canteen',
  'packages/shared/src',
]

const EXTS = ['.ts', '.tsx']

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...walk(full))
    } else if (EXTS.some((ext) => entry.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function resolveImport(spec, fromFile) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const ext of ['', ...EXTS]) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  for (const ext of EXTS) {
    const candidate = join(base, 'index' + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** 从文件内容里粗提取导出符号 */
function exportedNames(file) {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  const patterns = [
    // export [async|abstract|declare] [default] const|function|class|interface|type|enum NAME
    /export\s+(?:(?:async|abstract|declare|default)\s+)*(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    // export [type] { ... } [from '...']
    /export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(src)) !== null) {
      if (m[1].includes(',')) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim()
          if (name) names.add(name)
        }
      } else if (m[1]) {
        names.add(m[1].trim())
      }
    }
  }
  // export * from './x' → 递归并入
  const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g
  let sm
  while ((sm = starRe.exec(src)) !== null) {
    const target = resolveImport(sm[1], file)
    if (target) for (const n of exportedNames(target)) names.add(n)
  }
  return names
}

let problems = 0
let checked = 0
let unused = 0

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8')
    const importRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
    let m
    while ((m = importRe.exec(src)) !== null) {
      const [, , clause, spec] = m
      if (!spec.startsWith('.')) continue
      const target = resolveImport(spec, file)
      if (target === null) {
        console.log(`✗ ${rel(file)}: 找不到模块 '${spec}'`)
        problems += 1
        continue
      }
      const available = exportedNames(target)
      for (const raw of clause.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
        if (name === '') continue
        checked += 1
        if (!available.has(name)) {
          console.log(`✗ ${rel(file)}: '${name}' 未从 '${spec}' 导出（目标 ${rel(target)}）`)
          problems += 1
          continue
        }
        // 未使用检测：导入名在文件里应出现 ≥2 次（导入处 + 使用处）
        const usageCount = src.split(new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g')).length - 1
        if (usageCount < 2) {
          console.log(`✗ ${rel(file)}: '${name}' 导入后未使用`)
          unused += 1
        }
      }
    }
  }
}

function rel(p) {
  return p.slice(ROOT.length + 1).replaceAll('\\', '/')
}

console.log(`\n检查了 ${checked} 个命名导入：${problems} 个解析/导出问题，${unused} 个未使用导入`)
process.exit(problems + unused > 0 ? 1 : 0)
