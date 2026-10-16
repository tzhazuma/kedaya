import { describe, expect, it } from 'vitest';
import {
  ApiEnvelopeError,
  failure,
  isFailure,
  isOk,
  success,
  toResult,
  unwrap,
  type ApiEnvelope,
} from './envelope';

describe('envelope 判定', () => {
  it('区分成功与失败', () => {
    const okEnv = success({ id: '1' }, 'trace-1');
    const errEnv = failure('NOT_FOUND', '拼单不存在', 'trace-2');

    expect(isOk(okEnv)).toBe(true);
    expect(isFailure(okEnv)).toBe(false);
    expect(isOk(errEnv)).toBe(false);
    expect(isFailure(errEnv)).toBe(true);
  });

  it('成功信封形状符合契约', () => {
    expect(success(42, 't')).toEqual({ ok: true, data: 42, traceId: 't' });
  });

  it('失败信封形状符合契约', () => {
    expect(failure('FORBIDDEN', '无权限', 't')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '无权限' },
      traceId: 't',
    });
  });

  it('details 为 undefined 时不写入键', () => {
    const env = failure('INTERNAL', '炸了', 't');
    expect(Object.keys(env.error)).toEqual(['code', 'message']);
  });
});

describe('unwrap', () => {
  it('成功时返回 data', () => {
    expect(unwrap(success({ a: 1 }, 't'))).toEqual({ a: 1 });
  });

  it('失败时抛 ApiEnvelopeError 且携带 code/traceId', () => {
    const env = failure('CONSENT_REQUIRED', '需二次同意', 'trace-9');
    try {
      unwrap(env);
      expect.unreachable('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiEnvelopeError);
      const err = e as ApiEnvelopeError;
      expect(err.code).toBe('CONSENT_REQUIRED');
      expect(err.traceId).toBe('trace-9');
      expect(err.message).toBe('需二次同意');
      expect(err.needsConsent).toBe(true);
      expect(err.needsCampusBinding).toBe(false);
    }
  });

  it('CAMPUS_BINDING_REQUIRED 可被识别', () => {
    const env = failure('CAMPUS_BINDING_REQUIRED', '需绑定 eGate', 't');
    expect(() => unwrap(env)).toThrow(ApiEnvelopeError);
    try {
      unwrap(env);
    } catch (e) {
      expect((e as ApiEnvelopeError).needsCampusBinding).toBe(true);
    }
  });
});

describe('toResult', () => {
  it('不抛异常，转成 Result 形状', () => {
    expect(toResult(success(1, 't'))).toEqual({ ok: true, value: 1 });
    const r = toResult(failure('RATE_LIMITED', '太频繁', 't'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('RATE_LIMITED');
      expect(r.traceId).toBe('t');
    }
  });

  it('与 ApiEnvelope 类型兼容', () => {
    const env: ApiEnvelope<string[]> = success(['a'], 't');
    expect(unwrap(env)).toEqual(['a']);
  });
});
