import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LoginResult } from '../auth.service';
import { CasCodeService } from './cas-code.service';

const session = { accessToken: 'a', refreshToken: 'r' } as unknown as LoginResult;

afterEach(() => {
  vi.useRealTimers();
});

describe('CasCodeService', () => {
  it('issue 后只能 consume 一次', () => {
    const service = new CasCodeService();
    const code = service.issue(session);

    expect(code).toMatch(/^[0-9a-f]{48}$/);
    expect(service.consume(code)).toBe(session);
    expect(service.consume(code)).toBeNull();
  });

  it('未知 code 返回 null', () => {
    const service = new CasCodeService();
    expect(service.consume('deadbeef')).toBeNull();
  });

  it('30 秒后过期，且过期项会被清理', () => {
    vi.useFakeTimers();
    const service = new CasCodeService();
    const code = service.issue(session);

    vi.advanceTimersByTime(29_000);
    expect(service.consume(code)).toBe(session);

    const second = service.issue(session);
    vi.advanceTimersByTime(31_000);
    expect(service.consume(second)).toBeNull();
    expect(service.size).toBe(0);
  });

  it('每次 issue 的 code 都不同', () => {
    const service = new CasCodeService();
    const codes = new Set(Array.from({ length: 20 }, () => service.issue(session)));
    expect(codes.size).toBe(20);
  });
});
