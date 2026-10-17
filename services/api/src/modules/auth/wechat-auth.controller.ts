import { Controller, Delete, Get, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { readAuthContext } from './request-context';
import { WECHAT_SESSION_PORT, type WeChatSessionPort } from './domain/wechat.domain';
import { WechatAuthService } from './wechat-auth.service';

/* ------------------------------------------------------------------ *
 * Zod schema
 * ------------------------------------------------------------------ */

const loginSchema = z.object({
  /** `Taro.login()` 拿到的 code；开发模式为 `dev:<设备标识>` */
  code: z.string().trim().min(1).max(512),
  /** 微信昵称（用户在 `<input type="nickname">` 里确认过的） */
  displayName: z.string().trim().min(1).max(64).optional(),
  /** 头像 data URL（≤64KB，见 domain/display-name.ts） */
  avatarDataUrl: z.string().min(1).max(200_000).optional(),
});

const bindSchema = z.object({ code: z.string().trim().min(1).max(512) });

type LoginBody = z.infer<typeof loginSchema>;
type BindBody = z.infer<typeof bindSchema>;

/**
 * 微信小程序登录（第一级身份层的第三条入口）。
 *
 * 契约 §5：它只产出 KedaYa 自有 JWT，与 CAS / 邮箱密码路径完全同构；
 * 校园系统 session 仍然只能走 `CampusSessionPort`（本文件不涉及）。
 *
 * 端点一览：
 *   GET    /auth/wechat/config    是否配置了真实小程序密钥（匿名，供客户端决策）
 *   POST   /auth/wechat/login     一键登录 / 首次注册
 *   GET    /auth/wechat/binding   当前账号的微信绑定状态
 *   POST   /auth/wechat/binding   把微信绑定到当前账号
 *   DELETE /auth/wechat/binding   解绑（账号必须还有别的登录方式）
 */
@ApiTags('auth · 身份（微信小程序）')
@Controller(`${modulePath('auth')}/wechat`)
export class WechatAuthController {
  constructor(
    private readonly wechatAuth: WechatAuthService,
    @Inject(WECHAT_SESSION_PORT) private readonly upstream: WeChatSessionPort,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: '微信登录配置（匿名）',
    description:
      '只回布尔值，用于客户端决定走 `Taro.login()` 还是本地模拟凭证；不泄漏任何密钥。',
  })
  config() {
    const upstream = this.upstream.describeUpstream();
    return {
      provider: 'WECHAT_MINIPROGRAM',
      /** true = 服务端可换真实 openid（客户端应使用 Taro.login 的 code） */
      configured: upstream.configured,
      appIdTail: upstream.appIdTail,
    };
  }

  @Post('login')
  @ApiOperation({
    summary: '微信一键登录 / 首次注册',
    description:
      '同一 openid 首次登录会**建号**（`isNewUser: true`）并给出兜底昵称「微信用户xxxx」，' +
      '客户端应随即引导用户完善昵称与头像。响应里没有任何校园 session。',
  })
  login(
    @ZodBody(loginSchema) body: LoginBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.wechatAuth.login(body, readAuthContext(headers));
  }

  @Get('binding')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前账号的微信绑定状态（不含 openid）' })
  binding(@CurrentUser() userId: string) {
    return this.wechatAuth.status(userId);
  }

  @Post('binding')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '把微信绑定到当前账号',
    description: '该微信已属于其他账号时返回 CONFLICT（不做静默合并）。',
  })
  bind(@CurrentUser() userId: string, @ZodBody(bindSchema) body: BindBody) {
    return this.wechatAuth.bind(userId, body.code);
  }

  @Delete('binding')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '解绑微信',
    description: '账号没有其他登录方式时返回 FORBIDDEN —— 否则用户会被锁在门外。',
  })
  unbind(@CurrentUser() userId: string) {
    return this.wechatAuth.unbind(userId);
  }
}
