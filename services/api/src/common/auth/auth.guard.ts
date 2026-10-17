import { CanActivate, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UnauthenticatedError } from '../errors/app-error';
import { IS_PUBLIC_KEY, authenticateRequest } from './current-user';

/**
 * 第一级身份守卫。
 *
 * 骨架阶段是**按控制器显式启用**（`@UseGuards(AuthGuard)`），而不是全局守卫 ——
 * 因为绝大多数列表类端点当前是公开可读的，全局强制鉴权会让骨架无法演示。
 * 这个取舍已记入 README「未实现项」。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    authenticateRequest(request.headers);
    return true;
  }
}

/**
 * 可选身份守卫：带了合法 token 就解出 userId；没带也放行。
 * 用于 forum / takeout-guard / dorm-harmony 这类"实名匿名都可用"的模块（契约 §9）。
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header) return true;
    try {
      authenticateRequest(request.headers);
    } catch (error) {
      // 匿名可用：token 无效时按未登录处理，而不是 401
      if (!(error instanceof UnauthenticatedError)) throw error;
    }
    return true;
  }
}
