/**
 * TechPie 整合 · 控制器（规格 §8.1 的 8 个端点 + 票据兑换）
 *
 * 前缀 `/api/v1/techpie`，**全部需要登录**（否则 `401 UNAUTHENTICATED`）。
 *
 * | # | 方法 | 路径 | 说明 |
 * | --- | --- | --- | --- |
 * | 1 | `GET` | `/links` | 列出我的全部绑定（`CampusBindingSummary[]`，**不含凭证**） |
 * | 2 | `POST` | `/links` | 发起绑定（Phase 0 只接受 `ecard` + `openid`） |
 * | 3 | `GET` | `/links/:id` | 绑定详情 |
 * | 4 | `DELETE` | `/links/:id` | 解绑（**硬删**凭证副本） |
 * | 5 | `POST` | `/links/:id/renew` | 手动续期（契约 §11.2 冻结 action） |
 * | 6 | `GET` | `/capabilities` | 能力清单（含未绑定项的 `CAMPUS_BINDING_REQUIRED` **引导**） |
 * | 7 | `GET` | `/sync-jobs` | 我的同步任务状态（游标分页） |
 * | 8 | `POST` | `/webview-session` | 换取**一次性**票据（I3 的唯一出口） |
 * | 9 | `POST` | `/webview-session/:ticket` | 用票据换一次性打开地址（规格 §8.4「换取方式」） |
 *
 * ## 第 9 个端点为什么存在
 *
 * 规格 §8.4 的"票据语义"表明确写了换取方式（客户端用票据换一次性 URL）。
 * 冻结 OpenAPI 只登记了签发端；这里补上兑换端，否则票据**用不掉**。
 * 它同样不返回任何 cookie（Phase 0 走 W4：用户自登录）。
 *
 * ## ⚠️ 关于请求/响应字段的"并集"
 *
 * 仓库里**同时存在两套互相矛盾的 techpie wire 形状**（已提交的冻结 OpenAPI
 * 与三端客户端各自的模型，见交付说明的未决问题）。为了让三端都不被打断，
 * 本控制器**接受**两种入参写法、**返回**两套同义字段。Lead 收敛契约后应删掉一半。
 * 这是**已知的技术债**，不是设计品味 —— 每一处都标了注释。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { WebviewSessionService } from './data/webview-session/webview-session.service';
import { CAMPUS_PLATFORMS } from './domain/ports/campus-session.port';
import { TechpieService } from './techpie.service';

/** 平台枚举（契约 §11.10-B 冻结值）。`platform`（三端）与 `provider`（OpenAPI）都接受。 */
const platformEnum = z.enum(['cas', 'egate', 'cpdaily', 'ecard', 'techpie']);

/**
 * `POST /links` 的入参。
 *
 * 三种写法都接受（**并集**，见文件头说明）：
 *   · `{ platform, credential: { kind:'openid', channel:'wechat', openId } }` —— Web / 移动端；
 *   · `{ provider, openid }` —— 冻结 OpenAPI 的扁平写法；
 *   · `{ platform, credential: { kind:'password', ... } }` —— **服务端一律拒绝**（U12）。
 */
const createLinkSchema = z
  .object({
    platform: platformEnum.optional(),
    provider: platformEnum.optional(),
    credential: z
      .object({
        kind: z.enum(['openid', 'password']),
        channel: z.string().min(1).max(32).optional(),
        openId: z.string().min(1).max(512).optional(),
        studentId: z.string().max(128).optional(),
        password: z.string().max(512).optional(),
      })
      .optional(),
    openid: z.string().min(1).max(512).optional(),
  })
  .refine((value) => value.platform !== undefined || value.provider !== undefined, {
    message: '必须提供 platform（或兼容写法 provider）',
    path: ['platform'],
  })
  .refine((value) => value.credential !== undefined || value.openid !== undefined, {
    message: '必须提供 credential（或兼容写法 openid）',
    path: ['credential'],
  });

const webviewSessionSchema = z
  .object({
    platform: platformEnum.optional(),
    provider: platformEnum.optional(),
    linkId: z.string().min(1).max(64).optional(),
    targetUrl: z.string().min(1).max(2048),
  })
  .refine((value) => value.targetUrl.trim().length > 0, {
    message: 'targetUrl 不能为空',
    path: ['targetUrl'],
  });

