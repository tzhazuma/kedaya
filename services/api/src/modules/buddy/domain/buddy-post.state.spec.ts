import { describe, expect, it } from 'vitest';
import {
  BUDDY_POST_STATUSES,
  POST_TRANSITIONS,
  TERMINAL_POST_STATUSES,
  assertTransition,
  canTransition,
  isBuddyPostStatus,
  isTerminalPostStatus,
} from './buddy-post.state';

/**
 * 验收 T1（规格 §2.8 / §8.1）：
 * `canTransition` 对 `BuddyPost` 的每一条合法转移返回 `true`，
 * 对全部非法转移返回 `false` —— **表驱动，覆盖 5×5 全矩阵**。
 *
 * 这个矩阵直接来自冻结契约 `02-domain-model.md:535-548`。
 * 本测试的期望值**逐字抄自那张图**，而不是抄自实现 ——
 * 否则它只能证明"实现等于自己"。
 */

/** 冻结图的邻接表（规格 §2.8 的 mermaid 逐条转写） */
const ALLOWED: Record<string, string[]> = {
  OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
  FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
};

describe('canTransition（规格 §2.8 冻结状态机，验收 T1）', () => {
  it('5×5 全矩阵逐格断言（共 25 格）', () => {
    let checked = 0;
    for (const from of BUDDY_POST_STATUSES) {
      for (const to of BUDDY_POST_STATUSES) {
        const expected = ALLOWED[from]?.includes(to) ?? false;
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(BUDDY_POST_STATUSES.length ** 2);
    expect(BUDDY_POST_STATUSES.length).toBe(5);
  });

  it('自反转移一律 false（冻结图里没有任何自环）', () => {
    for (const status of BUDDY_POST_STATUSES) {
      expect(canTransition(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it('终态没有任何出边', () => {
    for (const status of TERMINAL_POST_STATUSES) {
      for (const to of BUDDY_POST_STATUSES) {
        expect(canTransition(status, to)).toBe(false);
      }
      expect(POST_TRANSITIONS[status]).toEqual([]);
    }
    expect(TERMINAL_POST_STATUSES).toEqual(['CLOSED', 'EXPIRED', 'CANCELLED']);
  });

  it('非法状态串 fail closed（不因为拼错就放行）', () => {
    expect(canTransition('OPEN', 'open')).toBe(false);
    expect(canTransition('OPEN', 'DELETED')).toBe(false);
    expect(canTransition('', 'CLOSED')).toBe(false);
    expect(canTransition(undefined as unknown as string, 'CLOSED')).toBe(false);
  });

  it('⚠️ 冻结图里**没有** FULL → CANCELLED（本实现的显式判断，不是疏漏）', () => {
    // 后果：DELETE /items/:id 对已满的帖子返回 409。
    // 这是忠于契约的结果，已记入交付说明的未决问题。
    expect(canTransition('FULL', 'CANCELLED')).toBe(false);
    // 对照：OPEN 可以取消
    expect(canTransition('OPEN', 'CANCELLED')).toBe(true);
  });

  it('assertTransition 对非法转移抛中文错误', () => {
    expect(() => assertTransition('OPEN', 'FULL')).not.toThrow();
    expect(() => assertTransition('CLOSED', 'OPEN')).toThrow(/不允许的状态流转：CLOSED → OPEN/);
  });

  it('类型守卫与终态判定', () => {
    expect(isBuddyPostStatus('FULL')).toBe(true);
    expect(isBuddyPostStatus('full')).toBe(false);
    expect(isTerminalPostStatus('EXPIRED')).toBe(true);
    expect(isTerminalPostStatus('OPEN')).toBe(false);
  });
});
