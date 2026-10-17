/**
 * Result —— 显式错误通道，替代跨端不一致的 throw/catch。
 * 三端统一使用：小程序（无异常栈）、Web、Flutter（Dart 侧镜像同形状）。
 */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return r.ok === false;
}

export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/** 穷尽性检查：在 switch 的 default 分支调用，漏掉分支会编译报错 */
export function assertNever(value: never, message = '未处理的分支'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
