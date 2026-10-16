import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MODULES, modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CAMPUS_PLATFORMS, type CampusPlatform } from './domain/auth.domain';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  /** 上科大 CAS 回调拿到的 ticket（真实实现里服务端校验后立即丢弃） */
  ticket: z.string().min(1, 'ticket 不能为空').max(512, 'ticket 过长'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空').max(2048),
});

const bindSchema = z.object({
  platform: z.enum(['EGATE', 'CPDAILY', 'JWC', 'CARD']),
  /** 上游回调拿到的 session cookie；服务端加密后落库，绝不明文存储 */
  sessionCookie: z.string().min(1, 'sessionCookie 不能为空').max(4096),
  scopes: z.array(z.string().min(1).max(64)).max(20).optional(),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(30 * 24 * 60 * 60)
    .optional(),
});

@ApiTags('auth · 身份（两级模型）')
@Controller(modulePath('auth'))
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: '第一级登录：上科大统一身份认证 → KedaYa 自有 JWT',
    description:
      '只返回身份与自有令牌。校园系统 session **不在**此响应中（契约 §5 硬规则 1）。',
  })
  login(@ZodBody(loginSchema) body: z.infer<typeof loginSchema>) {
    return this.authService.login(body.ticket);
  }

  @Post('refresh')
  @ApiOperation({ summary: '用 refreshToken 换取新的 accessToken' })
  refresh(@ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>) {
    return this.authService.refresh(body.refreshToken);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '当前身份 + 校园系统绑定状态（两者是独立的）',
    description: '`campusBound: false` 表示"已登录但未绑定"，这是合法状态（契约 §5 硬规则 3）。',
  })
  me(@CurrentUser() userId: string) {
    return this.authService.me(userId);
  }

  @Get('campus-bindings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '第二级：列出已绑定的校园系统（不含任何 session）' })
  listBindings(@CurrentUser() userId: string) {
    return this.authService.listCampusBindings(userId);
  }

  @Post('campus-bindings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：绑定校园系统（session 加密存储）',
    description: '与身份层物理分离；绑定失败不影响已登录状态。',
  })
  bind(
    @CurrentUser() userId: string,
    @ZodBody(bindSchema) body: z.infer<typeof bindSchema>,
  ) {
    return this.authService.bindCampus(userId, body.platform, {
      sessionCookie: body.sessionCookie,
      scopes: body.scopes,
      ttlSeconds: body.ttlSeconds,
    });
  }

  @Delete('campus-bindings/:platform')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '第二级：解绑校园系统' })
  async unbind(@CurrentUser() userId: string, @Param('platform') platform: string) {
    const parsed = z.enum(['EGATE', 'CPDAILY', 'JWC', 'CARD']).safeParse(platform);
    if (!parsed.success) {
      // 交给全局过滤器翻成 VALIDATION_FAILED
      throw new ValidationError('platform 不是受支持的校园系统', {
        platform,
        supported: CAMPUS_PLATFORMS,
      });
    }
    await this.authService.unbindCampus(userId, parsed.data as CampusPlatform);
    return { platform: parsed.data, unbound: true };
  }

  @Get('campus-bindings/:platform/capability')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：某校园系统能力是否可用（只回布尔值，不回 session）',
  })
  capability(@CurrentUser() userId: string, @Param('platform') platform: string) {
    return this.authService.campusCapability(userId, platform as CampusPlatform);
  }

  @Get('modules')
  @ApiOperation({
    summary: '模块注册表（直接来自 @kedaya/contracts，证明后端不另起一套）',
  })
  modules() {
    return MODULES.map((module) => ({
      id: module.id,
      route: module.route,
      nameZh: module.nameZh,
      sensitivity: module.sensitivity,
      requiresConsent: module.requiresConsent,
      basePath: `/api/v1/${module.route}`,
    }));
  }
}
