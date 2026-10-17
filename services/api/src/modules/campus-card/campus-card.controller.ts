/**
 * 校园卡 · 控制器（契约 §11.21-B 的**五条**端点）
 *
 * | 方法 | 路径 | 说明 |
 * | --- | --- | --- |
 * | `GET` | `/campus-card/account` | 账户：`{activated, balanceFen, updatedAt?}` |
 * | `POST` | `/campus-card/account/activate` | 开通（**OPENID 通道**，与 CASTGC 完全解耦） |
 * | `DELETE` | `/campus-card/account` | 解绑/注销 |
 * | `GET` | `/campus-card/transactions` | 流水（游标分页） |
 * | `GET` | `/campus-card/payment-code` | 付款码 `{code, expiresAt}`（**短时效**） |
 *
 * ## ⚠️ 本文件是**重写**的，不是脚手架生成的
 *
 * 上一轮它是 `scripts/scaffold.mjs` 生成的通用 CRUD
 * （`@Get('items')` / `@Post('items')` / `@Patch('items/:id')` / `@Get('summary')`），
 * 而 `summary` 是**汇总**不是余额。四端各写一套路由，**端到端必然 404**。
 * §11.21-B 已按上表重做，并把 `campus-card` **移出 SPEC 表**
 * （否则 `npm run scaffold` 会把这里的手写实现覆盖回去 —— 由
 * `test/campus-card-http.spec.ts` 的架构断言钉死）。
 *
 * ## 字段名裁决（取代 scaffold 形状）
 *
 * · `direction` 用 **`DEBIT` / `CREDIT`**（大写）—— `out`/`in` 有方向歧义；
 * · 时间用 **`occurredAt`**（不是 `happenedAt`）—— 与全仓"发生时刻 vs 入库时刻"一致；
 * · 余额用 **`balanceFen`**（不是 `summary`）—— "汇总"与"余额"是两个概念；
 * · **金额一律整数分**。
 *
 * ## 安全约束
 *
 * · 全部端点需要一级身份（`AuthGuard`）→ 否则 `401 UNAUTHENTICATED`；
 * · 第二级未绑定 → **`409 CAMPUS_BINDING_REQUIRED`**（**不是** 401，不变式 I4）；
 * · 付款码**禁止缓存**（`Cache-Control: no-store`）且**禁止进日志** ——
 *   本模块**没有任何日志语句**，因此付款码值不可能进日志（§10.3）。
 */

import {
  Controller,
  Delete,
  Get,
  Header,
  Inject,
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
import { CampusCardService } from './campus-card.service';

/**
 * `POST /campus-card/account/activate` 的入参。
 *
 * ⚠️ 字段是 **`authCode`**（§11.19-B）：`wx.login()` 的**一次性 code**，
 * **不是** openid（小程序在密码学上拿不到 openid）。
 * `.strict()`：明文密码 / `credential` 等旧形状**结构性拒绝**（U12）。
 */
const activateSchema = z
  .object({
    authCode: z.string().min(1).max(512),
  })
  .strict();

@ApiTags('campus-card · 校园卡')
@Controller(modulePath('campus-card'))
// 契约 §5 硬规则 3 / 不变式 I4：未登录 → 401；**已登录但未开通 → 409 CAMPUS_BINDING_REQUIRED**。
// 绑定闸门在 service 里（`requireActiveBinding`），因为它需要区分"哪个平台的绑定"。
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class CampusCardController {
  constructor(@Inject(CampusCardService) private readonly service: CampusCardService) {}

  /* ---------------- 账户 ---------------- */

  @Get('account')
  @ApiOperation({
    summary: '账户：`{activated, balanceFen, updatedAt?}`（金额整数分）',
    description:
      '`balanceFen` 是**余额**（不是 `summary` 汇总），由最新一条流水的 `balanceAfterFen` 推导（§11.19-D 接受该推导）。' +
      '没有流水时 `updatedAt` **省略该键**（§11.22-D：为空省略键，不下发 `null`）。',
  })
  account(@CurrentUser() userId: string) {
    return this.service.account(userId);
  }

  @Post('account/activate')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '开通校园卡（**OPENID 通道**，与 CASTGC 完全解耦）',
    description:
      '入参只有 `{authCode}`（`wx.login()` 的一次性 code，§11.19-B）。' +
      'Phase 0 只允许 `ecard`；需要 CASTGC 的平台一律 `403 FORBIDDEN`（U7）；明文密码结构性拒绝（U12）。' +
      '与 `POST /techpie/links` 走**同一份**绑定实现，因此合规闸门只有一处。',
  })
  activate(@CurrentUser() userId: string, @ZodBody(activateSchema) body: z.infer<typeof activateSchema>) {
    return this.service.activate(userId, body.authCode);
  }

  @Delete('account')
  @ApiOperation({
    summary: '解绑/注销（**硬删**凭证副本，而不只是标记失效）',
    description: '幂等：本来就没开通时也返回成功。',
  })
  deactivate(@CurrentUser() userId: string) {
    return this.service.deactivate(userId);
  }

  /* ---------------- 流水 ---------------- */

  @Get('transactions')
  @ApiOperation({
    summary: '流水（游标分页，最新在前）',
    description:
      '元素字段：`{id, amountFen, direction: DEBIT|CREDIT, balanceAfterFen, occurredAt, merchant}`（§11.21-B）。' +
      '⚠️ 时间字段是 `occurredAt`（**交易发生时刻**），不是 `happenedAt`；方向是大写 `DEBIT`/`CREDIT`。',
  })
  transactions(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.transactions(userId, {
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
    });
  }

  /* ---------------- 付款码 ---------------- */

  @Get('payment-code')
  // 付款码是**凭证**：绝不允许任何中间层缓存它（§10.3 / §11.21-B）
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: '付款码 `{code, expiresAt}`（**短时效**，禁止缓存、禁止进日志）',
    description:
      '⚠️ **真实通道打通前返回 `UPSTREAM_UNAVAILABLE`（503），不给假数据**（§11.21-B 的原话）。' +
      '`details.upstreamReady = false` 让这件事**机器可见**。' +
      '响应带 `Cache-Control: no-store`；本模块没有任何日志语句，因此付款码值不可能进日志。',
  })
  paymentCode(@CurrentUser() userId: string) {
    return this.service.paymentCode(userId);
  }
}
