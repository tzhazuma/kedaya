/**
 * 日志脱敏（规格 §10.3 —— **硬要求**）
 *
 * ## 为什么是白名单而不是黑名单
 *
 * 规格 §4.2 的手法：**白名单外剔除**（不是黑名单过滤）。
 * 黑名单的问题是"漏一个就全泄漏"，而且新增字段时没人会记得回来补。
 * 这里的做法是：
 *   1. **键名**层面：命中禁用键名（大小写不敏感、忽略 `_`/`-`）的值一律替换成 `[REDACTED]`；
 *   2. **文本**层面：对整串做正则清洗（`CASTGC=...` / `Bearer ...` / `password=...`），
 *      因为凭证常常是以"拼好的 header 串"形式出现的，而不是某个字段。
 *
 * ## 覆盖范围（规格 §10.3 的表）
 *
 * | 内容 | 是否清洗 |
 * | --- | --- |
 * | `CASTGC` / 任何 cookie 值 | ✅ |
 * | 明文密码（`password` / `credential`） | ✅ |
 * | `sessionCipher` / `tokenCipher` | ✅ |
 * | `ticket`（WebView 一次性票据） | ✅ |
 * | 付款码 `payload`（`05-security-privacy.md:412`） | ✅ |
 *
 * 由 `redact.spec.ts` 的测试钉死。
 */

/** 替换标记。刻意**不含**原值长度等可用于侧信道推断的信息。 */
export const REDACTED = '[REDACTED]';

/**
 * 一律不得进日志的键名。
 *
 * 前 8 个是契约 §11.4 I1 的禁用键名（身份/绑定摘要里都不允许出现）；
 * 后面几个是规格 §10.3 明确点名的（明文密码、密文、票据、付款码正文）。
 */
export const LOG_FORBIDDEN_KEYS: readonly string[] = [
  // 契约 §11.4 I1 的 8 个
  'cookie',
  'cookies',
  'session',
  'sessionToken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
  // 规格 §10.3 / 05-security-privacy.md
  'password',
  'passwd',
  'credential',
  'credentials',
  'sessionCipher',
  'tokenCipher',
  'encryptedSession',
  'sessionFingerprint',
  'authorization',
  'setCookie',
  'payload',
];

/** 文本层面的清洗规则（顺序即优先级） */
const TEXT_RULES: readonly [RegExp, string][] = [
  // `CASTGC=xxx; JSESSIONID=yyy` 之类的整段 cookie header
  [/\b(CASTGC|TGC|JSESSIONID|EGATE|SESSION|CPDAILY)=[^\s;,]+/gi, `$1=${REDACTED}`],
  // `Authorization: Bearer xxx`
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // `password=xxx` / `"password": "xxx"`
  [/\b(password|passwd|pwd)\b(\s*[:=]\s*)("?)[^\s",;}]+/gi, `$1$2$3${REDACTED}`],
  // 形如 `wvt_xxx` 的一次性票据
  [/\bwvt_[A-Za-z0-9_-]{8,}/g, `wvt_${REDACTED}`],
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

const FORBIDDEN_NORMALIZED = new Set(LOG_FORBIDDEN_KEYS.map(normalizeKey));

/** 该键名是否禁止进日志 */
export function isForbiddenLogKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED.has(normalizeKey(key));
}

/** 文本清洗：把常见凭证形态替换掉 */
export function redactText(text: string): string {
  let output = text;
  for (const [pattern, replacement] of TEXT_RULES) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * 递归清洗任意可序列化结构，返回**新的**对象（不改原对象 ——
 * 否则"为了打日志而改坏了业务对象"就成了新缺陷）。
 *
 * `depth > 8` 直接截断为 `'[DEPTH_LIMIT]'`，避免环状引用把日志打爆。
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isForbiddenLogKey(key) ? REDACTED : redactForLog(child, depth + 1);
    }
    return output;
  }

  // 函数 / symbol 等不可序列化的东西：不打印内容
  return `[${typeof value}]`;
}

/**
 * 把清洗后的结构序列化成一行日志文本。
 *
 * ⚠️ 先 `redactForLog` 再 `JSON.stringify` —— 顺序不能反：
 * 反了的话，序列化会把凭证先变成字符串，键名层面的白名单就失效了。
 */
export function toSafeLogLine(value: unknown): string {
  try {
    return JSON.stringify(redactForLog(value));
  } catch {
    // 循环引用等：绝不退化成"打印原文"
    return '"[UNSERIALIZABLE]"';
  }
}
