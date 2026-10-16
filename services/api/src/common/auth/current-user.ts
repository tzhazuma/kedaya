import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '../errors/app-error';
import { currentContext, patchContext } from '../context/request-context';
import { verifyJwt } from './jwt';

/** 标注无需登录的路由（`AuthGuard` 会放行） */
export const IS_PUBLIC_KEY = 'kedaya:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * 从请求头里解出第一级身份并写进请求上下文。
 *
 * 注意：这里**只**解析 KedaYa 自有 JWT。
 * 任何校园系统 session/cookie 都不会、也不应该在这里被读取（契约 §5 硬规则 1）。
 */
export function authenticateRequest(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;

  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthenticatedError();
  }

  const token = header.slice('Bearer '.length).trim();
  const secret = process.env.JWT_SECRET ?? '';
  const payload = verifyJwt(token, secret);

  patchContext({ userId: payload.sub, actorType: 'user' });
  return payload.sub;
}

/** `@CurrentUser()` —— 取当前登录用户 id（未登录抛 UNAUTHENTICATED） */
export const CurrentUser = createParamDecorator((_data: unknown, _ctx: ExecutionContext): string => {
  const userId = currentContext()?.userId;
  if (!userId) throw new UnauthenticatedError();
  return userId;
});

/** 可选登录：有 token 就用，没有返回 undefined（用于"匿名可用"的模块） */
export const OptionalCurrentUser = createParamDecorator((): string | undefined => {
  return currentContext()?.userId;
});
