/**
 * 找搭子 · `BuddyPost` 状态机（契约 `02-domain-model.md:535-548` **冻结**，验收 T1）
 *
 * ```
 * [*] --> OPEN : 发布
 * OPEN --> FULL : 人数达上限
 * FULL --> OPEN : 有人退出
 * OPEN --> CLOSED : 发起人关闭
 * FULL --> CLOSED : 发起人关闭
 * OPEN --> EXPIRED : startsAt 已过
 * FULL --> EXPIRED : startsAt 已过
 * OPEN --> CANCELLED : 发起人取消
 * CLOSED --> [*]
 * EXPIRED --> [*]
 * CANCELLED --> [*]
 * ```
 *
 * 规则（契约 `02-domain-model.md:36` 规则 2）：状态流转**只**走本文件的纯函数，
 * Controller 里禁止直接 `prisma.buddyPost.update({ status })`（验收 T3）。
 *
 * ## 两处必须显式记录的判断
 *
 * 1. **`FULL → CANCELLED` 不在冻结图里**，因此本实现返回 `false`。
 *    后果：`DELETE /items/:id`（语义 = 取消 → `CANCELLED`，规格 §5.2）
 *    对一个已满的帖子会返回 409。这是**忠于冻结契约**的结果，不是实现疏漏 ——
 *    已记入交付说明的未决问题（若 Lead 认为"已满也应能取消"，需改契约图，不改本文件）。
 * 2. **自反转移（`X → X`）一律 `false`**。冻结图里没有任何自环；
 *    允许自环会让"重复关闭"变成静默成功，掩盖并发下的重复请求。
 */

export type BuddyPostStatus = 'OPEN' | 'FULL' | 'CLOSED' | 'EXPIRED' | 'CANCELLED';

export const BUDDY_POST_STATUSES: readonly BuddyPostStatus[] = [
  'OPEN',
  'FULL',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
];

/** 终态：不再有任何出边 */
export const TERMINAL_POST_STATUSES: readonly BuddyPostStatus[] = ['CLOSED', 'EXPIRED', 'CANCELLED'];

/**
 * 冻结图的邻接表。**逐条对应** `02-domain-model.md:535-548`，
 * 新增一条边就必须同时改契约（本表不是可以随手扩的地方）。
 */
export const POST_TRANSITIONS: Readonly<Record<BuddyPostStatus, readonly BuddyPostStatus[]>> = {
  OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
  FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isBuddyPostStatus(value: unknown): value is BuddyPostStatus {
  return typeof value === 'string' && (BUDDY_POST_STATUSES as readonly string[]).includes(value);
}

export function isTerminalPostStatus(status: BuddyPostStatus): boolean {
  return TERMINAL_POST_STATUSES.includes(status);
}

/** 该转移是否被冻结契约允许。非法状态一律 `false`（fail closed）。 */
export function canTransition(from: string, to: string): boolean {
  if (!isBuddyPostStatus(from) || !isBuddyPostStatus(to)) return false;
  return (POST_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** 断言式包装：用例层用它可以拿到一个明确的中文错误 */
export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`BuddyPost 不允许的状态流转：${from} → ${to}`);
  }
}
