import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 静态扫描：小程序端**没有任何 cookie 注入代码**。
 *
 * ## 为什么必须有这个测试
 *
 * 契约 §11.10-F 裁决：微信小程序的 `web-view` 组件
 * **无法注入 cookie、无法自定义请求头**，因此契约不变式 **I3
 * （校园 cookie 的唯一出口供 WebView 注入）在小程序端没有出口**。
 *
 * 裁决同时明确：小程序端**禁止**尝试绕过此限制（伪造 header、劫持 cookie）。
 * 但「禁止」如果只写在文档里，就会在某个赶工的下午消失
 * （ADR 0004 §2.2：「一个只有文档保护的边界，在一次紧急修 bug 时就会消失」）。
 *
 * 因此这里用**静态扫描**把这条边界钉死：
 * 生产源码里一旦出现任何 cookie 注入 / 转发 / 窃取的写法，CI 立刻失败。
 *
 * ## 为什么扫描前要**去掉注释**
 *
 * 我们的注释里**大量**提到 `cookie` / `castgc` / `webview-session` ——
 * 那些正是在解释"为什么我们**不**这么做"。扫描的对象是**代码**，不是文档。
 * 因此先用一个尊重字符串字面量的状态机剥掉注释，再扫。
 *
 * ## 扫描范围
 *
 * `src/**` 下的生产源码，**排除** `__tests__/` 与 `*.test.ts(x)`：
 * 测试会**故意**构造带 `castgc` / `cookie` 的脏响应来验证"客户端拒绝它"，
 * 那是被测行为，不是违规。
 */

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 剥掉行注释与块注释（尊重 ' " ` 三种字符串字面量，避免 `https://` 被误判） */
export function stripComments(source: string): string {
  let out = ''
  let index = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'

  while (index < source.length) {
    const char = source[index] ?? ''
    const next = source[index + 1] ?? ''

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line'
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        state = 'block'
        index += 2
        continue
      }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      out += char
      index += 1
      continue
    }

    if (state === 'line') {
      if (char === '\n') {
        state = 'code'
        out += char
      }
      index += 1
      continue
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code'
        index += 2
        continue
      }
      if (char === '\n') out += char
      index += 1
      continue
    }

    // 字符串字面量：原样保留，处理转义
    out += char
    if (char === '\\') {
      out += next
      index += 2
      continue
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      state = 'code'
    }
    index += 1
  }

  return out
}

interface SourceFile {
  path: string
  relativePath: string
  code: string
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      listSourceFiles(full, acc)
      continue
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
    acc.push(full)
  }
  return acc
}

function loadProductionSources(): SourceFile[] {
  return listSourceFiles(SRC_ROOT).map((path) => ({
    path,
    relativePath: relative(SRC_ROOT, path),
    code: stripComments(readFileSync(path, 'utf8')),
  }))
}

const SOURCES = loadProductionSources()

