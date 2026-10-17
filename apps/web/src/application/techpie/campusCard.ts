/**
 * 用例：校园卡（**独立 OPENID 通道**，规格 §2.5 / §3.3）。
 *
 * ⚠️ 校园卡**不依赖 CASTGC**（§2.5 的关键发现）：它走 eCard 的 OPENID 会话，
 * 与 eGate/CpDaily 的校园会话是两条链路。因此 Phase 0 可以零合规风险落地。
 *
 * 三条硬规则（`02-domain-model.md:1040` / `06-roadmap.md:133` A1.6）：
 * 1. 付款码 60 秒过期，**旧码立即失效**（每次申请都是新码）；
 * 2. 付款码**不进日志、不进审计正文**（审计只记 `ISSUED` / `REVOKE` 动作）；
 * 3. 客户端**不得缓存**付款码 —— 由 `PaymentCodeHolder` 在内存里持有一次。
 *
 * ⚠️ 未绑定时服务端返回 `CAMPUS_BINDING_REQUIRED`（409），
 * 这是**合法状态**：页面给"去绑定"引导，不给红色报错（契约 §5 硬规则 3）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, fenToSignedYuan, fenToYuan, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  CAMPUS_CARD_STATUS_LABELS,
  CARD_TRANSACTION_KIND_LABELS,
  bindingRequiredGuidance,
  paymentCodeRemainingSec,
  type CampusCard,
  type CampusCardStatus,
  type CardTransaction,
  type PaymentCode,
} from '@/domain/models/techpie';
import type { CampusCardRepository } from '@/domain/ports/techpie';

import { deriveViewState, type ViewState } from '../viewState';

/**
 * 校园卡的视图状态 = 通用四态 + `binding_required`。
 *
 * 为什么单独一个状态而不是复用 `error`：`CAMPUS_BINDING_REQUIRED` 是
 * **合法状态**（用户已登录、只是没绑卡），UI 要展示"去绑定"的引导；
 * 而 `error` 要展示"重试"。两者的动作完全不同，混在一起必然误导用户。
 */
export type CampusCardViewState = ViewState | 'binding_required';

export function campusCardState(input: {
  isPending: boolean;
  isError: boolean;
  errorCode?: ApiError['code'] | undefined;
  isEmpty?: boolean;
}): CampusCardViewState {
  if (input.isPending) return 'loading';
  if (input.isError) {
    return input.errorCode === 'CAMPUS_BINDING_REQUIRED' ? 'binding_required' : 'error';
  }
  if (input.isEmpty) return 'empty';
  return 'ready';
}

const CARD_STATUS_TONES: Record<
  CampusCardStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  ACTIVE: 'success',
  FROZEN: 'warning',
  LOST: 'danger',
  CLOSED: 'neutral',
};

export interface CampusCardVM {
  cardNoMasked: string;
  balanceLabel: string;
  status: CampusCardStatus;
  statusLabel: string;
  statusTone: 'success' | 'warning' | 'danger' | 'neutral';
  syncedLabel: string;
  /** 卡状态异常（冻结/挂失/销户）时的显式说明 */
  notice: string | null;
}

export function toCampusCardVM(card: CampusCard, options: { now: Date }): CampusCardVM {
  let notice: string | null = null;
  if (card.status === 'FROZEN') notice = '校园卡已冻结，付款码不可用。请先在学校侧解冻。';
  if (card.status === 'LOST') notice = '校园卡已挂失，付款码不可用。';
  if (card.status === 'CLOSED') notice = '校园卡已销户。';
  return {
    cardNoMasked: card.cardNoMasked,
    balanceLabel: `¥${fenToYuan(card.balanceFen)}`,
    status: card.status,
    statusLabel: CAMPUS_CARD_STATUS_LABELS[card.status],
    statusTone: CARD_STATUS_TONES[card.status],
    syncedLabel: formatRelativeTime(card.syncedAt, options.now) || '刚刚同步',
    notice,
  };
}

export interface TransactionVM {
  id: string;
  occurredLabel: string;
  /** 带符号金额：`-12.50` / `+200.00`（**分**只在展示层转元） */
  amountLabel: string;
  merchantLabel: string;
  kindLabel: string;
  isExpense: boolean;
}

