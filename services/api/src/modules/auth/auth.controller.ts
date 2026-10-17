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
import {
  CAMPUS_PLATFORMS as CAMPUS_PROVIDERS,
  CAMPUS_SESSION_PORT as CAMPUS_LINK_PORT,
  isActiveLinkStatus,
  isCampusPlatform,
  translateCampusSessionError,
  type CampusPlatform as CampusProvider,
  type CampusSessionPort as CampusLinkPort,
} from '../techpie/domain/ports/campus-session.port';
import { readAuthContext } from './request-context';
import { toCampusBindingSummary } from './campus-binding-summary';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  /** 上科大 CAS 回调拿到的 ticket（真实实现里服务端校验后立即丢弃） */
  ticket: z.string().min(1, 'ticket 不能为空').max(512, 'ticket 过长'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空').max(2048),
});

/**
 * `POST /auth/campus-bindings` 的入参（契约 §11.19-C + §11.20-C/D）。
 *
 * ⚠️ 与 `/techpie/links` **同一个语义**（同一张表、同一套枚举、同一条 OPENID 通道），
 * 只是路径与元素形状不同。因此这里刻意**不**再发明一套字段：
 *   · `provider`：§11.20-C 的统一枚举（唯一真相在 `campus-session.port.ts`）；
 *   · `authCode`：一次性凭证交换码（§11.19-B），**不是**长期标识；
 *   · `.strict()`：`sessionCookie` / `credential` / `platform` 这些旧名一律 400 ——
 *     静默忽略才是真正的危险（客户端以为自己在指定平台，服务端其实没读）。
 */
const bindCampusSchema = z
  .object({
    provider: z.enum(CAMPUS_PROVIDERS as [CampusProvider, ...CampusProvider[]]),
    authCode: z.string().min(1).max(512),
  })
  .strict();

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
    /**
     * 第二级「绑定」的**唯一**实现（techpie 的 `CampusSessionPort`，落 `TechpieLink` 表）。
     *
     * ⚠️ 这里注入的是 **techpie 的** token，而不是 auth 自己那套
     * `CAMPUS_SESSION_PORT`：§11.20 裁决「两套 port 与枚举收敛成一套」之后，
     * 绑定这条链路的 owner 只有一个。`/auth/campus-bindings` 与 `/techpie/links`
     * 因此是同一张表、同一套枚举的两个 wire 形状（§11.19-C）。
     */
    @Inject(CAMPUS_LINK_PORT) private readonly campusLinks: CampusLinkPort,
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
  @ApiOperation({
    summary: '第二级：绑定状态摘要（`CampusBindingSummary[]`，不含任何 session / 凭证）',
    description:
      '契约 §11.19-C：元素用 `{platform, bound, expiresAt?}`（**不是** techpie 的 `provider`/`status`）。' +
      '平台枚举是 §11.20-C 的统一枚举 —— 与 `/techpie/links` 同一张表、同一套拼法。',
  })
  async listBindings(@CurrentUser() userId: string) {
    const links = await this.campusLinks.listBindings(userId);
    return links.map((link) => toCampusBindingSummary(link));
  }

  @Post('campus-bindings')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：绑定校园系统（Phase 0 只有 `ecard` + `authCode` 这一条通道）',
    description:
      '与身份层物理分离；绑定失败不影响已登录状态。' +
      '需要代持校园会话的平台（egate / cpdaily / jwc / cas / techpie）**没有任何绑定路径**' +
      '（阻塞于信息办书面回复，规格 U7），因此它们返回 **403 `PHASE_BLOCKED`**，' +
      '而不是一个看起来能用的假绑定 —— 闸门在**读任何凭证之前**。' +
      '入参 `.strict()`：旧别名（`platform` / `sessionCookie` / `credential`）会得到 400，' +
      '而**不是**被静默忽略（§11.20-D）。',
  })
  async bind(
    @CurrentUser() userId: string,
    @ZodBody(bindCampusSchema) body: z.infer<typeof bindCampusSchema>,
  ) {
    try {
      const state = await this.campusLinks.bind(userId, body.provider, {
        kind: 'openid',
        channel: 'wechat',
        authCode: body.authCode,
      });
      return toCampusBindingSummary(state);
    } catch (error) {
      // ⚠️ 必须翻译：不翻译的话 `PHASE_BLOCKED` 会变成 500 INTERNAL，
      // 客户端会以为"服务坏了"，而真实语义是"这条路本轮不开放"（§8.5）。
      throw translateCampusSessionError(error);
    }
  }

  @Delete('campus-bindings/:platform')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '第二级：解绑校园系统（硬删凭证副本，不只是标记失效）' })
  async unbind(@CurrentUser() userId: string, @Param('platform') platform: string) {
    const parsed = readCampusProvider(platform);
    await this.campusLinks.unbind(userId, parsed);
    return { platform: parsed, bound: false };
  }

  @Get('campus-bindings/:platform/capability')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '第二级：某校园系统能力是否可用（只回布尔值，不回 session）',
  })
  async capability(@CurrentUser() userId: string, @Param('platform') platform: string) {
    const parsed = readCampusProvider(platform);
    const binding = await this.campusLinks.getBinding(userId, parsed);
    return { available: binding !== null && isActiveLinkStatus(binding.status) };
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

/**
 * 路径参数 `:platform` 的取值校验（§11.20-C 的统一枚举）。
 *
 * 不合法 → `VALIDATION_FAILED`（交给全局过滤器翻），而不是 404 或静默忽略：
 * 「你写的平台名我不认识」与「这个平台不存在」是两件事，
 * 前者应当是**可修正的输入错误**。
 */
function readCampusProvider(raw: string): CampusProvider {
  if (!isCampusPlatform(raw)) {
    throw new ValidationError('platform 不是受支持的校园系统（§11.20-C 统一枚举）', {
      platform: raw,
      supported: CAMPUS_PROVIDERS,
    });
  }
  return raw;
}
