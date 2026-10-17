import type { ApiErrorCode } from '@kedaya/contracts';

/**
 * 错误码 → HTTP 状态码（契约 §6.1 只冻结了错误码，状态码由本表统一决定）。
 *
 * 说明：`CAMPUS_BINDING_REQUIRED` / `CONSENT_REQUIRED` 用 403 而不是 428，
 * 因为它们对客户端而言就是"当前主体无权访问该资源，需要先完成一个前置动作"，
 * 403 的语义足够且兼容性最好。错误码本身才是机器可读的唯一依据。
 */
export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  CAMPUS_BINDING_REQUIRED: 403,
  CONSENT_REQUIRED: 403,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/**
 * 领域错误基类。控制器/服务只抛这个（或子类），
 * 由 AllExceptionsFilter 统一翻译成契约 §6.1 的失败信封。
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status ?? ERROR_HTTP_STATUS[code];
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = '请求参数不合法', details?: unknown) {
    super('VALIDATION_FAILED', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = '请先登录上科大统一身份认证') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '没有权限执行该操作', details?: unknown) {
    super('FORBIDDEN', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super('NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = '资源状态冲突', details?: unknown) {
    super('CONFLICT', message, details);
  }
}

/**
 * 触发频控（契约 §6.1 冻结了 `RATE_LIMITED`，此前没有对应的错误类）。
 *
 * 用于：验证码发送过频、上游返回限流、微信 jscode2session 被限频等。
 * `details.retryAfterSeconds` 有值时，客户端应据此展示倒计时。
 */
export class RateLimitedError extends AppError {
  constructor(message = '操作过于频繁，请稍后再试', details?: unknown) {
    super('RATE_LIMITED', message, details);
  }
}

/**
 * 第二级（能力层）未绑定（契约 §5 硬规则 3）：
 * 身份有效，但用户还没绑定对应校园系统。
 */
export class CampusBindingRequiredError extends AppError {
  constructor(
    message = '该功能需要先绑定校园系统',
    details?: unknown,
  ) {
    super('CAMPUS_BINDING_REQUIRED', message, details);
  }
}

/**
 * 敏感模块未二次同意（契约 §9）。
 */
export class ConsentRequiredError extends AppError {
  constructor(
    readonly moduleId: string,
    message = '该模块涉及敏感数据，需要你先明确同意',
  ) {
    super('CONSENT_REQUIRED', message, { module: moduleId });
  }
}

export class UpstreamUnavailableError extends AppError {
  constructor(message = '上游服务暂时不可用', details?: unknown) {
    super('UPSTREAM_UNAVAILABLE', message, details);
  }
}

export class InternalError extends AppError {
  constructor(message = '服务内部错误', details?: unknown) {
    super('INTERNAL', message, details);
  }
}
