import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WXSS 兼容性回归防线。
 *
 * 背景（真实事故）：账号页共用样式里写过
 *
 *   `.kdy-auth__inline > :first-child { flex: 1; }`
 *
 * 微信 WXSS 编译器不接受「组合器 + 隐式通用选择器 + 伪类」这种写法，会直接抛
 * `error at token ':'`；因为这是**编译期**错误，整个 `common.wxss` 编译失败，
 * 开发者工具里所有页面一起白屏 —— 一个选择器就能拖垮整端预览。
 *
 * 同理 `@font-face` 的 src 不能指向网络地址（协议相对 `//` 或 http(s)）：
 * WXSS 拿不到它，真机还要在后台配置「下载合法域名」，否则图标全是空白方框。
 * 本端统一用 base64 内联字体（`src/presentation/theme/icon-font.scss`）。
 */

const SRC_DIR = path.resolve(import.meta.dirname, '..', '..', '..')

function walkScss(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...walkScss(full))
      continue
    }
    if (entry.name.endsWith('.scss')) found.push(full)
  }
  return found
}

function relative(file: string): string {
  return path.relative(path.resolve(SRC_DIR, '..'), file)
}

/**
 * 去掉注释后再匹配选择器：本仓库的注释里会**引用**反例写法
 * （例如 auth.scss 里就解释了 `> :first-child` 为什么不能用）。
 * 行号仍按去注释后的文本计算，偏差仅出现在注释之后的行，定位足够用。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 每个规则给出「命中位置」的上下文，方便直接定位。 */
function hits(files: string[], pattern: RegExp): string[] {
  const out: string[] = []
  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const index = match.index ?? 0
      const line = source.slice(0, index).split('\n').length
      const snippet = source.slice(index, index + 60).split('\n')[0]?.trim() ?? ''
      out.push(`${relative(file)}:${line}  ${snippet}`)
    }
  }
  return out
}

describe('WXSS 兼容性（选择器 / 字体）', () => {
  const files = walkScss(SRC_DIR)

  it('扫描到了样式文件（防止 walked 目录写错导致空扫描假绿）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('不出现「组合器 + 隐式通用选择器」（> :first-child / > *）', () => {
    // WXSS 编译不过：`> :first-child`、`> *`、`+ :last-child` 都算。
    expect(hits(files, /[>+~]\s+[:*]/g)).toEqual([])
  })

  it('不出现裸通用选择器 *', () => {
    expect(hits(files, /(^|[,{}])\s*\*\s*[,{]/gm)).toEqual([])
  })

  it('@font-face 不引用网络字体（必须 base64 内联）', () => {
    // 只看 src 里出现 url(http...) / url(//...) 的情况；base64 的 data: 不算。
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const block of source.matchAll(/@font-face\s*\{[^}]*\}/gs)) {
        if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(block[0])) {
          offenders.push(relative(file))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
