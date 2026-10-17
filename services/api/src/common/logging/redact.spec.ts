import { describe, expect, it } from 'vitest';
import {
  LOG_FORBIDDEN_KEYS,
  REDACTED,
  isForbiddenLogKey,
  redactForLog,
  redactText,
  toSafeLogLine,
} from './redact';

/**
 * 规格 §10.3「日志与脱敏（**硬要求**）」
 *
 * 这组测试是**泄漏回归**：每一条对应一个真实的"凭证进了日志"事故形态。
 */
describe('日志脱敏（规格 §10.3，硬要求）', () => {
  it('8 个 I1 禁用键名都在清洗名单里', () => {
    for (const key of ['cookie', 'cookies', 'session', 'sessionToken', 'tgc', 'castgc', 'ticket', 'tenant']) {
      expect(isForbiddenLogKey(key)).toBe(true);
    }
  });

  it('规格 §10.3 点名的其它内容也在名单里（明文密码 / 密文 / 付款码正文）', () => {
    for (const key of ['password', 'credential', 'sessionCipher', 'tokenCipher', 'payload']) {
      expect(LOG_FORBIDDEN_KEYS).toContain(key);
      expect(isForbiddenLogKey(key)).toBe(true);
    }
  });

  it('键名比较大小写不敏感且忽略 `_` / `-`（session_token / sessionToken / SESSION-TOKEN 是同一个东西）', () => {
    for (const key of ['SESSION_TOKEN', 'session-token', 'Session_Token', 'CASTGC', 'cast-gc']) {
      expect(isForbiddenLogKey(key)).toBe(true);
    }
  });

  it('嵌套结构里的凭证也被清洗（不是只洗第一层）', () => {
    const redacted = redactForLog({
      userId: 'user-1',
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'CASTGC=abc' },
      nested: { deep: { sessionToken: 'x' } },
      list: [{ password: 'hunter2' }],
    }) as Record<string, any>;

    expect(redacted.userId).toBe('user-1');
    expect(redacted.headers.authorization).toBe(REDACTED);
    expect(redacted.headers.cookie).toBe(REDACTED);
    expect(redacted.nested.deep.sessionToken).toBe(REDACTED);
    expect(redacted.list[0].password).toBe(REDACTED);
  });

  it('⚠️ 清洗后**不残留任何原值**（序列化整串扫一遍）', () => {
    const line = toSafeLogLine({
      credential: { kind: 'password', studentId: '20260001', password: 'hunter2' },
      cookie: 'CASTGC=SECRET-TGC-VALUE; JSESSIONID=abc',
      sessionCipher: 'v1.aaaa.bbbb.cccc',
      ticket: 'wvt_0123456789abcdefghijklmn',
      payload: 'PAYMENT-CODE-PAYLOAD',
    });

    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('20260001');
    expect(line).not.toContain('SECRET-TGC-VALUE');
    expect(line).not.toContain('v1.aaaa');
    expect(line).not.toContain('0123456789abcdefghijklmn');
    expect(line).not.toContain('PAYMENT-CODE-PAYLOAD');
    expect(line).toContain(REDACTED);
  });

  it('文本层面也清洗：拼好的 cookie header / Bearer 令牌 / password=xxx / wvt_ 票据', () => {
    expect(redactText('CASTGC=SECRET; JSESSIONID=abc; other=1')).not.toContain('SECRET');
    expect(redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redactText('password=hunter2&next=1')).not.toContain('hunter2');
    expect(redactText('ticket=wvt_abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
  });

  it('清洗**不修改原对象**（不能为了打日志而改坏业务对象）', () => {
    const original = { cookie: 'CASTGC=x', keep: 'y' };
    const redacted = redactForLog(original) as Record<string, unknown>;

    expect(original.cookie).toBe('CASTGC=x');
    expect(redacted.cookie).toBe(REDACTED);
    expect(redacted).not.toBe(original);
  });

  it('普通字段原样保留（不过度脱敏，否则日志就没用了）', () => {
    const redacted = redactForLog({
      userId: 'user-1',
      platform: 'ecard',
      status: 'LINKED',
      count: 3,
      at: new Date('2026-10-17T00:00:00.000Z'),
    }) as Record<string, unknown>;

    expect(redacted.userId).toBe('user-1');
    expect(redacted.platform).toBe('ecard');
    expect(redacted.status).toBe('LINKED');
    expect(redacted.count).toBe(3);
    expect(redacted.at).toBe('2026-10-17T00:00:00.000Z');
  });

  it('深度超限截断（防环状引用把日志打爆）', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(toSafeLogLine(deep)).toContain('DEPTH_LIMIT');
  });

  it('环状引用**绝不退化成打印原文**（深度截断兜住，且不抛异常）', () => {
    const cyclic: Record<string, unknown> = { name: 'x', cookie: 'CASTGC=SECRET' };
    cyclic.self = cyclic;

    const line = toSafeLogLine(cyclic);

    expect(line).toContain('DEPTH_LIMIT');
    expect(line).toContain(REDACTED);
    expect(line).not.toContain('SECRET');
  });

  it('`toSafeLogLine` 永不抛异常（日志路径不能把请求打挂）', () => {
    expect(() => toSafeLogLine(undefined)).not.toThrow();
    expect(() => toSafeLogLine(() => undefined)).not.toThrow();
    // Symbol 不可序列化 → 退化成类型标记，而不是打印它的描述（描述里可能有敏感信息）
    expect(toSafeLogLine(Symbol('secret-ish'))).toBe('"[symbol]"');
  });
});
