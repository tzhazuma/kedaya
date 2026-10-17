import type { ApiErrorCode } from '@kedaya/contracts';

/**
 * 错误码 → HTTP 状态码（契约 §6.1 只冻结了错误码，状态码由本表统一决定）。
 *
 * 说明：
 *   · `CONSENT_REQUIRED` 用 403 而不是 428 —— 对客户端而言就是"当前主体无权访问
 *     该资源，需要先完成一个前置动作"，403 的语义足够且兼容性最好。
 *   · `CAMPUS_BINDING_REQUIRED` 用 **409**（**不是** 401，也**不是** 403）。
 *     这是 ADR 0004 §5.4 与契约 §11.4 **I4** 的硬要求：
 *     401 会触发客户端的"登出并跳登录"逻辑，而用户其实**已经登录了**；
 *     「已登录但未绑定」是**合法状态**，客户端应当**跳绑定引导页**。
 *     契约 `03-api-contract.md:141` 与本表一致（409）。
 *     错误码本身才是机器可读的唯一依据。
 */
export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  CAMPUS_BINDING_REQUIRED: 409,
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

/**
 * 参数/输入不合法。
 *
 * `status` 可选覆盖：全站默认 400（契约 §6.1 的既有映射，多处测试钉死），
 * 但个别端点按自己的规格要求 **422**（例如 `POST /techpie/webview-session` 的
 * `targetUrl` 非 https —— 规格 §8.4 的校验表）。错误码仍是 `VALIDATION_FAILED`，
 * 机器可读的依据没有分叉。
 */
export class ValidationError extends AppError {
  constructor(message = '请求参数不合法', details?: unknown, status?: number) {
    super('VALIDATION_FAILED', message, details, status);
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

/**
 * 触发限流（契约 §6.1 的 `RATE_LIMITED`）。
 *
 * 用途：`POST /techpie/webview-session`（10 次/分钟/用户，规格 §8.4）、
 * 以及 Phase 1+ 的绑定尝试限流（5 次/小时/用户，规格 §8.5 —— 防密码暴力破解）。
 * `details` 里只放**限流参数**，绝不放被限流的请求内容（规格 §10.3）。
 */
export class RateLimitedError extends AppError {
  constructor(message = '请求过于频繁，请稍后再试', details?: unknown) {
    super('RATE_LIMITED', message, details);
  }
}

export class InternalError extends AppError {
  constructor(message = '服务内部错误', details?: unknown) {
    super('INTERNAL', message, details);
  }
}
