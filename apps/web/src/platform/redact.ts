/**
 * 日志 / 埋点脱敏（契约 §7：`platform/`；规格 §10.3 硬要求）。
 *
 * 规格 §10.3「绝对不进日志的内容」：
 * - `CASTGC` / 任何 cookie 值；
 * - 明文密码（`credential` 字段）；
 * - `sessionCipher` / `tokenCipher`；
 * - **`ticket`**（一次性 WebView 票据，§8.4）。
 *
 * 实现方式**必须是白名单**，不是黑名单（§4.2 / `05-security-privacy.md:418`
 * 「`AuditInterceptor` 使用字段白名单（默认拒绝），不是黑名单」）：
 * 白名单的失败模式是"少记了一个字段"，黑名单的失败模式是"漏了一个新凭证名"。
 * 后者不可接受。
 *
 * 两道闸：
 * 1. **键白名单**：不在 `LOG_SAFE_FIELDS` 里的键**整条丢弃**（不是置空）；
 * 2. **值级掩码**：即便字段名安全（如 `note`），值里若出现已知凭证形态
 *    （`CASTGC=` / `wvt_…` / `KEDAYA-ECARD-…` / `password=`）也一律掩掉。
 */
import { createTraceLogger, type TraceEvent, type TraceLogger, type TraceSink } from './analytics';

/**
 * 允许进入日志/埋点的键（**默认拒绝**）。
 *
 * 刻意只放"排查故障真正需要"的字段：动作、模块、平台、状态、错误码、traceId。
 * 没有 `detail` / `payload` / `note` / `body` / `headers` / `credential` ——
 * 这些字段名太容易装进凭证。
 */
export const LOG_SAFE_FIELDS: readonly string[] = [
  'name',
  'at',
  'traceId',
  'moduleId',
  'action',
  'platform',
  'status',
  'phase',
  'capabilityId',
  'linkId',
  'reason',
  'errorCode',
  'httpStatus',
  'durationMs',
  'ok',
  'host',
  'mode',
];

/**
 * 已知凭证形态。
 *
 * 每条有两个正则，职责刻意分开：
 * - `pattern`（检测，宽松）：只要出现"凭证的味道"就算命中 —— 用于测试与告警；
 * - `mask`（掩码，贪婪）：必须把**值**一起吃掉，否则 `CASTGC=TGT-1234` 会变成
 *   `[REDACTED]=TGT-1234`，等于没脱敏。这是第一版真实踩到的坑。
 */
export interface SecretPattern {
  label: string;
  pattern: RegExp;
  mask: RegExp;
}

export const SECRET_VALUE_PATTERNS: readonly SecretPattern[] = [
  { label: 'castgc', pattern: /castgc/i, mask: /castgc\s*[:=]?\s*\S*/gi },
  { label: 'tgc', pattern: /\btgc\b/i, mask: /\btgc\s*[:=]\s*\S*/gi },
  {
    label: 'cookie',
    pattern: /(?:^|[;\s])cookie\s*[:=]/i,
    mask: /(?:^|[;\s])cookie\s*[:=]\s*[^\s;]+/gi,
  },
  {
    label: 'sessionToken',
    pattern: /session_?token/i,
    mask: /session_?token\s*[:=]?\s*\S*/gi,
  },
  { label: 'webviewTicket', pattern: /\bwvt_[A-Za-z0-9_-]+/, mask: /\bwvt_[A-Za-z0-9_-]+/g },
  {
    label: 'paymentCodePayload',
    pattern: /\bKEDAYA-ECARD-[A-Za-z0-9-]+/,
    mask: /\bKEDAYA-ECARD-[A-Za-z0-9-]+/g,
  },
  { label: 'ticketParam', pattern: /[?&]ticket=/i, mask: /[?&]ticket=[^\s&]*/gi },
  { label: 'password', pattern: /password\s*[:=]/i, mask: /password\s*[:=]\s*\S*/gi },
  {
    label: 'bearer',
    pattern: /\bbearer\s+[A-Za-z0-9._-]{8,}/i,
    mask: /\bbearer\s+[A-Za-z0-9._-]{8,}/gi,
  },
];

export const REDACTED = '[REDACTED]';

/** 文本里命中的凭证形态标签（去重、稳定排序） */
export function findSecretPatterns(text: string): string[] {
  const hits = new Set<string>();
  for (const { label, pattern } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) hits.add(label);
  }
  return [...hits].sort();
}

/** 把文本里的凭证形态（连同其值）替换成 `[REDACTED]` */
export function maskSecrets(text: string): string {
  let output = text;
  for (const { mask } of SECRET_VALUE_PATTERNS) {
    const flags = mask.flags.includes('g') ? mask.flags : `${mask.flags}g`;
    output = output.replace(new RegExp(mask.source, flags), REDACTED);
  }
  return output;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return maskSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!LOG_SAFE_FIELDS.includes(key)) continue; // 白名单外**整条丢弃**
      const redacted = redactValue(child, depth + 1);
      if (redacted !== undefined) output[key] = redacted;
    }
    return output;
  }
  // 函数 / symbol 等：不记
  return undefined;
}

/**
 * 白名单脱敏。返回一个**新对象**，只含 `LOG_SAFE_FIELDS` 里的键，
 * 且所有字符串值都过了一遍值级掩码。
 */
export function redactForLog(
  input: unknown,
  allowed: readonly string[] = LOG_SAFE_FIELDS,
): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.includes(key)) continue;
    const redacted = redactValue(value, 0);
    if (redacted !== undefined) output[key] = redacted;
  }
  return output;
}

/**
 * 脱敏版 trace logger —— **techpie 切片只用它**。
 *
 * 与 `traceLogger` 的区别：事件在进入环形缓冲 / sink / 控制台**之前**
 * 就已经过白名单 + 掩码，因此即便调用方手滑传了 `{ ticket }`，
 * 落进缓冲与 sink 的也只是被丢掉的键（不是被"藏起来"的键）。
 */
export function createSafeTraceLogger(sink?: TraceSink): TraceLogger {
  const inner = createTraceLogger(
    sink
      ? (event) => {
          sink({ ...event, data: redactForLog(event.data) });
        }
      : undefined,
  );

  return {
    track(event): TraceEvent {
      const safe: Omit<TraceEvent, 'at'> & { at?: string } = {
        name: maskSecrets(String(event.name)),
        at: event.at,
        ...(event.traceId === undefined ? {} : { traceId: maskSecrets(event.traceId) }),
        ...(event.moduleId === undefined ? {} : { moduleId: event.moduleId }),
        ...(event.data === undefined ? {} : { data: redactForLog(event.data) }),
      };
      return inner.track(safe);
    },
    recent: () => inner.recent(),
    clear: () => inner.clear(),
  };
}

/** techpie 切片的 trace logger（无 sink：纯本地环形缓冲 + 开发期控制台） */
export const techpieTraceLogger = createSafeTraceLogger();

/** 测试用：把任意对象序列化后扫描凭证形态（返回命中标签） */
export function scanSerializedForSecrets(value: unknown): string[] {
  let text: string;
  try {
    text = JSON.stringify(value) ?? '';
  } catch {
    text = String(value);
  }
  return findSecretPatterns(text);
}
