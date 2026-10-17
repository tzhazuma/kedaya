/**
 * 重试策略测试。
 *
 * 这条策略修的是一个**真实缺陷**（在真实浏览器里复现）：
 * 后台标签页中，React Query 的重试计时器被 Chrome 节流，
 * 于是一个**确定性**失败（如 `CAMPUS_BINDING_REQUIRED`）会让 `isPending`
 * 长时间为真 —— 用户看到的是永久骨架屏，而不是"去绑定"的引导。
 */
import { describe, expect, it } from 'vitest';

import { ApiResultError } from './unwrap';
import { isRetryableCode, shouldRetryQuery, NON_RETRYABLE_CODES } from './retry';

describe('重试策略', () => {
  it('确定性失败（含 CAMPUS_BINDING_REQUIRED）一律不重试', () => {
    for (const code of NON_RETRYABLE_CODES) {
      const error = new ApiResultError({ code, message: 'x' });
      expect(shouldRetryQuery(0, error)).toBe(false);
      expect(shouldRetryQuery(1, error)).toBe(false);
    }
  });

  it('瞬时故障只重试一次', () => {
    const upstream = new ApiResultError({ code: 'UPSTREAM_UNAVAILABLE', message: '上游不可用' });
    expect(shouldRetryQuery(0, upstream)).toBe(true);
    expect(shouldRetryQuery(1, upstream)).toBe(false);
  });

  it('非 ApiResultError 的异常按瞬时故障处理（但同样只重试一次）', () => {
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('boom'))).toBe(false);
  });

  it('isRetryableCode 只认 UPSTREAM_UNAVAILABLE / INTERNAL', () => {
    expect(isRetryableCode('UPSTREAM_UNAVAILABLE')).toBe(true);
    expect(isRetryableCode('INTERNAL')).toBe(true);
    expect(isRetryableCode('CAMPUS_BINDING_REQUIRED')).toBe(false);
    expect(isRetryableCode('UNAUTHENTICATED')).toBe(false);
  });
});
