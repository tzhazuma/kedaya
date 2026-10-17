/**
 * TechPie 整合 · 控制器（规格 §8.1 的 8 个端点 + §11.22-C 登记的兑换端 = 第 9 个）
 *
 * 前缀 `/api/v1/techpie`，**全部需要登录**（否则 `401 UNAUTHENTICATED`）。
 *
 * | # | 方法 | 路径 | 说明 |
 * | --- | --- | --- | --- |
 * | 1 | `GET` | `/links` | 列出我的全部绑定（`TechpieLink[]`，**不含凭证**） |
 * | 2 | `POST` | `/links` | 发起绑定（Phase 0 只接受 `ecard` + `authCode`） |
 * | 3 | `GET` | `/links/:id` | 绑定详情 |
 * | 4 | `DELETE` | `/links/:id` | 解绑（**硬删**凭证副本） |
 * | 5 | `POST` | `/links/:id/renew` | 手动续期（契约 §11.2 冻结 action） |
 * | 6 | `GET` | `/capabilities` | 能力清单（含未绑定项的**引导**，不是报错） |
 * | 7 | `GET` | `/sync-jobs` | 我的同步任务状态（游标分页） |
 * | 8 | `POST` | `/webview-session` | 换取**一次性**票据（I3 的唯一出口） |
 * | 9 | `POST` | `/webview-session/:ticket` | 用票据换一次性打开地址（**用后即焚**） |
 *
 * ## 第 9 个端点为什么存在（契约 §11.22-C）
 *
 * 规格 §8.4 的"票据语义"表明确写了换取方式（客户端用票据换一次性 URL）。
 * 早期冻结 OpenAPI 只登记了签发端；没有兑换端，票据**根本用不掉** ——
 * 这是契约自身的缺口，不是实现多余。§11.22-C 已把它登记为**正式端点**。
 *
 * ## ✅ 本轮的收敛（§11.20-E 要求的正是这里）
 *
 * 上一轮为兼容三方，本文件在**入参与出参上都返回了并集**（加法兼容别名）。
 * §11.20-D 已裁决**全部移除** —— 理由是加法兼容"把一个概念变成两个 owner"：
 * 两个名字会永久共存、消费方会分裂、并把不一致从编译期推到运行期。
 *
 * 现在的形状：
 *   · 入参**只收** `{provider, authCode}` / `{linkId?, targetUrl}`；
 *   · 平台枚举**只有一套** `cas | egate | cpdaily | jwc | ecard | techpie`（§11.20-C）；
 *   · 出参**只有一个名字**（`capabilities` / `expiresAt` / `provider` …）。
 *
 * ⚠️ 两个请求 schema 都是 **`.strict()`**：带旧别名（`platform` / `provider` 之外的
 * 兼容写法、`credential`、`openid`、`expiresInSec` 请求侧对应物）的请求会得到
 * **400 `VALIDATION_FAILED`**，而**不是**被静默忽略。
 * 静默忽略才是真正的危险：客户端以为自己在指定平台，服务端其实没读。
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
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { WebviewSessionService } from './data/webview-session/webview-session.service';
import { TechpieService } from './techpie.service';

/** 校园平台枚举（契约 §11.20-C 统一后的**唯一**一套）。 */
const platformEnum = z.enum(['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie']);

/**
 * `POST /techpie/links` 的入参（冻结 OpenAPI `TechpieLinkCreate`）。
 *
 * ⚠️ **只有两个键**：`provider` + `authCode`。
 *   · `platform` 别名已删除（§11.20-D）；
 *   · `credential` / `openid` 别名已删除 —— §11.19-B 已把字段定为 `authCode`
 *     （**一次性**凭证交换码，不是任何长期标识）；
 *   · 明文密码在 wire 上**没有位置**：U12 的拒绝因此是**结构性**的
 *     （`.strict()` 直接拒绝，服务端连读都不读），比"读了再拒"更强。
 */
const createLinkSchema = z
  .object({
    provider: platformEnum,
    authCode: z.string().min(1).max(512),
  })
  .strict();

