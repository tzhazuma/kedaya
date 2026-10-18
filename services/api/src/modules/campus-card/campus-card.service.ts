/**
 * 校园卡 · 用例层（契约 §11.21-B）
 *
 * 只编排、不含 IO（契约 §7）。依赖通过**显式 token** 注入
 * （而非 `design:paramtypes`），这样在 vitest 等不做 emitDecoratorMetadata
 * 的转译器下 DI 依然成立。
 *
 * ## 第二级身份的落点（契约 §5 硬规则 3 / 不变式 I4）
 *
 * 校园卡能力属于**第二级**：已登录但未绑定 → **409 `CAMPUS_BINDING_REQUIRED`**
 * （**不是** 401 —— 401 会让客户端去重新登录，而用户其实已经登录了）。
 *
 * 校园卡走**独立的 OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦 ——
 * 因此这里只需要"`ecard` 绑定是否 `ACTIVE`"，**不需要**任何校园会话本身。
 *
 * ## 余额从哪来（诚实说明）
 *
 * 契约**没有**单独的余额表：§11.19-D 接受"用最新一条流水的 `balanceAfterFen`
 * **推导**余额"。因此 `account()` 读最新一条流水，**不发明**新的持久化形状。
 * 没有任何流水时余额是 `0`，且 `updatedAt` **省略该键**（§11.22-D）。
 *
 * ## 付款码：形状已定，通道未通（§11.21-B）
 *
 * **裁决：现在登记该端点**（形状由 §11.21-B 确定），
 * 但**在真实校园卡通道打通前，服务端返回 `UPSTREAM_UNAVAILABLE` 而不是假数据**。
 * `CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY = false` 让这件事**机器可见** ——
 * 而不是靠一句注释。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  CampusBindingRequiredError,
  UpstreamUnavailableError,
} from '../../common/errors/app-error';
import {
  CAMPUS_SESSION_PORT,
  isActiveLinkStatus,
  translateCampusSessionError,
  type CampusSessionPort,
} from '../techpie/domain/ports/campus-session.port';
import {
  CAMPUS_CARD_PAYMENT_CODE_TTL_SEC,
  CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY,
  CAMPUS_CARD_TRANSACTION_REPOSITORY,
  type CampusCardAccount,
  type CampusCardListParams,
  type CampusCardTransaction,
  type CampusCardTransactionModel,
  type CampusCardTransactionRepository,
  type CampusCardUnbindResult,
} from './domain/campus-card.domain';

/** 校园卡对应的校园平台（契约 §11.20-C 统一枚举里的 `ecard`） */
export const CAMPUS_CARD_PROVIDER = 'ecard' as const;

@Injectable()
export class CampusCardService {
  constructor(
    @Inject(CAMPUS_CARD_TRANSACTION_REPOSITORY) private readonly repo: CampusCardTransactionRepository,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
  ) {}

  /* ---------------- GET /campus-card/account ---------------- */

  /**
   * 账户：`{activated, balanceFen, updatedAt?}`。
   *
   * ⚠️ 余额是**推导**出来的（最新一条流水的 `balanceAfterFen`），
   * 契约**没有**独立余额表 —— 见文件头说明。
   */
  async account(userId: string): Promise<CampusCardAccount> {
    await this.requireActiveBinding(userId);

    const latest = await this.repo.latestByUser(userId);
    const account: CampusCardAccount = {
      activated: true,
      balanceFen: latest?.balanceAfterFen ?? 0,
      // 上游同步未接线（fetchCard 无调用点）⇒ 这份余额是本地推导的，
      // 必须标 simulated，否则用户会把 0 当成真实余额。
      simulated: true,
      dataSource: 'local',
    };
    // §11.22-D：为空则**省略键**，不下发 `null`
    if (latest) account.updatedAt = latest.occurredAt.toISOString();
    return account;
  }

  /* ---------------- POST /campus-card/account/activate ---------------- */

