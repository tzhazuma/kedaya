import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthRequestContext } from './domain/local-account.domain';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './domain/password';
import { readAuthContext } from './request-context';
import { LocalAuthService } from './local-auth.service';

/* ------------------------------------------------------------------ *
 * Zod schema —— 请求体校验的唯一入口（契约 §6.1：全站 ZodValidationPipe）
 * ------------------------------------------------------------------ */

const emailSchema = z.string().trim().min(3).max(254);
const codeSchema = z.string().regex(/^\d{6}$/, '验证码是 6 位数字');
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const emailOnlySchema = z.object({ email: emailSchema });

const registerSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(24).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const resetSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: passwordSchema,
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

/** 绑定邮箱：验证码 + 新密码（给只有微信登录方式的账号补一条后路） */
const bindEmailSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: passwordSchema,
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(2048).optional(),
});

type RegisterBody = z.infer<typeof registerSchema>;
type LoginBody = z.infer<typeof loginSchema>;
type ResetBody = z.infer<typeof resetSchema>;
type ChangeBody = z.infer<typeof changeSchema>;
type BindEmailBody = z.infer<typeof bindEmailSchema>;
type LogoutBody = z.infer<typeof logoutSchema>;
type EmailOnlyBody = z.infer<typeof emailOnlySchema>;

/** 请求上下文（IP / UA 只用于风控与审计，不参与业务判定） */
function readContext(headers: Record<string, string | string[] | undefined>): AuthRequestContext {
  return readAuthContext(headers);
}

/**
 * 自建账号（邮箱 + 密码）接口。
 *
 * 与 `auth.controller.ts` 的关系：
 *   · 该文件 = 第一级 CAS 身份 + 第二级校园绑定（契约 §5 冻结形状）；
 *   · 本文件 = 同一身份层的**第二条登录方式**，两者签发完全同构的 KedaYa JWT。
 *
 * 所有端点都不返回任何校园系统凭据。
 */
@ApiTags('auth · 账号（邮箱 + 密码）')
@Controller(`${modulePath('auth')}/account`)
export class LocalAuthController {
  constructor(private readonly localAuth: LocalAuthService) {}

  @Post('register/code')
  @ApiOperation({
    summary: '发送注册验证码',
    description:
      '邮箱已注册时返回 CONFLICT。验证码 10 分钟有效，60 秒冷却，每小时最多 5 条。',
  })
  requestRegisterCode(
    @ZodBody(emailOnlySchema) body: EmailOnlyBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.sendRegisterCode(body.email, readContext(headers));
  }

  @Post('register')
  @ApiOperation({ summary: '注册并直接登录（返回自有 JWT）' })
  register(
    @ZodBody(registerSchema) body: RegisterBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.register(body, readContext(headers));
  }

  @Post('login')
  @ApiOperation({
    summary: '邮箱密码登录',
    description: '连续 5 次密码错误锁定 15 分钟；账号不存在与密码错误返回同一文案。',
  })
  login(
    @ZodBody(loginSchema) body: LoginBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.login(body, readContext(headers));
  }

  @Post('password/forgot')
  @ApiOperation({
    summary: '发送找回密码验证码',
    description: '无论邮箱是否存在都返回 sent=true，避免账号枚举。',
  })
  forgotPassword(
    @ZodBody(emailOnlySchema) body: EmailOnlyBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.sendResetCode(body.email, readContext(headers));
  }

  @Post('password/reset')
  @ApiOperation({ summary: '用验证码重置密码（成功后所有设备下线）' })
  resetPassword(@ZodBody(resetSchema) body: ResetBody) {
    return this.localAuth.resetPassword(body);
  }

  @Post('password/change')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '修改密码（需登录 + 当前密码，成功后其他设备下线）',
    description: '为避免用户被自己的改密踢下线，响应里直接带一套新令牌。',
  })
  changePassword(
    @CurrentUser() userId: string,
    @ZodBody(changeSchema) body: ChangeBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.changePassword(userId, body, readContext(headers));
  }

  @Post('bind-email/code')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '绑定邮箱前发送验证码（需登录）',
    description:
      '给只有微信登录方式的账号补一条后路。邮箱已被占用 / 账号已设密码时直接返回 CONFLICT。',
  })
  requestBindEmailCode(
    @CurrentUser() userId: string,
    @ZodBody(emailOnlySchema) body: EmailOnlyBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.sendBindEmailCode(userId, body.email, readContext(headers));
  }

  @Post('bind-email')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '绑定邮箱密码（需登录 + 验证码）',
    description:
      '在**同一个账号**上增加邮箱密码登录方式，不新建账号；也是解绑微信的前置条件。',
  })
  bindEmail(
    @CurrentUser() userId: string,
    @ZodBody(bindEmailSchema) body: BindEmailBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.localAuth.bindEmail(userId, body, readContext(headers));
  }


  @Post('logout')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '登出',
    description: '带 refreshToken 只撤销本次登录；不带则撤销该账号全部会话。',
  })
  async logout(@CurrentUser() userId: string, @ZodBody(logoutSchema) body: LogoutBody) {
    const result = await this.localAuth.logout(userId, body.refreshToken);
    return { loggedOut: true, ...result };
  }

  @Get('password/status')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前账号是否设置了密码（决定是否展示「修改密码」）' })
  async passwordStatus(@CurrentUser() userId: string) {
    return { hasPassword: await this.localAuth.hasPassword(userId) };
  }
}

void Body;
