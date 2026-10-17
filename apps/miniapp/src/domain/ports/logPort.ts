/**
 * 日志端口 —— 规格 §10.3「日志与脱敏」的**契约侧**。
 *
 * 规格 §10.3 的硬要求不是「记得别打日志」，而是**白名单外剔除**：
 *
 * > 日志中间件**白名单外剔除**（只记录白名单字段，不是黑名单过滤）
 *
 * 因此本端口把「哪些事件存在、每个事件允许带哪些字段」冻结成一张**登记表**
 * （`LOG_EVENT_FIELDS`）。实现（`src/platform/log.ts`）对未登记的事件、
 * 未登记的字段一律**丢弃**并计数 —— 于是「不小心把 `credential` 传进日志」
 * 这件事在**结构上**就不可能发生，而不是靠 reviewer 眼力。
 *
 * ⚠️ 端口在 `domain/`，实现只能在 `platform/` 或 `data/` ——
 * 这样 `application` 层可以打日志而**不**依赖任何具体日志库（契约 §7）。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 已脱敏、可直接序列化的一条日志 */
export interface LogRecord {
  level: LogLevel
  event: string
  /** ⚠️ 到达 sink 的字段**已经**过白名单剔除与凭证清洗 */
  fields: Readonly<Record<string, unknown>>
  /** ISO-8601 */
  at: string
}

/** 日志落点。测试注入一个记录数组即可断言「日志里没有凭证」 */
export interface LogSink {
  write(record: LogRecord): void
}

export interface LogPort {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

/**
 * 事件登记表 —— **唯一真相**。
 *
 * 新增日志事件时必须同时在这里登记允许的字段：
 * 这一步的摩擦是**故意的**，它强迫「我要打什么」先过一次脑子。
 */
export const LOG_EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  /* ---------------- techpie · 绑定列表 ---------------- */
  'techpie.bindings.hydrated': ['count', 'fromCache'],
  'techpie.bindings.load.started': [],
  'techpie.bindings.load.succeeded': ['count', 'activeCount', 'durationMs'],
  'techpie.bindings.load.failed': ['code', 'durationMs'],

  /* ---------------- techpie · 绑定动作 ---------------- */
  'techpie.binding.create.started': ['provider', 'phase'],
  'techpie.binding.create.succeeded': ['provider', 'status', 'bindingId'],
  'techpie.binding.create.failed': ['provider', 'code'],
  'techpie.binding.create.rejected': ['provider', 'reason'],

  'techpie.binding.unbind.started': ['bindingId', 'provider'],
  'techpie.binding.unbind.succeeded': ['bindingId'],
  'techpie.binding.unbind.failed': ['bindingId', 'code'],

  'techpie.binding.renew.started': ['bindingId', 'provider'],
  'techpie.binding.renew.succeeded': ['bindingId', 'status'],
  'techpie.binding.renew.failed': ['bindingId', 'code'],

  /* ---------------- techpie · 能力清单 ---------------- */
  'techpie.capabilities.hydrated': ['count'],
  'techpie.capabilities.load.started': [],
  'techpie.capabilities.load.succeeded': ['count', 'unboundCount', 'durationMs'],
  'techpie.capabilities.load.failed': ['code', 'durationMs'],

  /* ---------------- techpie · 契约违规（**不含凭证内容**） ---------------- */
  'techpie.contract.violation': ['where', 'droppedCount', 'reason'],

  /* ---------------- campus-card（独立 OPENID 通道） ---------------- */
  'campus-card.transactions.hydrated': ['count'],
  'campus-card.transactions.load.started': [],
  'campus-card.transactions.load.succeeded': ['count', 'durationMs'],
  'campus-card.transactions.load.failed': ['code', 'durationMs'],
  'campus-card.payment-code.issued': ['expiresAt'],
  'campus-card.payment-code.failed': ['code'],

  /* ---------------- WebView 直连（W4：用户自己登录） ---------------- */
  'techpie.webview.open': ['targetId', 'domainVerified'],
}

export function isRegisteredLogEvent(event: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOG_EVENT_FIELDS, event)
}

export function allowedFieldsFor(event: string): readonly string[] | null {
  return isRegisteredLogEvent(event) ? (LOG_EVENT_FIELDS[event] ?? []) : null
}

/** 什么都不做的日志端口 —— 测试 / 无宿主环境下的兜底 */
export const NOOP_LOG_PORT: LogPort = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
