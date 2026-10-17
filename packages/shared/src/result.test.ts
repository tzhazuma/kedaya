import { describe, expect, it } from 'vitest';
import { assertNever, err, isErr, isOk, mapErr, mapResult, ok, unwrapOr } from './result';

describe('Result', () => {
  it('ok / err 构造与判定', () => {
    const a = ok(1);
    const b = err('boom');
    expect(isOk(a)).toBe(true);
    expect(isErr(a)).toBe(false);
    expect(isOk(b)).toBe(false);
    expect(isErr(b)).toBe(true);
  });

  it('mapResult 只映射成功分支', () => {
    expect(mapResult(ok(2), (v) => v * 10)).toEqual({ ok: true, value: 20 });
    expect(mapResult(err('e'), (v: number) => v * 10)).toEqual({ ok: false, error: 'e' });
  });

  it('mapErr 只映射失败分支', () => {
    expect(mapErr(err('e'), (e) => e.toUpperCase())).toEqual({ ok: false, error: 'E' });
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual({ ok: true, value: 1 });
  });

  it('unwrapOr 取回退值', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err('e'), 0)).toBe(0);
  });

  it('assertNever 抛错', () => {
    expect(() => assertNever('x' as never)).toThrow();
  });
});
