import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * 公网边缘登录 —— 给"外部人通过隧道访问 API"发一张**短期通行证**。
 *
 * ## 它解决什么
 *
 * 后端经 Cloudflare quick tunnel 暴露在公网。在它前面有两层：
 * 1. `x-edge-token`（共享密钥，见 `edge-token.middleware.ts`）—— 适合程序调用
 * 2. **本文件**：用户名 + 密码换一个短期 JWT —— 适合给人用（浏览器/curl）
 *
 * ## ⚠️ 它**不是**校园身份
 *
 * 这张通行证只回答"你有权访问这台公网 API"，**不回答"你是谁"**。
 * 它签发的 JWT 用**独立的 `aud`**（`kedaya-edge`），业务侧的 `AuthGuard`
 * 不认它 —— 所以拿到 edge token 也看不到任何人的课表、校园卡、私信。
 *
 * 这个隔离是刻意的：边缘网关的账密泄露，不应该等于校园账号失守。
 *
 * ## 凭据从哪来
 *
 * **绝不硬编码在源码里**。`EDGE_USERNAME` / `EDGE_PASSWORD` 从环境变量读，
 * 只在部署机的 `.env` 里设置。两个都没设 → 本端点 404（功能未启用），
 * 而不是"用一个谁都知道的默认密码"。
 *
 * 这一条是有教训的：把可用的默认密码写进仓库，等于把仓库的每个读者
 * 都变成管理员。
 */

export const EDGE_LOGIN_PATH = '/api/v1/edge/login';
export const EDGE_JWT_AUDIENCE = 'kedaya-edge';
export const EDGE_JWT_TTL_SEC = 12 * 60 * 60; // 12 小时

interface EdgeCredential {
  readonly username: string;
  readonly password: string;
}

/** 用常量时间比较两个字符串，避免按响应时间逐字节爆破 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 极简 HS256 JWT 签发（不引第三方库 —— 只需要 sign，不需要 verify 生态） */
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export interface EdgeLoginResult {
  readonly token: string;
  readonly expiresAt: string;
  readonly expiresInSec: number;
}

@ApiTags('edge')
@Controller('edge')
export class EdgeAuthController {
  private readonly logger = new Logger(EdgeAuthController.name);

  constructor(private readonly config: ConfigService) {}

  private credential(): EdgeCredential | null {
    const username = this.config.get<string>('EDGE_USERNAME');
    const password = this.config.get<string>('EDGE_PASSWORD');
    if (username === undefined || username.trim() === '') return null;
    if (password === undefined || password.trim() === '') return null;
    return { username: username.trim(), password: password.trim() };
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: '公网边缘登录（用户名 + 密码换短期通行证）',
    description:
      '凭据来自 `EDGE_USERNAME` / `EDGE_PASSWORD` 环境变量，**不在源码里**。' +
      '未配置时本端点返回 404（功能未启用），而不是放行。' +
      '签发的 JWT `aud = kedaya-edge`，业务侧 `AuthGuard` **不认它** —— ' +
      '拿到它只能访问本 API，看不到任何人的校园数据。',
  })
  login(@Body() body: unknown): EdgeLoginResult {
    const expected = this.credential();

    // 未配置 → 当作这条路由不存在。不返回 401，避免暴露"这里有个登录口"
    // ⚠️ 必须抛 Nest 的 `NotFoundException` —— 抛裸 `Error` + `status` 字段
    // 会变成 500（异常过滤器不认那个字段）。第一次部署就踩了这个坑。
    if (expected === null) {
      throw new NotFoundException('未启用');
    }

    const record = (body ?? {}) as Record<string, unknown>;
    const username = typeof record['username'] === 'string' ? record['username'] : '';
    const password = typeof record['password'] === 'string' ? record['password'] : '';

    // 两个比较都要做，不短路 —— 否则"用户名错了"会比"密码错了"快，
    // 攻击者能据此枚举用户名是否存在
    const userOk = safeEqual(username, expected.username);
    const passOk = safeEqual(password, expected.password);

    if (!userOk || !passOk) {
      this.logger.warn(`边缘登录失败 username=${username.slice(0, 32)}`);
      throw new UnauthorizedException('用户名或密码错误');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + EDGE_JWT_TTL_SEC;

    // 用独立的 secret 派生（加 aud 前缀），保证它无法被业务侧 AuthGuard 验过
    const secret = `${this.config.get<string>('JWT_SECRET') ?? ''}|${EDGE_JWT_AUDIENCE}`;

    const token = signHs256(
      {
        sub: expected.username,
        aud: EDGE_JWT_AUDIENCE,
        iat: nowSec,
        exp: expSec,
        scope: 'edge:read',
      },
      secret,
    );

    return {
      token,
      expiresAt: new Date(expSec * 1000).toISOString(),
      expiresInSec: EDGE_JWT_TTL_SEC,
    };
  }
}

/** 供中间件复用：验证 edge JWT 的签名与过期 */
@Injectable()
export class EdgeTokenVerifier {
  constructor(private readonly config: ConfigService) {}

  verify(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, body, signature] = parts as [string, string, string];

    const secret = `${this.config.get<string>('JWT_SECRET') ?? ''}|${EDGE_JWT_AUDIENCE}`;
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (!safeEqual(signature, expected)) return false;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        aud?: unknown;
        exp?: unknown;
      };
      if (payload.aud !== EDGE_JWT_AUDIENCE) return false;
      if (typeof payload.exp !== 'number') return false;
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }
}
