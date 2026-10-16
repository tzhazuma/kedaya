/**
 * 找搭子 · `BuddyApplication` 状态机（契约 `02-domain-model.md:528-531` 冻结，规格 §2.8）
 *
 * ```
 * [*] --> PENDING : 申请
 * PENDING --> ACCEPTED : 发起人接受
 * PENDING --> REJECTED : 发起人拒绝
 * PENDING --> WITHDRAWN : 申请人撤回
 * WITHDRAWN --> PENDING : 重新申请
 * REJECTED --> [*]
 * ACCEPTED --> [*]
 * ```
 *
 * `WITHDRAWN → PENDING` 是为 `@@unique([postId, applicantId])` 服务的：
 * 撤回后想再申请，**复用同一行**而不是插新行（规格 U7，需 Lead 确认）。
 * 唯一约束在 DB 层（迁移里是唯一索引），应用层不能"顺手"插新行绕过它。
 */

export type BuddyApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export const BUDDY_APPLICATION_STATUSES: readonly BuddyApplicationStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
];

export const APPLICATION_TRANSITIONS: Readonly<
  Record<BuddyApplicationStatus, readonly BuddyApplicationStatus[]>
> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  WITHDRAWN: ['PENDING'],
  ACCEPTED: [],
  REJECTED: [],
};

export function isBuddyApplicationStatus(value: unknown): value is BuddyApplicationStatus {
  return typeof value === 'string' && (BUDDY_APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** 是否已占用一个名额（用于 F4 硬过滤：已申请的不再推荐） */
export function isActiveApplication(status: string): boolean {
  return status === 'PENDING' || status === 'ACCEPTED';
}

export function canApplicationTransition(from: string, to: string): boolean {
  if (!isBuddyApplicationStatus(from) || !isBuddyApplicationStatus(to)) return false;
  return (APPLICATION_TRANSITIONS[from] as readonly string[]).includes(to);
}
