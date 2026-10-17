/**
 * 客户端遥测的领域约定（纯 TypeScript，零框架依赖）。
 *
 * 这个模块的作用是把「客户端能报什么」**收窄成一个封闭集合**：
 * 客户端是不可信输入源（可能被逆向、被抓包重放），
 * 因此字段、枚举与长度上限全部在服务端白名单里定死，
 * 而不是"收下再说、展示时再过滤"。
 *
 * 三条不可让步的规则：
 *   1. `kind` 是**白名单枚举**，不接受任意字符串（否则这张表会被当成通用日志管道）；
 *   2. 一切文本都经过 `redactSecrets()` —— 客户端崩溃栈里经常连带把
 *      `Authorization: Bearer eyJ...` 一起打出来，落库即泄露；
 *   3. 长度硬截断而不是报错 —— 遥测是**尽力而为**的旁路，不该因为字段太长就丢掉整条
 *      （报错会让客户端"静默丢日志"，那就白做了）。
 */

/** 客户端事件类型（白名单；新增类型必须同时改服务端与 `apps/miniapp` 的 reporter） */
export const CLIENT_EVENT_KINDS = [
  /** 未捕获的 JS 异常（`Taro.onError`） */
  'error',
  /** 未处理的 Promise 拒绝（`Taro.onUnhandledRejection`） */
  'unhandled-rejection',
  /** 进入不存在的页面（`Taro.onPageNotFound`）—— 通常是升级后旧链接失效 */
  'page-not-found',
  /** 后端返回 5xx / 信封不合规（客户端无能为力，必须让我们知道） */
  'api-failure',
  /** 渲染期异常（错误边界捕获） */
  'render-error',
] as const;

export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number];

/** 单条事件允许的最大字段长度（超出直接截断，不报错） */
export const CLIENT_EVENT_LIMITS = {
  message: 500,
  stack: 4000,
  route: 200,
  traceId: 64,
  appVersion: 64,
  /** `context` 的值序列化后的长度 */
  contextValue: 200,
  /** `context` 最多几个键 */
  contextKeys: 12,
} as const;

/**
 * 限流：每个来源（IP）每窗口允许的最大事件数。
 *
 * 值是"够用且不会把库写爆"的量级：正常用户的峰值远低于此，
 * 而一个疯狂重试的坏版本（或恶意刷）会在窗口内被丢掉。
 * 注意这是**单实例内存**限流 —— 多实例部署时实际阈值 = 实例数 × 该值，
 * 对"防止写爆库"这个目标已经够用；真要精确限流得上 Redis，属于后续优化。
 */
export const CLIENT_EVENT_RATE_LIMIT = { windowMs: 60_000, max: 30 } as const;

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  // Authorization: Bearer xxx / bare JWT
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '<redacted-jwt>'],
  // 显式的 token / password 字段（JSON 或 query 形态都覆盖）
  [
    /("?(?:access|refresh|id)?_?token"?\s*[:=]\s*"?)([A-Za-z0-9._~+/=-]{8,})/gi,
    '$1<redacted>',
  ],
  [/("?(?:password|passwd|pwd)"?\s*[:=]\s*"?)([^"\s,}]{4,})/gi, '$1<redacted>'],
  // 邮箱与手机号（隐私：遥测里不该出现可定位到人的标识）
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<redacted-phone>'],
];

/**
 * 抹掉文本里的凭据与个人标识。
 *
 * 崩溃栈是最容易带出 token 的地方（很多人会把 header 打进日志），
 * 所以这里在**入库前**做，而不是指望调用方自觉。
 */
export function redactSecrets(text: string): string {
  let output = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** 按长度截断（按码点截，避免把代理对切成两半产生乱码） */
export function truncate(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}

/** 归一化后的、可以安全落库的客户端事件 */
export interface NormalizedClientEvent {
  kind: ClientEventKind;
  message: string;
  stack: string | null;
  route: string | null;
  traceId: string | null;
  platform: string | null;
  appVersion: string | null;
  context: Record<string, string | number | boolean | null> | null;
}

export interface NormalizeInput {
  kind: string;
  message: string;
  stack?: string;
  route?: string;
  traceId?: string;
  platform?: string;
  appVersion?: string;
  context?: Record<string, unknown>;
}

/**
 * 未知类型**不报错**，而是落成 `error` 而不是丢弃。
 *
 * 权衡：客户端版本总是先于服务端上线（小程序发版无法回滚），
 * 服务端如果对未知 `kind` 直接 400，新版本客户端的一切上报会被整批丢掉 ——
 * 恰恰在最需要看到日志的时候（灰度新版本）失明。
 */
export function normalizeKind(raw: string): ClientEventKind {
  return (CLIENT_EVENT_KINDS as readonly string[]).includes(raw) ? (raw as ClientEventKind) : 'error';
}

export function normalizeClientEvent(input: NormalizeInput): NormalizedClientEvent {
  return {
    kind: normalizeKind(input.kind),
    message: truncate(redactSecrets(input.message), CLIENT_EVENT_LIMITS.message),
    stack:
      input.stack === undefined
        ? null
        : truncate(redactSecrets(input.stack), CLIENT_EVENT_LIMITS.stack),
    route: input.route === undefined ? null : truncate(input.route, CLIENT_EVENT_LIMITS.route),
    traceId:
      input.traceId === undefined ? null : truncate(input.traceId, CLIENT_EVENT_LIMITS.traceId),
    appVersion:
      input.appVersion === undefined
        ? null
        : truncate(redactSecrets(input.appVersion), CLIENT_EVENT_LIMITS.appVersion),
    platform:
      input.platform === undefined
        ? null
        : truncate(input.platform, 32),
    context: normalizeContext(input.context),
  };
}

/**
 * `context` 只收标量值。
 *
 * 刻意不收嵌套对象/数组：一是 Prisma 的 Json 字段一旦收了深层结构，
 * 之后想加校验就来不及了；二是"嵌套里塞了什么"在审计时根本看不清。
 * 超出的键直接丢弃（有上限，避免一条上报撑爆一行）。
 */
function normalizeContext(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | null {
  if (input === undefined) return null;

  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(output).length >= CLIENT_EVENT_LIMITS.contextKeys) break;

    const trimmedKey = truncate(key, 40);
    if (typeof value === 'string') {
      output[trimmedKey] = truncate(redactSecrets(value), CLIENT_EVENT_LIMITS.contextValue);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      output[trimmedKey] = value;
    } else if (typeof value === 'boolean' || value === null) {
      output[trimmedKey] = value;
    }
  }
  return Object.keys(output).length === 0 ? null : output;
}

/**
 * 滑动窗口限流器（单实例内存）。
 *
 * 抽成纯类是为了**可测**：限流这种东西一旦写错（比如窗口没清理、
 * 或者恰好相反把所有人都挡了），线上表现是"日志时有时无"，极难发现。
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** 记录一次并返回是否放行 */
  tryAcquire(key: string, now: number): boolean {
    const bucket = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (bucket.length >= this.max) {
      // 被限流时也要把裁剪后的桶写回去：否则桶会无限增长
      this.hits.set(key, bucket);
      return false;
    }
    bucket.push(now);
    this.hits.set(key, bucket);
    return true;
  }

  /** 清理过期键（避免 Map 键无限增长）；由调用方定期触发 */
  sweep(now: number): void {
    for (const [key, bucket] of this.hits) {
      const alive = bucket.filter((at) => now - at < this.windowMs);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
