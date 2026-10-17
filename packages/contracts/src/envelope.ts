/**
 * 可达鸭统一响应信封与错误码（冻结契约 §6.1）
 *
 * 所有端的网络层都必须把后端响应收敛到 `ApiEnvelope<T>`，
 * 不允许各处自行解包。
 */

/** 机器可读错误码 —— 三端共用，禁止各端私自定义字符串 */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'CAMPUS_BINDING_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

export interface ApiError {
  /** 机器可读 */
  code: ApiErrorCode;
  /** 面向用户的中文文案 */
  message: string;
  /** 可选结构化细节（字段级校验错误等） */
  details?: unknown;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  traceId: string;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
  traceId: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** 游标分页（契约冻结：不用 offset 分页） */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ *
 * 常量（冻结）
 * ------------------------------------------------------------------ */

export const API_BASE_PATH = '/api/v1';
export const TRACE_HEADER = 'X-KedaYa-Trace';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const AUTH_HEADER = 'Authorization';

/** 默认页大小与上限 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 需要二次同意的模块（契约 §9） */
export const CONSENT_REQUIRED_CODES: readonly ApiErrorCode[] = ['CONSENT_REQUIRED'];

/**
 * 客户端遥测上报端点（**不含** `/api/v1` 前缀，与其它接口一致由请求层拼接）。
 *
 * 为什么写进契约而不是各端各写一份字面量：
 * 端点只出现在「小程序上报」与「后端控制器」两处，一旦漂移就是**静默失效** ——
 * 线上真的出错时你什么都收不到，而且没有任何测试会因此变红。
 *
 * 注意：telemetry 是**基础设施**，故意不进 `MODULES`
 * （模块清单被契约 §4 冻结为 19 个用户可见模块，加一个会同时打破
 *  `apps/web` 的交付状态断言与首页宫格）。
 */
export const TELEMETRY_ENDPOINT = '/telemetry/client-events';

/* ------------------------------------------------------------------ *
 * 判定与解包
 * ------------------------------------------------------------------ */

export function isOk<T>(env: ApiEnvelope<T>): env is ApiSuccess<T> {
  return env.ok === true;
}

export function isFailure<T>(env: ApiEnvelope<T>): env is ApiFailure {
  return env.ok === false;
}

/** 解包失败时抛出，携带 code 便于上层分支处理 */
export class ApiEnvelopeError extends Error {
  readonly code: ApiErrorCode;
  readonly traceId: string;
  readonly details: unknown;

  constructor(error: ApiError, traceId: string) {
    super(error.message);
    this.name = 'ApiEnvelopeError';
    this.code = error.code;
    this.traceId = traceId;
    this.details = error.details;
  }

  /** 需要用户先去绑定校园系统 */
  get needsCampusBinding(): boolean {
    return this.code === 'CAMPUS_BINDING_REQUIRED';
  }

  /** 需要用户先做二次同意 */
  get needsConsent(): boolean {
    return this.code === 'CONSENT_REQUIRED';
  }
}

/** 成功则返回 data，失败则抛 ApiEnvelopeError */
export function unwrap<T>(env: ApiEnvelope<T>): T {
  if (isOk(env)) return env.data;
  throw new ApiEnvelopeError(env.error, env.traceId);
}

/** 不抛异常的版本 */
export function toResult<T>(env: ApiEnvelope<T>): { ok: true; value: T } | { ok: false; error: ApiError; traceId: string } {
  return isOk(env)
    ? { ok: true, value: env.data }
    : { ok: false, error: env.error, traceId: env.traceId };
}

/** 构造一个成功信封（后端与 mock 共用） */
export function success<T>(data: T, traceId: string): ApiSuccess<T> {
  return { ok: true, data, traceId };
}

/** 构造一个失败信封 */
export function failure(code: ApiErrorCode, message: string, traceId: string, details?: unknown): ApiFailure {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) }, traceId };
}
