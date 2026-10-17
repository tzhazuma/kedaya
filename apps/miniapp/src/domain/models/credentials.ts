/**
 * 凭证边界 —— 契约 §11.4 I1 / §11.18-H 与规格 §10.3 的**纯领域**落点。
 *
 * 这个文件存在的唯一理由：把「凭证不得越界」从**文档警告**变成**可被测试断言的类型**。
 * ADR 0004 §2.2 的教训 L2/L3 说得很清楚 ——
 * 「靠模型里不放字段」是弱约束，加个字段就破了，且没有测试会失败。
 * 因此这里提供三个纯函数，让任何一层都能**主动检查**：
 *
 * | 函数 | 用途 |
 * | --- | --- |
 * | `findForbiddenCredentialKeys` | 序列化键名断言（I1 的镜像） |
 * | `redactCredentialText` | 单行文本里的内联凭证（`CASTGC=...` / `Bearer ...`） |
 * | `sanitizeForLog` | 日志脱敏：**白名单外剔除** + 深度扫描（规格 §10.3） |
 *
 * ⚠️ 本文件**零框架依赖**（契约 §7 硬规则 1），且**不得** import `data/`。
 */

/**
 * 契约 §11.4 **I1** 冻结的 8 个禁用键名。
 *
 * ⚠️ 这 8 个是**契约原文**，一个字都不能增删 ——
 * 测试 `credentials.test.ts` 会断言它与契约逐字一致。
 * 日志脱敏需要更宽的集合时用 `LOG_REDACTED_KEYS`（超集），**不要**改这个常量。
 */
export const CREDENTIAL_FORBIDDEN_KEYS = [
  'cookie',
  'cookies',
  'session',
  'sessionToken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
] as const

export type CredentialForbiddenKey = (typeof CREDENTIAL_FORBIDDEN_KEYS)[number]

/**
 * 日志脱敏用的**更宽**的键集合（规格 §10.3 的清单 + 少量同义键）。
 *
 * 为什么比 I1 宽：I1 管的是「身份层会话类型的序列化」，
 * 而日志里还会出现密码、密文、授权头 —— 它们同样绝不能进日志。
 * 归一化后比较（小写 + 去掉 `-` / `_`），因此 `session_token` / `Session-Token`
 * 与 `sessionToken` 等价。
 */
export const LOG_REDACTED_KEYS = [
  ...CREDENTIAL_FORBIDDEN_KEYS,
  'password',
  'passwd',
  'pwd',
  'credential',
  'credentials',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
  'authHeader',
  'tokenCipher',
  'sessionCipher',
  'cipherKeyId',
  'secret',
  'openid',
  'wechatLoginCode',
  'jsCode',
  'loginCode',
] as const

/** 归一化键名：小写并去掉分隔符，用于「同义键」判定 */
export function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '')
}

const FORBIDDEN_NORMALIZED: ReadonlySet<string> = new Set(
  CREDENTIAL_FORBIDDEN_KEYS.map(normalizeKeyName),
)
const REDACTED_NORMALIZED: ReadonlySet<string> = new Set(LOG_REDACTED_KEYS.map(normalizeKeyName))

export function isForbiddenCredentialKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED.has(normalizeKeyName(key))
}