/**
 * `POST /techpie/webview-session` 的入参（契约 §11.20-E / §11.22-D）。
 *
 * · **只收** `{linkId, targetUrl}` —— `platform` / `provider` 兼容写法已删除；
 * · `linkId` 是**可选**的：W4 直连**不要求绑定**（§11.21-D 的原话 ——
 *   "要求先绑定才能直连，等于给一个不需要权限的功能加了权限门"）；
 * · `targetUrl` 必填，且在**服务端**做 fail-closed 白名单校验（§11.18-B 第 4 条）。
 */
const webviewSessionSchema = z
  .object({
    linkId: z.string().min(1).max(64).optional(),
    targetUrl: z.string().min(1).max(2048),
  })
  .strict();

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
    summary: '列出我的全部绑定（`TechpieLink[]`，**不含任何凭证**）',
    description:
      '元素用 `provider`（不是 `platform`），状态用 `PENDING|ACTIVE|EXPIRED|REVOKED|FAILED`（§11.19-A / §11.20-A）。' +
      '响应里不出现对端标识与凭证 —— 投影是逐字段白名单。',
  })
  listLinks(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.listLinks(userId, { cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  /* ---------------- 2. 发起绑定 ---------------- */

  @Post('links')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '发起绑定（Phase 0 **只接受** `ecard` + `authCode`）',
    description:
      '需要 CASTGC 的平台（egate / cpdaily / jwc / cas / techpie）**没有任何绑定路径** —— ' +
      '它们阻塞于信息办对「学校是否允许第三方代持校园会话」的**书面回复**（U7）。' +
      '明文密码在 wire 上**没有位置**（U12：结构性拒绝，强于读了再拒）。',
  })
  createLink(@CurrentUser() userId: string, @ZodBody(createLinkSchema) body: z.infer<typeof createLinkSchema>) {
    return this.service.createLink(userId, { provider: body.provider, authCode: body.authCode });
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
      '响应**只有 `capabilities` 一个名字**（§11.20-D 删掉了同值的 `items` 别名）；' +
      '条目**只有单一键名**（`key` / `available` / `requiredProvider` / `blockedReason` …）；' +
      '`allowlistPlaceholder` 机器可见地标注「校园域名白名单内容仍是占位」（U11）。',
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
      '`targetUrl` 在**服务端**做 fail-closed 白名单校验（契约 §11.18-B + §11.21-A）：' +
      '白名单条目是**完整 origin** 且做**精确匹配**（scheme + host + port 三者全等）；' +
      '不在白名单 → `403 FORBIDDEN`；非 https → `422`；' +
      '禁止 IP 字面量 / `@` userinfo / 通配子域。' +
      '出参**只有** `{ticket, targetUrl, expiresAt, singleUse}`（§11.20-E：删掉 `expiresInSec` 与 `targetHost`）。' +
      '票据 30 秒、一次性、绑定 host，且**不含任何 cookie**（它是引用，不是凭证）。',
  })
  createWebviewSession(
    @CurrentUser() userId: string,
    @ZodBody(webviewSessionSchema) body: z.infer<typeof webviewSessionSchema>,
  ) {
    return this.webview.issue(userId, { linkId: body.linkId, targetUrl: body.targetUrl });
  }

  /* ---------------- 9. 票据兑换 ---------------- */

  @Post('webview-session/:ticket')
  @HttpCode(200)
  @ApiOperation({
    summary: '用票据换**一次性打开地址**（用后即焚）',
    description:
      'Phase 0 返回 `mode: "direct"`（规格 §8.4 方案 W4）：让用户在校园系统页面**自己登录**，' +
      '可达鸭**不接触** cookie。`cookieInjected` **恒为 false** —— ' +
      '该字段存在的意义是让"我们没注入 cookie"这件事**可被机器断言**，而不是靠文档承诺。' +
      '`mode: "injected"` 需要信息办书面确认后才可能启用（Phase 2）。' +
      '⚠️ 票据一次性：兑换成功后立即作废，**重复兑换必须失败**（404）。',
  })
  redeemWebviewSession(@CurrentUser() userId: string, @Param('ticket') ticket: string) {
    return this.webview.redeem(userId, ticket);
  }
}
