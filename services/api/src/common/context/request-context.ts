import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 每请求上下文（traceId + 主体信息）。
 *
 * 用 AsyncLocalStorage 而不是把 traceId 一路透传，是为了让
 * 拦截器 / 异常过滤器 / 审计服务都能拿到同一个 traceId —— 包括
 * 在守卫或管道里抛错（此时还没有 controller 返回值）的路径。
 */
export interface RequestContext {
  traceId: string;
  /** 第一级身份（KedaYa 自有 JWT 解出的 userId）。未登录为 undefined。 */
  userId?: string;
  /** 匿名 handle（forum / dorm-harmony / takeout-guard 用，契约 §9） */
  anonHandle?: string;
  actorType?: 'user' | 'anonymous' | 'system' | 'service';
  ip?: string;
  ua?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/** 取当前 traceId；理论上中间件一定已注入，兜底给 'unknown' 而不是抛错。 */
export function currentTraceId(): string {
  return requestContext.getStore()?.traceId ?? 'unknown';
}

/** 在已有上下文上打补丁（守卫里解出 userId 后回填）。 */
export function patchContext(patch: Partial<RequestContext>): void {
  const store = requestContext.getStore();
  if (store) Object.assign(store, patch);
}