export function isLogRedactedKey(key: string): boolean {
  return REDACTED_NORMALIZED.has(normalizeKeyName(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 深度扫描的默认上限 —— 防止循环引用 / 恶意深嵌套把日志路径拖死 */
const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MAX_ITEMS = 200

export interface ScanOptions {
  maxDepth?: number
  maxItems?: number
}

/**
 * 深度扫描一个值，返回其中出现的**禁用凭证键名路径**（点号分隔）。
 *
 * 用途：
 * - 架构测试断言「响应 / 会话 / 缓存的序列化键名不含 8 个禁用键」（I1 镜像）；
 * - 运行期兜底：写缓存或打日志前先扫一遍。
 *
 * 返回**路径**而不是布尔值，是为了让失败信息能直接指出是哪一层越界
 * （「`data.bindings[0].castgc`」比「有凭证」有用得多）。
 */
export function findForbiddenCredentialKeys(
  value: unknown,
  options: ScanOptions = {},
): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const found: string[] = []
  const seen = new WeakSet<object>()
  let visited = 0

  function walk(node: unknown, path: string, depth: number): void {
    if (visited >= maxItems || depth > maxDepth) return
    if (Array.isArray(node)) {
      visited += 1
      for (let index = 0; index < node.length; index += 1) {
        walk(node[index], `${path}[${index}]`, depth + 1)
      }
      return
    }
    if (!isRecord(node)) return
    if (seen.has(node)) return
    seen.add(node)
    visited += 1

    for (const [key, child] of Object.entries(node)) {
      const childPath = path === '' ? key : `${path}.${key}`
      if (isForbiddenCredentialKey(key)) found.push(childPath)
      walk(child, childPath, depth + 1)
    }
  }

  walk(value, '', 0)
  return found
}

export function hasForbiddenCredentialKeys(value: unknown, options?: ScanOptions): boolean {
  return findForbiddenCredentialKeys(value, options).length > 0
}

/**
 * 文本级凭证清洗（规格 §10.3）。
 *
 * 处理两类**内联**泄漏 —— 它们不会以「键名」形式出现，因此键名白名单抓不到：
 * 1. `key=value` 形式：`CASTGC=abc` / `tgc=abc` / `sessionToken: abc` / `password=abc`
 * 2. `Bearer <token>` 形式：HTTP 头被原样拼进日志字符串时
 *
 * 这是**兜底**，不是主手段 —— 主手段是 `sanitizeForLog` 的白名单剔除。
 */
/**
 * 三个正则的顺序是**刻意**的：
 * 1. 先吃掉 `Authorization: [Bearer] <token>` 整段（否则 `Bearer` 会被当成"值"留下 token）；
 * 2. 再处理没有 `Authorization:` 前缀的裸 `Bearer <token>`；
 * 3. 最后处理 `key=value` 形式。
 */
const AUTH_HEADER_PATTERN = /(authorization\s*[=:]\s*)(?:bearer\s+)?([^\s,;&"']+)/gi
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi
const INLINE_CREDENTIAL_PATTERN =
  /((?:castgc|tgc|cookies?|sessiontoken|session_token|jsessionid|password|passwd|pwd|ticket|tenant)\s*[=:]\s*)([^\s,;&"']+)/gi

export function redactCredentialText(text: string): string {
  return text
    .replace(AUTH_HEADER_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(INLINE_CREDENTIAL_PATTERN, '$1[REDACTED]')
}

/** 单个字符串在日志里的最大长度 —— 截断而不是丢弃，保留可诊断性 */
const MAX_LOG_STRING = 240
const MAX_LOG_ARRAY = 20

export interface SanitizeForLogOptions extends ScanOptions {
  /** 允许出现的键名白名单；`undefined` 表示「只按脱敏键集合剔除」 */
  allowedKeys?: readonly string[]
}

export interface SanitizeForLogResult {
  /** 清洗后的值（可直接 JSON.stringify） */
  value: unknown
  /** 被剔除的键路径（白名单外 / 脱敏键）—— 用于「我们确实删了东西」的可观测性 */
  droppedKeys: string[]
}

/**
 * 日志脱敏 —— **白名单外剔除**（规格 §10.3 的硬要求）。
 *
 * 为什么是白名单而不是黑名单：黑名单只能挡住**想得到的**名字，
 * 一个 `x_castgc_v2` 就绕过去了；白名单下「没想到的字段」默认不进日志。
 *
 * 两层防护：
 * 1. 若给了 `allowedKeys`，不在名单里的键**整个丢弃**（不写 `[REDACTED]`，因为
 *    连「存在这个字段」都不该泄漏）；
 * 2. 无论是否给白名单，脱敏键集合（`LOG_REDACTED_KEYS`）里的键一律丢弃；
 *    字符串值再走一遍 `redactCredentialText` 兜底内联泄漏。
 */
export function sanitizeForLog(
  input: unknown,
  options: SanitizeForLogOptions = {},
): SanitizeForLogResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const allowed = options.allowedKeys
  const allowedNormalized =
    allowed === undefined ? null : new Set(allowed.map(normalizeKeyName))

  const droppedKeys: string[] = []
  const seen = new WeakSet<object>()
  let visited = 0

  function scrubString(text: string): string {
    const redacted = redactCredentialText(text)
    return redacted.length > MAX_LOG_STRING
      ? `${redacted.slice(0, MAX_LOG_STRING)}…[TRUNCATED]`
      : redacted
  }

  function walk(node: unknown, path: string, depth: number): unknown {
    if (typeof node === 'string') return scrubString(node)
    if (node === null || typeof node !== 'object') {
      // number / boolean / undefined / bigint / function：原样保留
      // （函数不可能是凭证载体，且 JSON.stringify 会自然丢掉它）
      return typeof node === 'function' ? undefined : node
    }
    if (visited >= maxItems || depth > maxDepth) return '[TRUNCATED]'
    if (seen.has(node)) return '[CIRCULAR]'
    seen.add(node)
    visited += 1

    if (Array.isArray(node)) {
      return node
        .slice(0, MAX_LOG_ARRAY)
        .map((item, index) => walk(item, `${path}[${index}]`, depth + 1))
    }

    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path === '' ? key : `${path}.${key}`
      if (isLogRedactedKey(key)) {
        droppedKeys.push(childPath)
        continue
      }
      if (allowedNormalized !== null && !allowedNormalized.has(normalizeKeyName(key))) {
        droppedKeys.push(childPath)
        continue
      }
      const scrubbed = walk(child, childPath, depth + 1)
      if (scrubbed !== undefined) out[key] = scrubbed
    }
    return out
  }

  return { value: walk(input, '', 0), droppedKeys }
}