export function toTransactionVM(tx: CardTransaction, options: { now: Date }): TransactionVM {
  return {
    id: tx.id,
    occurredLabel: formatRelativeTime(tx.occurredAt, options.now) || '时间未知',
    amountLabel: fenToSignedYuan(tx.amountFen),
    merchantLabel: tx.merchant ?? '未知商户',
    kindLabel: CARD_TRANSACTION_KIND_LABELS[tx.kind],
    isExpense: tx.amountFen < 0,
  };
}

export interface TransactionListVM {
  items: TransactionVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  state: ViewState;
}

export function toTransactionListVM(
  page: Page<CardTransaction>,
  options: { now: Date; state?: ViewState },
): TransactionListVM {
  const items = page.items.map((tx) => toTransactionVM(tx, options));
  return {
    items,
    nextCursor: page.nextCursor,
    total: page.total ?? items.length,
    isEmpty: items.length === 0,
    state:
      options.state ??
      deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

/* ------------------------------------------------------------------ *
 * 付款码（凭证：不缓存 / 不落 URL / 不进日志）
 * ------------------------------------------------------------------ */

export type PaymentCodeState = 'empty' | 'issued' | 'consumed';

/**
 * 付款码持有者 —— **码值的唯一落点**。
 *
 * 与 `OneTimeTicketHolder` 同一套手法：私有字段 + `toJSON()` 只暴露状态，
 * 于是 `JSON.stringify(holder)` 拿不到码值，React DevTools 也看不到。
 * 页面组件在**卸载或离开时**调用 `clear()`（`02-domain-model.md` 的状态机：
 * `ISSUED --用户主动作废或退出页面--> REVOKED`）。
 */
export class PaymentCodeHolder {
  #payload: string | null = null;
  #expiresAt: string | null = null;
  #state: PaymentCodeState = 'empty';

  issue(code: PaymentCode): void {
    this.#payload = code.payload;
    this.#expiresAt = code.expiresAt;
    this.#state = 'issued';
  }

  /** 取走码值 —— 只能成功一次（用于展示后立即标记已用） */
  consume(): string | null {
    if (this.#state !== 'issued' || this.#payload === null) return null;
    const payload = this.#payload;
    this.#payload = null;
    this.#state = 'consumed';
    return payload;
  }

  /** 读取码值用于展示（**不**改变状态；调用方必须持有 `PaymentCodeVM` 而不是缓存它） */
  peek(): string | null {
    return this.#state === 'issued' ? this.#payload : null;
  }

  get state(): PaymentCodeState {
    return this.#state;
  }

  get expiresAt(): string | null {
    return this.#expiresAt;
  }

  clear(): void {
    this.#payload = null;
    this.#expiresAt = null;
    this.#state = 'empty';
  }

  /** 序列化时**只暴露状态与到期时刻**：码值不可能经由 JSON 泄漏 */
  toJSON(): { state: PaymentCodeState; expiresAt: string | null } {
    return { state: this.#state, expiresAt: this.#expiresAt };
  }
}

export interface PaymentCodeVM {
  /** 码值 —— 用于**屏幕展示**。绝不进日志/埋点/URL/storage */
  payload: string;
  issuedLabel: string;
  expiresLabel: string;
  remainingSec: number;
  expired: boolean;
  ttlSec: number;
}

export function toPaymentCodeVM(code: PaymentCode, options: { now: Date }): PaymentCodeVM {
  const remainingSec = paymentCodeRemainingSec(code, options.now);
  return {
    payload: code.payload,
    issuedLabel: formatRelativeTime(code.issuedAt, options.now) || '刚刚',
    expiresLabel: `${remainingSec} 秒后失效`,
    remainingSec,
    expired: remainingSec <= 0,
    ttlSec: code.ttlSec,
  };
}

/** 用例：申请付款码（**每次都是新码**，旧码立即失效） */
export async function issuePaymentCode(
  repository: CampusCardRepository,
  holder: PaymentCodeHolder,
): Promise<Result<PaymentCode, ApiError>> {
  const result = await repository.issuePaymentCode();
  if (!result.ok) return err(result.error);
  holder.issue(result.value);
  return ok(result.value);
}

/** 用例：作废付款码（退出页面 / 主动作废）—— 审计只记动作，不记码值 */
export async function revokePaymentCode(
  repository: CampusCardRepository,
  holder: PaymentCodeHolder,
): Promise<Result<{ revoked: true }, ApiError>> {
  holder.clear();
  return repository.revokePaymentCode();
}

/** 未绑定校园卡时的引导（**不是报错**） */
export function campusCardBindingGuidance(): string {
  return bindingRequiredGuidance('ecard');
}
