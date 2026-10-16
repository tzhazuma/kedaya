import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts';
import { decodeCursor, encodeCursor, normalizeLimit, readCursor } from './cursor';
import { ValidationError } from '../errors/app-error';

describe('游标分页工具（契约 §6.1：游标分页，不用 offset）', () => {
  it('encode → decode 往返一致', () => {
    const id = 'clx1234567890abcdef';
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it('游标是 base64url，不直接暴露主键明文', () => {
    expect(encodeCursor('abc')).not.toBe('abc');
  });

  it('空游标视为第一页', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });

  it('垃圾游标被拒绝（用重编码比对做严格校验）', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(ValidationError);
    // 合法 base64url 但重编码不一致 → 也是垃圾
    expect(() => decodeCursor(Buffer.from('x').toString('base64url'))).not.toThrow();
  });

  it('limit 缺省用契约的 DEFAULT_PAGE_SIZE', () => {
    expect(normalizeLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeLimit('')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('limit 超过契约上限时被截断到 MAX_PAGE_SIZE', () => {
    expect(normalizeLimit(9999)).toBe(MAX_PAGE_SIZE);
  });

  it('非法 limit 抛 VALIDATION_FAILED 而不是静默取默认值', () => {
    expect(() => normalizeLimit('abc')).toThrow(ValidationError);
    expect(() => normalizeLimit(0)).toThrow(ValidationError);
    expect(() => normalizeLimit(-3)).toThrow(ValidationError);
    expect(() => normalizeLimit(1.5)).toThrow(ValidationError);
  });

  it('readCursor 只接受非空字符串', () => {
    expect(readCursor({ cursor: 'abc' })).toBe('abc');
    expect(readCursor({ cursor: '' })).toBeUndefined();
    expect(readCursor({ cursor: 123 })).toBeUndefined();
    expect(readCursor({})).toBeUndefined();
  });
});
