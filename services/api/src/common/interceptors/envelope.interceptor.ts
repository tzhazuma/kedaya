import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { TRACE_HEADER, isFailure, success, type ApiEnvelope } from '@kedaya/contracts';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { currentContext, currentTraceId } from '../context/request-context';

/**
 * 统一响应信封拦截器（契约 §6.1）。
 *
 * 成功响应一律收敛为 `{ ok: true, data, traceId }`。
 * 已是信封的返回值（例如某些内部转发）原样透传，避免二次包装。
 */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T | null>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T | null>> {
    return next.handle().pipe(
      map((data) => {
        const traceId = currentTraceId();

        // 已信封化：原样透传（成功/失败都算）
        if (isEnvelopeLike(data)) {
          return data as ApiEnvelope<T | null>;
        }

        // DELETE 之类没有返回体的处理器：给 data: null，保持信封形状稳定
        return success((data ?? null) as T | null, traceId);
      }),
    );
  }
}

function isEnvelopeLike(value: unknown): value is ApiEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.traceId !== 'string') return false;
  if (candidate.ok === true) return 'data' in candidate;
  if (candidate.ok === false) return isFailure(candidate as unknown as ApiEnvelope<unknown>);
  return false;
}

/** 便于测试与外部复用的辅助：把 traceId 写入响应头（拦截器之外也需要） */
export function traceHeaderName(): string {
  return TRACE_HEADER;
}

/** 当前上下文是否已建立（测试用） */
export function hasContext(): boolean {
  return currentContext() !== undefined;
}
