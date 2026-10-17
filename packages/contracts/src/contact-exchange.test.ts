import { describe, expect, it } from 'vitest';
import {
  CONTACT_EXCHANGE_CONTEXT_MODULES,
  CONTACT_EXCHANGE_DEFAULT_RATE_LIMIT,
  CONTACT_EXCHANGE_ROUTE,
  CONTACT_EXCHANGE_STATUSES,
  CONTACT_EXCHANGE_WINDOW_MS,
  CONTACT_KINDS,
  isContactExchangeContextModule,
  isContactExchangeStatus,
  isContactKind,
} from './contact-exchange';

/**
 * 联系方式交换 wire 契约的稳定性测试。
 *
 * 这些值被 API、小程序、Web 三端共同依赖；改任何一个都必须同时改三端，
 * 因此用测试把它们钉死。
 */
describe('联系方式交换 wire 契约（U8）', () => {
  it('冻结联系方式类型', () => {
    expect(CONTACT_KINDS).toEqual(['wechat', 'phone', 'email', 'qq']);
    expect(isContactKind('phone')).toBe(true);
    expect(isContactKind('fax')).toBe(false);
  });

  it('冻结申请状态枚举', () => {
    expect(CONTACT_EXCHANGE_STATUSES).toEqual([
      'PENDING',
      'ACCEPTED',
      'REJECTED',
      'REVOKED',
      'EXPIRED',
    ]);
    expect(isContactExchangeStatus('ACCEPTED')).toBe(true);
    expect(isContactExchangeStatus('accepted')).toBe(false);
  });

  it('交换上下文只允许交易/见面类模块，敏感域永远不在此列', () => {
    expect([...CONTACT_EXCHANGE_CONTEXT_MODULES]).toEqual([
      'buddy',
      'groupbuy',
      'errand',
      'flea-market',
      'lost-found',
      'facility',
    ]);
    for (const forbidden of ['wellbeing', 'dorm-harmony', 'ai-portrait', 'auth', 'profile']) {
      expect(isContactExchangeContextModule(forbidden)).toBe(false);
    }
  });

  it('路由与限流窗口是冻结常量', () => {
    // 挂在 profile 下：契约 §6 要求每个端点都属于某个用户可见模块
expect(CONTACT_EXCHANGE_ROUTE).toBe('profile');
    expect(CONTACT_EXCHANGE_DEFAULT_RATE_LIMIT).toBe(3);
    expect(CONTACT_EXCHANGE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