function findMatches(needle: string, files: SourceFile[] = SOURCES): string[] {
  const hits: string[] = []
  for (const file of files) {
    const lines = file.code.split('\n')
    lines.forEach((line, index) => {
      if (line.includes(needle)) hits.push(`${file.relativePath}:${index + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('静态扫描 · 小程序端没有 cookie 注入（契约 §11.10-F）', () => {
  it('扫描器本身是可信的：能剥掉注释、能保留字符串', () => {
    const sample = [
      '// document.cookie 只出现在注释里',
      '/* setCookie(x) */',
      "const url = 'https://ecourse.shanghaitech.edu.cn/'",
      "const real = 'document.cookie'",
    ].join('\n')
    const stripped = stripComments(sample)
    expect(stripped).not.toContain('// document.cookie')
    expect(stripped).not.toContain('setCookie')
    // `https://` 里的 `//` **不能**被当成行注释（否则整个扫描会失真）
    expect(stripped).toContain('https://ecourse.shanghaitech.edu.cn/')
    // 字符串里的违规写法仍然能被抓到
    expect(stripped).toContain("'document.cookie'")
  })

  it('⚠️ 生产源码里没有 document.cookie / setCookie / Set-Cookie', () => {
    expect(findMatches('document.cookie')).toEqual([])
    expect(findMatches('setCookie')).toEqual([])
    expect(findMatches('Set-Cookie')).toEqual([])
    expect(findMatches('set-cookie')).toEqual([])
  })

  it('⚠️ 生产源码里没有 I3 的出口：cookieHeaderFor / webview-session', () => {
    expect(findMatches('cookieHeaderFor')).toEqual([])
    expect(findMatches('webview-session')).toEqual([])
  })

  it('⚠️ 生产源码里没有把 Cookie 当请求头写的代码', () => {
    expect(findMatches("'Cookie'")).toEqual([])
    expect(findMatches('"Cookie"')).toEqual([])
    expect(findMatches('withCredentials')).toEqual([])
    expect(findMatches("credentials: 'include'")).toEqual([])
  })

  /**
   * 扫描范围**限定在本模块**。
   *
   * 为什么不做全仓扫描：`groupbuy` 有一个语义完全不同的领域字段叫 `ticket`（"拼票"），
   * `faq` 有一个 `faqTicketListCache`（"工单"缓存）。它们与 WebView 票据毫无关系，
   * 把它们判为违规会让这条规则立刻变成噪声 —— 而噪声规则会被关掉。
   * 本测试的职责是钉住 **techpie / campus-card 这条链路**。
   */
  const TECHPIE_SCOPE = [
    'domain/models/credentials.ts',
    'domain/models/techpie.ts',
    'domain/models/campusCard.ts',
    'domain/ports/techpieRepository.ts',
    'domain/ports/logPort.ts',
    'application/techpie/',
    'data/repositories/httpTechpieRepository.ts',
    'data/repositories/mockTechpieRepository.ts',
    'data/mock/techpieFixtures.ts',
    'data/mock/techpieMemoryDatabase.ts',
    'data/storage/keys.ts',
    'platform/log.ts',
    'platform/wechatLogin.ts',
    'presentation/pages/techpie/',
    'presentation/pages/campus-card/',
    'presentation/components/KdyCampusCredentialNotice/',
    'app/container.ts',
    'app/routes.ts',
    'app/bootstrap.ts',
  ]

  function scoped(): SourceFile[] {
    return SOURCES.filter((file) =>
      TECHPIE_SCOPE.some((prefix) =>
        prefix.endsWith('/') ? file.relativePath.startsWith(prefix) : file.relativePath === prefix,
      ),
    )
  }

  it('扫描范围覆盖本模块的全部新增文件（防止范围写错导致扫描空转）', () => {
    const files = scoped()
    expect(files.length).toBeGreaterThanOrEqual(15)
    expect(files.some((file) => file.relativePath.endsWith('data/mock/techpieMemoryDatabase.ts'))).toBe(
      true,
    )
  })

  it('⚠️ 本模块生产代码里没有把禁用键当**属性名**写出来的地方（契约 I1）', () => {
    const forbiddenPropertyNames = [
      'cookie',
      'cookies',
      'castgc',
      'tgc',
      'sessionToken',
      'tenant',
      'password',
      'tokenCipher',
      'sessionCipher',
    ]
    const pattern = new RegExp(`(^|[{,;\\s])(${forbiddenPropertyNames.join('|')})\\s*:`, 'm')

    const hits: string[] = []
    for (const file of scoped()) {
      for (const [index, line] of file.code.split('\n').entries()) {
        if (pattern.test(line)) hits.push(`${file.relativePath}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('⚠️ 本地存储里只有**缓存**键，没有任何校园凭证键位', () => {
    const keysFile = SOURCES.find((file) => file.relativePath.endsWith('data/storage/keys.ts'))
    expect(keysFile).toBeDefined()
    const code = keysFile?.code ?? ''

    // 与 techpie / campus-card 相关的键必须**只有**这三个缓存键
    const techpieKeys = code.match(/techpie\w+|campusCard\w+/g) ?? []
    expect(techpieKeys.sort()).toEqual(
      ['campusCardTransactionCache', 'techpieBindingListCache', 'techpieCapabilityCache'].sort(),
    )
    // 这三个键名里不得出现任何凭证语义
    for (const key of techpieKeys) {
      expect(key).not.toMatch(/cookie|castgc|credential|password|secret|openid/i)
    }
    // 存储键清单里不得新增校园凭证类键位（大小写不敏感，排除 FAQ 的"工单"ticket）
    const campusCredentialKeys = (code.match(/\w*(?:cookie|castgc|credential|password)\w*/gi) ?? [])
    expect(campusCredentialKeys).toEqual([])
  })
})

describe('静态扫描 · 网络只走 data/api/request.ts（契约 §7 硬规则 3）', () => {
  it('⚠️ presentation 层没有任何直接发请求的写法', () => {
    const presentation = SOURCES.filter((file) => file.relativePath.startsWith('presentation/'))
    expect(presentation.length).toBeGreaterThan(10)

    for (const file of presentation) {
      expect(file.code).not.toContain('Taro.request')
      expect(file.code).not.toContain('wx.request')
      expect(file.code).not.toContain('fetch(')
      expect(file.code).not.toContain('XMLHttpRequest')
    }
  })

  it('⚠️ 页面没有把校园系统 URL 从路由参数里取出来直接打开（防开放重定向）', () => {
    const webviewPage = SOURCES.find((file) =>
      file.relativePath.endsWith('pages/techpie/webview/index.tsx'),
    )
    expect(webviewPage).toBeDefined()
    const code = webviewPage?.code ?? ''
    // 参数名只能是 target（标识），不能是 url
    expect(code).toContain('params.target')
    expect(code).not.toContain('params.url')
    // WebView 的 src 只能来自域名目录（CAMPUS_WEBVIEW_TARGETS）
    expect(code).toContain('campusWebviewTarget')
  })

  it('⚠️ 能力页用目录里的 webviewTargetId 解析校园系统，而不是 capability.key', () => {
    // 回归守卫：「学生请假」与「学生活动」的 key 不同，但都指向同一个 eGate 目标。
    // 用 key 当 target 去查会查不到 → 用户看到一个"未知的校园系统"错误页。
    const page = SOURCES.find((file) =>
      file.relativePath.endsWith('pages/techpie/capabilities/index.tsx'),
    )
    expect(page).toBeDefined()
    const code = page?.code ?? ''
    expect(code).toContain('campusCapabilityDefinition')
    expect(code).toContain('webviewTargetId')
    expect(code).toContain('techpieWebviewPath(targetId)')
  })

  it('⚠️ 绑定动作只走仓储端口，不自己拼 URL', () => {
    const applicationFiles = SOURCES.filter((file) =>
      file.relativePath.startsWith('application/techpie/'),
    )
    expect(applicationFiles.length).toBeGreaterThanOrEqual(4)
    for (const file of applicationFiles) {
      expect(file.code).not.toContain('Taro.request')
      expect(file.code).not.toContain('fetch(')
    }
  })
})
