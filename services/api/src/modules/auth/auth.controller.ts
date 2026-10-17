import { Controller, Delete, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MODULES, modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { AuthGuard } from '../../common/auth/auth.guard';
import { USER_REPOSITORY, type UserRepository } from './domain/auth.domain';
import { CurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CAMPUS_PLATFORMS, type CampusPlatform } from './domain/auth.domain';
import { readAuthContext } from './request-context';
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
  /**
   * 上游回调拿到的 session cookie；服务端加密后落库，绝不明文存储。
   *
   * 可省略：`CAMPUS_DATA_MODE=mock`（默认）且非生产环境时，
   * 服务端会签发一份**演示凭据**（`demo:<platform>:<userId>`）让
   * 「绑定 → 取数 → 解绑」全链路在没有官方授权时也能跑通，
   * 响应里会如实标注 `simulated: true`。真实模式（`live`）下必填。
   */
  sessionCookie: z.string().min(1).max(4096).optional(),
  scopes: z.array(z.string().min(1).max(64)).max(20).optional(),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(30 * 24 * 60 * 60)
    .optional(),
});

const updateProfileSchema = z
  .object({
    /** 昵称：去空白后 1–24 字（服务层用 `sanitizeDisplayName` 再规范一次） */
    displayName: z.string().min(1).max(64).optional(),
    /** 头像 data URL（≤64KB）。传 null 表示清空 */
    avatarUrl: z.string().max(200_000).nullable().optional(),
    department: z.string().max(64).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' });

@ApiTags('auth · 身份（两级模型）')
@Controller(modulePath('auth'))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  @Post('login')
  @ApiOperation({
    summary: '第一级登录（上科大 CAS）：ticket → KedaYa 自有 JWT',
    description:
      '只返回身份与自有令牌。校园系统 session **不在**此响应中（契约 §5 硬规则 1）。',
  })
  login(
    @ZodBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.authService.login(body.ticket, readAuthContext(headers));
  }

  @Post('refresh')
  @ApiOperation({
    summary: '用 refreshToken 换取新的令牌对（轮换 + 旧令牌立即失效）',
  })
  refresh(
    @ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.authService.refresh(body.refreshToken, readAuthContext(headers));
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

  /**
   * `GET /auth/session` —— 一级身份的**最小投影**（契约 §5 + 不变式 I1）。
   *
   * 与 `GET /auth/me` 分开：`me` 返回身份 **+ 校园绑定状态**，`session` 只返回身份。
   * 分开是因为 `session` 要被**高频**调用（启动恢复登录态），且必须满足 **I5**：
   * 上游全超时下 < 50ms 返回 —— 因此它**不得**碰 `CampusSessionPort`，一次都不许。
   *
   * 恰好 4 个字段：多一个就多一份泄漏面；`studentId` 这类可跨系统关联的标识
   * **不该**出现在高频端点上。
   */
  @Get('session')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '一级身份的最小投影（4 个字段，不碰任何上游，< 50ms）',
    description: '不变式 I1：响应键恰好 `userId` / `name` / `avatarUrl` / `department`。',
  })
  async session(@CurrentUser() userId: string) {
    // ⚠️ 这里**不能**走 `authService.me()` —— 它会读校园绑定状态，
    // 也就是会碰 `CampusSessionPort`（上游）。而 I5 要求本端点
    // 在上游全超时的情况下 < 50ms 返回 ⇒ 它必须是**纯本地**读。
    // 用 `users.findById` 直接读自有账户，一次都不碰上游。
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthenticatedError('账号不存在或已注销');
    }
    // 显式逐字段组装，**不要**用展开运算符 —— 展开会把将来新增的字段自动带出去。
    return {
      userId: user.id,
      name: user.displayName,
      avatarUrl: user.avatarUrl,
      department: user.department,
    };
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '更新我的展示资料（昵称 / 头像 / 院系）',
    description:
      '三个客户端共用一个入口。「更正权」（隐私文档 §7.2）在这里落地：' +
      '邮箱与学号由凭据/上游决定，不允许在此修改。',
  })
  updateMe(@CurrentUser() userId: string, @ZodBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>) {
    return this.authService.updateProfile(userId, body);
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
    description:
      '与身份层物理分离；绑定失败不影响已登录状态。' +
      'mock 模式（默认、非生产）可省略 sessionCookie，服务端签发演示凭据并在响应里标注。',
  })
  bind(
    @CurrentUser() userId: string,
    @ZodBody(bindSchema) body: z.infer<typeof bindSchema>,
  ) {
    return this.authService.bindCampus(userId, body.platform, {
      ...(body.sessionCookie === undefined ? {} : { sessionCookie: body.sessionCookie }),
      ...(body.scopes === undefined ? {} : { scopes: body.scopes }),
      ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: body.ttlSeconds }),
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
