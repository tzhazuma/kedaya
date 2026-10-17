import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TRACE_HEADER, isFailure, success, type ApiEnvelope } from '@kedaya/contracts';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { currentContext, currentTraceId } from '../context/request-context';
import { SKIP_ENVELOPE_KEY } from '../media/skip-envelope.decorator';

/**
 * 统一响应信封拦截器（契约 §6.1）。
 *
 * 成功响应一律收敛为 `{ ok: true, data, traceId }`。
 * 已是信封的返回值（例如某些内部转发）原样透传，避免二次包装。
 *
 * 例外：带 `@SkipEnvelope()` 的处理器（例如直接回图片字节的媒体路由）
 * **不包装** —— 见 `skip-envelope.decorator.ts` 的原因说明。
 * `Reflector` 是 `@Optional()` 的，这样老的单测 `new EnvelopeInterceptor()` 仍然可用。
 */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T | null>> {
  constructor(private readonly reflector?: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T | null>> {
    const skip = this.reflector?.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => {
        if (skip === true) return data as unknown as ApiEnvelope<T | null>;

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
