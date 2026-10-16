import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { IDEMPOTENCY_HEADER } from '@kedaya/contracts';
import { of, throwError, type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { currentContext } from '../context/request-context';
import { ConflictError, ValidationError } from '../errors/app-error';
import { IdempotencyStore, idempotencyScope } from './idempotency.store';

/**
 * `Idempotency-Key` 强制拦截器（契约 §11.3）。
 *
 * | 方法 | 是否必需 |
 * | POST（创建资源 / 领域动作） | **必需** —— 缺失返回 `VALIDATION_FAILED` |
 * | PATCH / PUT / DELETE | 可选（本拦截器直接放行） |
 * | GET | 不适用（放行） |
 *
 * 语义：
 *   1. 首次请求 → 执行，成功后把**原始返回值**（未封信封）存起来；
 *   2. 同 key 重试 → 直接回放同一份 data（客户端拿到与首次完全一致的结果）；
 *   3. 同 key 并发 → `CONFLICT`（不静默双写）；
 *   4. 执行抛错 → 不落缓存，重试可重新执行。
 *
 * 注册在**模块控制器**上（`@UseInterceptors(IdempotencyInterceptor)`），
 * 不全局注册 —— 契约 §11.3 是硬性要求，但把全仓所有 POST 一次性收紧
 * 属于集成阶段的事，交给 Lead 决定（见交付说明的未决问题）。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(@Inject(IdempotencyStore) private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'POST') return next.handle();

    const key = readHeader(request.headers, IDEMPOTENCY_HEADER);
    if (!key) {
      return throwError(
        () =>
          new ValidationError(`POST 请求必须带 ${IDEMPOTENCY_HEADER} 请求头（契约 §11.3）`, {
            header: IDEMPOTENCY_HEADER,
          }),
      );
    }

    const scope = idempotencyScope({
      actorId: currentContext()?.userId,
      method,
      path: request.originalUrl ?? request.url ?? '',
      key,
    });

    const begun = this.store.begin(scope);
    if (begun.kind === 'replay') return of(begun.data);
    if (begun.kind === 'in-flight') {
      return throwError(
        () => new ConflictError('相同 Idempotency-Key 的请求正在处理中，请稍后重试', { header: IDEMPOTENCY_HEADER }),
      );
    }

    return next.handle().pipe(
      tap({
        next: (data) => this.store.complete(scope, data),
        error: () => this.store.abort(scope),
      }),
    );
  }
}

/**
 * 大小写不敏感地取请求头。
 *
 * 必须这样写：Express 会把入站请求头名**全部小写**，
 * 而契约里的头名是 `Idempotency-Key` —— 只按原样取会永远取不到，
 * 结果是"每个 POST 都被判成缺头"。这个缺陷由 `test/forum-http.spec.ts`
 * 的真实 HTTP 用例抓出来（单测里手写 headers 是取不到的）。
 */
function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
