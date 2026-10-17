import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TRACE_HEADER } from '@kedaya/contracts';
import { requestContext } from '../context/request-context';

/** 只接受"看起来像追踪 id"的入参，避免把任意用户输入反射进响应头（header 注入） */
const TRACE_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * `X-KedaYa-Trace` 中间件（契约 §6.1）。
 *
 * - 客户端带了合法 traceId 就复用（便于跨端串联链路），否则生成 UUID；
 * - 回写响应头；
 * - 放进 AsyncLocalStorage，供信封拦截器 / 异常过滤器 / 审计日志读取。
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(TRACE_HEADER);
    const traceId = incoming && TRACE_ID_PATTERN.test(incoming) ? incoming : randomUUID();

    res.setHeader(TRACE_HEADER, traceId);

    requestContext.run(
      {
        traceId,
        ip: req.ip,
        ua: req.header('user-agent') ?? undefined,
        actorType: 'anonymous',
      },
      () => next(),
    );
  }
}
