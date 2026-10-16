import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { failure, type ApiEnvelope, type ApiErrorCode } from '@kedaya/contracts';
import type { Response } from 'express';
import { AppError, ERROR_HTTP_STATUS, InternalError } from '../errors/app-error';
import { currentTraceId } from '../context/request-context';

/** Zod issue → 稳定的字段级错误结构（契约 §6.1 `ApiError.details`） */
export function zodIssuesToDetails(error: ZodError): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

const HTTP_STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM_UNAVAILABLE',
  503: 'UPSTREAM_UNAVAILABLE',
  504: 'UPSTREAM_UNAVAILABLE',
};

/** Prisma 已知错误码 → 契约错误码（避免把 ORM 细节泄漏成 500） */
const PRISMA_CODE_TO_API: Record<string, { code: ApiErrorCode; message: string }> = {
  P2002: { code: 'CONFLICT', message: '记录已存在（唯一约束冲突）' },
  P2003: { code: 'CONFLICT', message: '关联记录不存在（外键约束）' },
  P2025: { code: 'NOT_FOUND', message: '记录不存在或已被删除' },
  P1000: { code: 'UPSTREAM_UNAVAILABLE', message: '数据库认证失败' },
  P1001: { code: 'UPSTREAM_UNAVAILABLE', message: '无法连接数据库' },
  P1002: { code: 'UPSTREAM_UNAVAILABLE', message: '数据库连接超时' },
  P1008: { code: 'UPSTREAM_UNAVAILABLE', message: '数据库操作超时' },
  P1017: { code: 'UPSTREAM_UNAVAILABLE', message: '数据库连接已断开' },
};

/**
 * 全局异常过滤器：任何异常都翻译成契约 §6.1 的失败信封。
 *
 * 优先级：AppError → ZodError → Prisma 已知错误 → HttpException → 兜底 INTERNAL。
 * 兜底路径**不**把原始 message 回给客户端（防内部细节泄漏），只回 traceId 供对日志。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const traceId = currentTraceId();
    const { code, message, details, status } = this.translate(exception);

    // 5xx 打完整堆栈；4xx 只记一行，避免刷日志
    if (status >= 500) {
      this.logger.error(
        `[${traceId}] ${code} ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${traceId}] ${code} ${message}`);
    }

    const body: ApiEnvelope<never> = failure(code, message, traceId, details);

    // HTTP 上下文（RPC/WS 场景下没有 response，做保护）
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    if (typeof response?.status === 'function') {
      response.status(status).json(body);
    }
  }

  private translate(exception: unknown): {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    status: number;
  } {
    if (exception instanceof AppError) {
      return {
        code: exception.code,
        message: exception.message,
        details: exception.details,
        status: exception.status,
      };
    }

    if (exception instanceof ZodError) {
      return {
        code: 'VALIDATION_FAILED',
        message: '请求参数不合法',
        details: zodIssuesToDetails(exception),
        status: 400,
      };
    }

    const prismaMapped = mapPrismaError(exception);
    if (prismaMapped) {
      return {
        ...prismaMapped,
        status: ERROR_HTTP_STATUS[prismaMapped.code],
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : typeof (payload as { message?: unknown })?.message === 'string'
            ? String((payload as { message: string }).message)
            : exception.message;
      return { code, message, details: typeof payload === 'object' ? payload : undefined, status };
    }

    const fallback = new InternalError();
    return {
      code: fallback.code,
      message: fallback.message,
      details: undefined,
      status: fallback.status,
    };
  }
}

function mapPrismaError(exception: unknown): { code: ApiErrorCode; message: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const code = (exception as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  // Prisma 错误码形如 P2002；用白名单避免把任意 {code:'X'} 误判
  return PRISMA_CODE_TO_API[code] ?? null;
}
