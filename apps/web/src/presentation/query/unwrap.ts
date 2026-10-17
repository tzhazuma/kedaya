/**
 * Result → 异常 的桥接（presentation 层）。
 *
 * domain/application 用显式 `Result` 通道；TanStack Query 需要 `throw`。
 * 这个文件是两者之间**唯一**的转换点，避免各组件自己 `if (!r.ok) throw`。
 */
import type { ApiError } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

export class ApiResultError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiResultError';
    this.apiError = apiError;
  }

  get code(): ApiError['code'] {
    return this.apiError.code;
  }

  get traceId(): string | undefined {
    const details = this.apiError.details;
    if (details && typeof details === 'object' && 'traceId' in details) {
      const value = (details as { traceId?: unknown }).traceId;
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  }
}

export function unwrapOrThrow<T>(result: Result<T, ApiError>): T {
  if (result.ok) return result.value;
  throw new ApiResultError(result.error);
}

/** 把任意异常规整成契约 ApiError，供 UI 统一渲染 */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiResultError) return error.apiError;
  if (error instanceof Error) {
    return { code: 'INTERNAL', message: error.message || '未知错误' };
  }
  return { code: 'INTERNAL', message: '未知错误' };
}

export function errorMessage(error: unknown): string {
  return asApiError(error).message;
}