  /**
   * 开通（**OPENID 通道**，与 CASTGC 完全解耦，§11.21-B）。
   *
   * 走与 `POST /techpie/links` **同一份**绑定实现（`CampusSessionPort.bind`），
   * 因此合规闸门（Phase 0 只允许 `ecard`、明文密码一律拒绝）**只有一处**。
   * 错误翻译也复用 `translateCampusSessionError` —— 否则 `PHASE_BLOCKED`
   * 会变成 500（客户端会以为服务坏了，而真实语义是"这条路本轮不开放"）。
   */
  async activate(userId: string, authCode: string): Promise<CampusCardAccount> {
    try {
      await this.campusSession.bind(userId, CAMPUS_CARD_PROVIDER, {
        kind: 'openid',
        channel: 'wechat',
        authCode,
      });
    } catch (error) {
      throw translateCampusSessionError(error);
    }
    return this.account(userId);
  }

  /* ---------------- DELETE /campus-card/account ---------------- */

  /**
   * 解绑/注销。
   *
   * **硬删**凭证副本（`CampusSession` 整行）—— 见 `CampusSessionPort.unbind`。
   * 幂等：本来就没绑定时也返回成功（"注销一个已注销的账户"不是错误）。
   */
  async deactivate(userId: string): Promise<CampusCardUnbindResult> {
    try {
      await this.campusSession.unbind(userId, CAMPUS_CARD_PROVIDER);
    } catch (error) {
      throw translateCampusSessionError(error);
    }
    return { activated: false, unbound: true };
  }

  /* ---------------- GET /campus-card/transactions ---------------- */

  /** 流水（游标分页，最新在前）。字段名按 §11.21-B：`occurredAt` / `DEBIT|CREDIT`。 */
  async transactions(
    userId: string,
    params: CampusCardListParams,
  ): Promise<Page<CampusCardTransaction>> {
    await this.requireActiveBinding(userId);
    const page = await this.repo.listByUser(userId, params);
    return { items: page.items.map(toTransactionWire), nextCursor: page.nextCursor };
  }

  /* ---------------- GET /campus-card/payment-code ---------------- */

  /**
   * 付款码：`{code, expiresAt}` —— **短时效**。
   *
   * ⚠️ 裁决 §11.21-B：形状已定，但**真实通道未打通** →
   * `UPSTREAM_UNAVAILABLE`（503），**不给假数据**。
   * `details.upstreamReady = false` 与 `details.reason` 让这件事**机器可见**。
   *
   * 付款码是**凭证**（§10.3）：本模块**没有任何日志语句**，
   * 因此付款码值**不可能**进日志；控制器另外下发 `Cache-Control: no-store`。
   */
  async paymentCode(userId: string): Promise<never> {
    await this.requireActiveBinding(userId);

    throw new UpstreamUnavailableError(
      '校园卡付款码通道尚未打通（真实上游未接通）。可达鸭不会返回一个假的付款码。',
      {
        reason: 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED',
        // 机器可见：不是"暂不可用"的含糊说法，而是一个可断言的布尔值
        upstreamReady: CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY,
        ttlSec: CAMPUS_CARD_PAYMENT_CODE_TTL_SEC,
        blockedBy: ['U7', 'U11'],
      },
    );
  }

  /* ---------------- 内部 ---------------- */

  /**
   * 第二级绑定闸门：`ecard` 绑定必须 `ACTIVE`，否则 **409 `CAMPUS_BINDING_REQUIRED`**。
   *
   * 判定只走 `isActiveLinkStatus`（§11.19-A 的唯一谓词），
   * 因此不会出现 `=== 'LINKED'` 这种旧拼法散落各处。
   */
  private async requireActiveBinding(userId: string): Promise<void> {
    const binding = await this.campusSession.getBinding(userId, CAMPUS_CARD_PROVIDER);
    if (!binding || !isActiveLinkStatus(binding.status)) {
      throw new CampusBindingRequiredError(
        '请先开通校园卡（ecard · OPENID 通道）后再使用该功能',
        {
          provider: CAMPUS_CARD_PROVIDER,
          status: binding?.status ?? 'UNBOUND',
          // 机器可读：这不是认证问题，客户端应**跳开通引导**而不是跳登录页
          next: 'GO_ACTIVATE',
        },
      );
    }
  }
}

/** 领域模型 → wire 流水（**唯一**的投影实现） */
export function toTransactionWire(model: CampusCardTransactionModel): CampusCardTransaction {
  return {
    id: model.id,
    amountFen: model.amountFen,
    direction: model.direction,
    balanceAfterFen: model.balanceAfterFen,
    occurredAt: model.occurredAt.toISOString(),
    merchant: model.merchant,
  };
}
