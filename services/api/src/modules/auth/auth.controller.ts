import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MODULES, modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CAMPUS_PLATFORMS, isCampusPlatform } from '../techpie/domain/ports/campus-session.port';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  /** 上科大 CAS 回调拿到的 ticket（真实实现里服务端校验后立即丢弃） */
  ticket: z.string().min(1, 'ticket 不能为空').max(512, 'ticket 过长'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空').max(2048),
});

/** 契约 §11.20-C 统一后的校园平台枚举（与 `TechpieLink.provider` **同一套**） */
const platformEnum = z.enum(['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie']);

/**
 * `POST /auth/campus-bindings` 的入参。
 *
 * ⚠️ 与 `POST /techpie/links` 是**同一件事**的另一个入口，因此**同一套字段名**
 * （§11.20-D：一个概念只有一个名字）：
 *   · `provider`（不是 `platform`）；
 *   · `authCode`（§11.19-B：一次性凭证交换码，不是任何长期标识）；
 *   · 明文密码在 wire 上**没有位置**（U12：结构性拒绝，强于读了再拒）。
 *
 * ⚠️ 两个端点的**响应**形状不同（§11.19-C）：
 * 这里是 `CampusBindingSummary`（`{platform, bound, expiresAt?}`），
 * `/techpie/links` 是 `TechpieLink`（`{id, provider, status, …}`）。
 * 它们**不共用名字**，因此实现者不会按名字猜错。
 */
const bindSchema = z
  .object({
    provider: platformEnum,
    authCode: z.string().min(1).max(512),
  })
  .strict();

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

  @Get('session')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第一级身份会话（契约 §11.4 I1：**不含** 8 个禁用键名）',
    description:
      '只返回 `userId` / `studentId` / `name` / `department`。' +
      '**纯本地读取**（契约 §8 首帧要求）：不触发任何上游调用 —— ' +
      '由不变式 I5 的测试在「mock 上游全超时」环境下断言 < 50ms。',
  })
  session(@CurrentUser() userId: string) {
    return this.authService.session(userId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '当前身份 + 校园系统绑定状态（两者是独立的）',
    description:
      '`campusBound: false` 表示"已登录但未绑定"，这是合法状态（契约 §5 硬规则 3）。' +
      '`campusBindings` 用 `/auth/*` 自己的形状（`CampusBindingSummary`），**不是** `TechpieLink`（§11.19-C）。',
  })
  me(@CurrentUser() userId: string) {
    return this.authService.me(userId);
  }

  @Get('campus-bindings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：列出已绑定的校园系统（不含任何 session）',
    description:
      '形状是 `CampusBindingSummary`：`{platform, bound, expiresAt?}` —— ' +
      '**只描述登录态下的绑定状态**，与 `/techpie/links` 的可管理资源（`TechpieLink`）是两个概念（§11.19-C）。',
  })
  listBindings(@CurrentUser() userId: string) {
    return this.authService.listCampusBindings(userId);
  }

  @Post('campus-bindings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：绑定校园系统（Phase 0 **只接受** `ecard` + `authCode`）',
    description:
      '与 `POST /techpie/links` 是同一件事的另一个入口（**字段名相同**，见 bindSchema 的说明）。' +
      '需要 CASTGC 的平台在信息办书面回复（U7）前**没有任何绑定路径**；明文密码一律拒绝（U12）。',
  })
  bind(@CurrentUser() userId: string, @ZodBody(bindSchema) body: z.infer<typeof bindSchema>) {
    const provider = body.provider;
    if (!isCampusPlatform(provider)) {
      throw new ValidationError('provider 不是受支持的校园平台', {
        reason: 'UNKNOWN_PLATFORM',
        supported: [...CAMPUS_PLATFORMS],
      });
    }
    return this.authService.bindCampus(userId, provider, {
      kind: 'openid',
      channel: 'wechat',
      authCode: body.authCode,
    });
  }

  @Delete('campus-bindings/:platform')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '第二级：解绑校园系统（**硬删**凭证副本）' })
  async unbind(@CurrentUser() userId: string, @Param('platform') platform: string) {
    if (!isCampusPlatform(platform)) {
      // 交给全局过滤器翻成 VALIDATION_FAILED
      throw new ValidationError('platform 不是受支持的校园系统', {
        platform,
        supported: [...CAMPUS_PLATFORMS],
      });
    }
    await this.authService.unbindCampus(userId, platform);
    return { platform, unbound: true };
  }

  @Get('campus-bindings/:platform/capability')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：某校园系统能力是否可用（只回布尔值，不回 session）',
  })
  capability(@CurrentUser() userId: string, @Param('platform') platform: string) {
    if (!isCampusPlatform(platform)) {
      throw new ValidationError('platform 不是受支持的校园系统', {
        platform,
        supported: [...CAMPUS_PLATFORMS],
      });
    }
    return this.authService.campusCapability(userId, platform);
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
