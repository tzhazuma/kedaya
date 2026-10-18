import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import { authenticateRequest } from './current-user';

/**
 * 管理员守卫（食堂菜品库的写操作）。
 *
 * 为什么需要它：`canteen` 模块原本整控制器是 `OptionalAuthGuard`，
 * 于是 `POST/PATCH/DELETE /canteen/items` 对**任何人（含未登录）**开放 ——
 * 任何人都能把「红烧肉」改成 0 kcal 或删空菜品库。而营养管家的全部
 * 价值前提是「菜品库是权威数据」（ADR 0006 D1/D7）。
 *
 * 两种放行方式（都不改冻结的身份契约，JWT 里不加角色）：
 *   1. 请求头 `x-admin-key` 与 `ADMIN_API_KEY` 相等（后台 / 脚本用）；
 *   2. 已登录用户的 id 在 `ADMIN_USER_IDS`（逗号分隔）里（人工兜底）。
 *
 * 两个环境变量都没配时，**一律拒绝**（fail-closed）——
 * 绝不因为「没配置」而静默放开写权限。
 */
export const ADMIN_KEY_HEADER = 'x-admin-key';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (matchesAdminKey(request)) return true;

    const userId = resolveUserId(request);
    const allowed = adminUserIds();
    if (userId !== null && allowed.includes(userId)) return true;

    throw new ForbiddenError(
      '菜品营养数据由平台管理员维护。如需补录或修正，请联系管理员，或在菜品详情里发起纠错。',
      { hint: '需要管理员身份' },
    );
  }
}

function headerValue(request: Request): string | null {
  const raw = request.headers[ADMIN_KEY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 常量时间比较，避免把 key 的逐字节匹配时间暴露给调用方 */
function matchesAdminKey(request: Request): boolean {
  const expected = process.env.ADMIN_API_KEY ?? '';
  if (expected === '') return false;
  const provided = headerValue(request);
  if (provided === null) return false;

  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 解析 JWT；没有 token 返回 null（未登录交给调用方决定报 401 还是 403） */
function resolveUserId(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  try {
    return authenticateRequest(request.headers as Record<string, string | string[] | undefined>);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null;
    throw error;
  }
}

function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}
