import { describe, expect, it } from 'vitest';
import { decodePostCursor, encodePostCursor } from './cursor';
import { ValidationError } from '../../../common/errors/app-error';

/**
 * 验收 T20 的一部分（规格 §5.9）：游标必须**不透明**且**严格校验**。
 *
 * 这里测的是复合游标（`startsAt_asc` 排序用）。它与契约 api-contract §3.1
 * 的"cursor 就是 ULID"不同 —— 这是规格 U3 记录的、本模块**唯一**的偏离：
 * `startsAt` 的顺序与 id 的顺序不一致，用单键游标会**跳条**。
 *
 * 端到端的翻页正确性（`limit=1` 连续翻页遍历全部且无重复无跳过）在
 * `test/buddy-http.spec.ts` 用真实数据库验证。
 */
describe('复合游标（规格 §5.9 / U3）', () => {
  const startsAt = new Date('2026-10-24T06:00:00.000Z');
  const id = 'clx1234567890abcdef';

  it('encode → decode 往返一致（时间与 id 都不丢）', () => {
    const decoded = decodePostCursor(encodePostCursor(startsAt, id));
    expect(decoded?.id).toBe(id);
    expect(decoded?.startsAt.toISOString()).toBe(startsAt.toISOString());
  });

  it('游标是 base64url，不直接暴露时间与主键明文', () => {
    const cursor = encodePostCursor(startsAt, id);
    expect(cursor).not.toContain(id);
    expect(cursor).not.toContain('2026-10-24');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('空游标视为第一页', () => {
    expect(decodePostCursor(undefined)).toBeUndefined();
    expect(decodePostCursor(null)).toBeUndefined();
    expect(decodePostCursor('')).toBeUndefined();
  });

  it('垃圾游标抛 VALIDATION_FAILED（不静默取第一页 —— 那会让"翻不动"表现成"数据丢了"）', () => {
    expect(() => decodePostCursor('!!!not-base64!!!')).toThrow(ValidationError);
  });

  it('合法 base64url 但结构不对 → 拒绝', () => {
    // 只有 id、没有分隔符
    const onlyId = Buffer.from(id, 'utf8').toString('base64url');
    expect(() => decodePostCursor(onlyId)).toThrow(ValidationError);
    // 分隔符在开头 / 结尾
    const leading = Buffer.from('|x', 'utf8').toString('base64url');
    expect(() => decodePostCursor(leading)).toThrow(ValidationError);
    const trailing = Buffer.from('x|', 'utf8').toString('base64url');
    expect(() => decodePostCursor(trailing)).toThrow(ValidationError);
  });

  it('时间部分不是合法 ISO → 拒绝', () => {
    const bad = Buffer.from(`not-a-date|${id}`, 'utf8').toString('base64url');
    expect(() => decodePostCursor(bad)).toThrow(/合法 ISO 时间/);
  });

  it('id 里含 `|` 时按**最后一个**分隔符切分（id 不会被截断）', () => {
    const weird = 'abc|def';
    const decoded = decodePostCursor(encodePostCursor(startsAt, weird));
    expect(decoded?.id).toBe(weird);
  });

  it('严格性检查：解码后重新编码必须与原文一致（base64url 解码对垃圾是宽容的）', () => {
    // 手工构造一个"能解码但不是标准编码"的串：加尾部 '=' 填充
    const cursor = encodePostCursor(startsAt, id);
    expect(() => decodePostCursor(`${cursor}=`)).toThrow(ValidationError);
  });

  it('两个不同时刻产生不同游标（否则翻页会原地打转）', () => {
    const a = encodePostCursor(new Date('2026-10-24T06:00:00.000Z'), id);
    const b = encodePostCursor(new Date('2026-10-24T07:00:00.000Z'), id);
    expect(a).not.toBe(b);
  });

  it('同一时刻不同 id 产生不同游标（同一秒内多条帖子必须能翻页）', () => {
    const a = encodePostCursor(startsAt, 'id-a');
    const b = encodePostCursor(startsAt, 'id-b');
    expect(a).not.toBe(b);
  });
});