@ApiTags('techpie · TechPie 整合（Phase 0）')
@Controller(modulePath('techpie'))
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class TechpieController {
  constructor(
    @Inject(TechpieService) private readonly service: TechpieService,
    @Inject(WebviewSessionService) private readonly webview: WebviewSessionService,
  ) {}

  /* ---------------- 1. 绑定列表 ---------------- */

  @Get('links')
  @ApiOperation({
    summary: '列出我的全部绑定（`CampusBindingSummary[]`，**不含任何凭证**）',
    description:
      '契约 §11.4 I1 的镜像断言：响应里绝不出现 cookie / session / tgc / castgc / ticket / tenant。',
  })
  listLinks(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.listLinks(userId, { cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  /* ---------------- 2. 发起绑定 ---------------- */

  @Post('links')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '发起绑定（Phase 0 **只接受** `ecard` + `openid`）',
    description:
      '需要 CASTGC 的平台（egate / cpdaily / cas / techpie）**没有任何绑定路径** —— ' +
      '它们阻塞于信息办对「学校是否允许第三方代持校园会话」的**书面回复**（U7）。' +
      '明文密码一律拒绝（U12）。',
  })
  createLink(@CurrentUser() userId: string, @ZodBody(createLinkSchema) body: z.infer<typeof createLinkSchema>) {
    return this.service.createLink(userId, {
      platform: body.platform ?? body.provider,
      credential: normalizeCredential(body),
    });
  }

  /* ---------------- 3. 绑定详情 ---------------- */

  @Get('links/:id')
  @ApiOperation({ summary: '绑定详情（**不含凭证**；非本人 404）' })
  getLink(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.getLink(userId, id);
  }

  /* ---------------- 4. 解绑 ---------------- */

  @Delete('links/:id')
  @ApiOperation({
    summary: '解绑（**真正删除**凭证副本，而不只是标记失效）',
    description: '对齐 `05-security-privacy.md:458`：解绑即硬删 `CampusSession` 整行。',
  })
  deleteLink(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.deleteLink(userId, id);
  }

  /* ---------------- 5. 手动续期（契约 §11.2 冻结 action） ---------------- */

  @Post('links/:id/renew')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '手动续期（契约 §11.2 冻结 action：`renew`）',
    description:
      'Phase 0 下上游**没有**续期能力（规格 §6.3 R4 / U8）→ `409 CONFLICT` + ' +
      '`details.reason = "RENEW_NOT_SUPPORTED"`。**绝不谎称已续期**（失败模式 F3）。',
  })
  renewLink(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.renewLink(userId, id);
  }

  /* ---------------- 6. 能力清单 ---------------- */

  @Get('capabilities')
  @ApiOperation({
    summary: '当前用户可用的校园能力清单（未绑定项给**引导**，不是报错）',
    description:
      '契约 §5 硬规则 3 / ADR §5.4：`CAMPUS_BINDING_REQUIRED` 是**合法状态**的呈现。' +
      '响应里的 `allowlistPlaceholder` 机器可见地标注「校园域名白名单内容仍是占位」（U11）。',
  })
  capabilities(@CurrentUser() userId: string) {
    return this.service.capabilities(userId);
  }

  /* ---------------- 7. 同步任务 ---------------- */

  @Get('sync-jobs')
  @ApiOperation({ summary: '我的同步任务状态（游标分页，契约 §6.1）' })
  listSyncJobs(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.listSyncJobs(userId, { cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  /* ---------------- 8. 换取一次性票据（I3 的唯一出口） ---------------- */

  @Post('webview-session')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '换取**一次性** WebView 票据（契约不变式 I3 的唯一出口）',
    description:
      '`targetUrl` 在**服务端**做 fail-closed 白名单校验（契约 §11.18-B）：' +
      '不在白名单 → `403 FORBIDDEN`；只允许 https（否则 422）；' +
      '禁止 IP 字面量 / 非 443 端口 / `@` userinfo；**不做**后缀通配。' +
      '票据 30 秒、一次性、绑定 host，且**不含任何 cookie**（它是引用，不是凭证）。',
  })
  createWebviewSession(
    @CurrentUser() userId: string,
    @ZodBody(webviewSessionSchema) body: z.infer<typeof webviewSessionSchema>,
  ) {
    return this.webview.issue(userId, {
      platform: body.platform,
      provider: body.provider,
      linkId: body.linkId,
      targetUrl: body.targetUrl,
    });
  }

  /* ---------------- 9. 票据兑换 ---------------- */

  @Post('webview-session/:ticket')
  @HttpCode(200)
  @ApiOperation({
    summary: '用票据换**一次性打开地址**（用后即焚）',
    description:
      'Phase 0 返回 `mode: "direct"`（规格 §8.4 方案 W4）：让用户在校园系统页面**自己登录**，' +
      '可达鸭**不接触** cookie。`mode: "injected"` 需要信息办书面确认后才可能启用（Phase 2）。',
  })
  redeemWebviewSession(@CurrentUser() userId: string, @Param('ticket') ticket: string) {
    return this.webview.redeem(userId, ticket);
  }
}

/**
 * 把"并集"入参归一成端口要的 `BindCredential`。
 *
 * ⚠️ 明文密码分支**不搬运** `studentId` / `password` —— 它们连**读**都不读
 * （规格 §10.3：明文密码绝不落库、绝不落日志）。
 */
function normalizeCredential(body: {
  credential?: { kind: 'openid' | 'password'; channel?: string; openId?: string };
  openid?: string;
}): unknown {
  if (body.credential) {
    if (body.credential.kind === 'password') return { kind: 'password' };
    return { kind: 'openid', channel: body.credential.channel ?? 'wechat', openId: body.credential.openId ?? '' };
  }
  if (body.openid !== undefined) return { kind: 'openid', channel: 'wechat', openId: body.openid };
  throw new ValidationError('缺少绑定凭证', { reason: 'INVALID_CREDENTIAL', supported: [...CAMPUS_PLATFORMS] });
}
