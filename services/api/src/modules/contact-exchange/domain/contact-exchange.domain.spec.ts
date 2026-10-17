import { describe, expect, it } from 'vitest';
import {
  containsContactInfo,
  decideApprove,
  decideReject,
  decideRevoke,
  decideView,
  decodeTimeCursor,
  effectiveStatus,
  encodeTimeCursor,
  InvalidCursorError,
  isAllowedContextModule,
  isRateLimited,
  normalizeLabel,
  pairKeyOf,
  toAuditLogPayload,
  toContactEntryWire,
  toContactExchangeRequestWire,
  toExchangedContactWire,
  validateContactValue,
  type ContactAccessAuditRecord,
  type ContactEntryRecord,
  type ContactExchangeRequestRecord,
} from './contact-exchange.domain';

/**
 * 联系方式交换 · domain 纯函数测试
 *
 * 这一层**不起 Nest、不连数据库** —— 状态机与隐私判定必须能独立钉死。
 */

function request(overrides: Partial<ContactExchangeRequestRecord> = {}): ContactExchangeRequestRecord {
  return {
    id: 'req-1',
    requesterId: 'alice',
    addresseeId: 'bob',
    pairKey: 'alice:bob',
    status: 'PENDING',
    contextModule: 'buddy',
    contextId: null,
    message: null,
    createdAt: new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    expiresAt: new Date('2026-10-24T00:00:00.000Z'),
    respondedAt: null,
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

function entry(overrides: Partial<ContactEntryRecord> = {}): ContactEntryRecord {
  return {
    id: 'entry-1',
    userId: 'alice',
    kind: 'wechat',
    label: '常用',
    valueCipher: 'v1.iv.tag.ciphertext',
    valueFingerprint: 'f'.repeat(64),
    shared: true,
    createdAt: new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('联系方式值校验与规范化', () => {
  it('手机号去掉 +86 / 空格 / 连字符后通过', () => {
    expect(validateContactValue('phone', '+86 138-0013-8000')).toEqual({
      ok: true,
      value: '13800138000',
      message: '',
    });
  });

  it('拒绝非法手机号 / 邮箱 / QQ / 微信号', () => {
    expect(validateContactValue('phone', '12345').ok).toBe(false);
    expect(validateContactValue('email', 'not-an-email').ok).toBe(false);
    expect(validateContactValue('qq', '0123').ok).toBe(false);
    expect(validateContactValue('wechat', '1abcde').ok).toBe(false);
  });

  it('邮箱转小写；微信号保持原样', () => {
    expect(validateContactValue('email', ' Alice@Example.COM ')).toMatchObject({
      ok: true,
      value: 'alice@example.com',
    });
    expect(validateContactValue('wechat', 'Alice_01')).toMatchObject({ ok: true, value: 'Alice_01' });
  });

  it('标签空白归一化为 null', () => {
    expect(normalizeLabel('   ')).toBeNull();
    expect(normalizeLabel(' 常用 ')).toBe('常用');
    expect(normalizeLabel(null)).toBeNull();
  });
});

describe('防绕过：申请附言不得夹带联系方式', () => {
  it('检出手机号 / 微信 / QQ / 邮箱', () => {
    expect(containsContactInfo('我手机 13800138000')).toBe(true);
    expect(containsContactInfo('微信：alice_01')).toBe(true);
    expect(containsContactInfo('QQ 123456789')).toBe(true);
    expect(containsContactInfo('发我 alice@example.com')).toBe(true);
  });

  it('普通附言不误伤', () => {
    expect(containsContactInfo('周六下午三点图书馆见')).toBe(false);
    expect(containsContactInfo('我在 3 号门等你')).toBe(false);
  });
});

describe('状态机', () => {
  it('只有被申请人能同意；发起人尝试返回 FORBIDDEN', () => {
    expect(decideApprove(request(), 'alice', new Date('2026-10-18T00:00:00Z'))).toMatchObject({
      allowed: false,
      code: 'FORBIDDEN',
    });
    expect(decideApprove(request(), 'bob', new Date('2026-10-18T00:00:00Z'))).toMatchObject({
      allowed: true,
      nextStatus: 'ACCEPTED',
    });
  });

  it('非 PENDING 不能同意 / 拒绝（CONFLICT）', () => {
    const accepted = request({ status: 'ACCEPTED' });
    expect(decideApprove(accepted, 'bob', new Date()).allowed).toBe(false);
    expect(decideReject(accepted, 'bob', new Date())).toMatchObject({
      allowed: false,
      code: 'CONFLICT',
    });
  });

  it('拒绝由被申请人执行，状态变 REJECTED', () => {
    expect(decideReject(request(), 'bob', new Date())).toMatchObject({
      allowed: true,
      nextStatus: 'REJECTED',
    });
    expect(decideReject(request(), 'alice', new Date())).toMatchObject({
      allowed: false,
      code: 'FORBIDDEN',
    });
  });

  it('撤销：PENDING 双方都可以、ACCEPTED 双方都可以', () => {
    const now = new Date('2026-10-18T00:00:00Z');
    expect(decideRevoke(request(), 'alice', now)).toMatchObject({
      allowed: true,
      nextStatus: 'REVOKED',
      revokedBy: 'alice',
    });
    expect(decideRevoke(request({ status: 'ACCEPTED' }), 'bob', now)).toMatchObject({
      allowed: true,
      nextStatus: 'REVOKED',
      revokedBy: 'bob',
    });
  });

  it('已拒绝 / 已撤销 / 已过期不能撤销', () => {
    expect(decideRevoke(request({ status: 'REJECTED' }), 'alice', new Date()).allowed).toBe(false);
    expect(decideRevoke(request({ status: 'REVOKED' }), 'alice', new Date()).allowed).toBe(false);
    expect(
      decideRevoke(
        request({ expiresAt: new Date('2026-10-17T00:00:00Z') }),
        'alice',
        new Date('2026-10-18T00:00:00Z'),
      ).allowed,
    ).toBe(false);
  });

  it('查看明文只允许 ACCEPTED；其余一律 CONSENT_REQUIRED', () => {
    const now = new Date('2026-10-18T00:00:00Z');
    expect(decideView(request({ status: 'ACCEPTED' }), now).allowed).toBe(true);
    for (const status of ['PENDING', 'REJECTED', 'REVOKED', 'EXPIRED'] as const) {
      expect(decideView(request({ status }), now)).toMatchObject({
        allowed: false,
        code: 'CONSENT_REQUIRED',
      });
    }
  });

  it('PENDING 到期后 effectiveStatus 为 EXPIRED', () => {
    const expiresAt = new Date('2026-10-17T00:00:00Z');
    expect(effectiveStatus('PENDING', expiresAt, new Date('2026-10-18T00:00:00Z'))).toBe('EXPIRED');
    expect(effectiveStatus('ACCEPTED', expiresAt, new Date('2026-10-18T00:00:00Z'))).toBe('ACCEPTED');
  });
});

describe('限流与用户对', () => {
  it('无序 pairKey 与方向无关', () => {
    expect(pairKeyOf('alice', 'bob')).toBe('alice:bob');
    expect(pairKeyOf('bob', 'alice')).toBe('alice:bob');
  });

  it('计数达到阈值即限流（>=）', () => {
    expect(isRateLimited(2, 3)).toBe(false);
    expect(isRateLimited(3, 3)).toBe(true);
    expect(isRateLimited(4, 3)).toBe(true);
    // 非法阈值按 1 处理，绝不放行无限次
    expect(isRateLimited(1, 0)).toBe(true);
  });

  it('上下文模块白名单：交易/见面类允许，敏感域拒绝', () => {
    expect(isAllowedContextModule('buddy')).toBe(true);
    expect(isAllowedContextModule('groupbuy')).toBe(true);
    expect(isAllowedContextModule('wellbeing')).toBe(false);
    expect(isAllowedContextModule('dorm-harmony')).toBe(false);
    expect(isAllowedContextModule('ai-portrait')).toBe(false);
  });
});

describe('复合游标', () => {
  it('编码后可原样解码', () => {
    const cursor = { at: new Date('2026-10-17T12:34:56.789Z'), id: 'cm1abc' };
    const encoded = encodeTimeCursor(cursor);
    expect(decodeTimeCursor(encoded)).toEqual(cursor);
  });

  it('空游标返回 undefined', () => {
    expect(decodeTimeCursor(undefined)).toBeUndefined();
    expect(decodeTimeCursor('')).toBeUndefined();
  });

  it('拒绝没有分隔符 / 篡改 / 非法时间', () => {
    expect(() => decodeTimeCursor(Buffer.from('garbage').toString('base64url'))).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeTimeCursor(Buffer.from('not-a-date|id').toString('base64url'))).toThrow(
      InvalidCursorError,
    );
    const encoded = encodeTimeCursor({ at: new Date('2026-10-17T12:34:56.789Z'), id: 'cm1abc' });
    expect(() => decodeTimeCursor(`${encoded}x`)).toThrow(InvalidCursorError);
  });
});

describe('允许清单投影：结构性防泄漏', () => {
  it('条目 DTO 不含密文 / 指纹 / userId（即使输入对象带了这些字段）', () => {
    const wire = toContactEntryWire(entry(), 'wx_test_user');
    expect(Object.keys(wire).sort()).toEqual(
      ['createdAt', 'id', 'kind', 'label', 'shared', 'updatedAt', 'value'].sort(),
    );
    const dump = JSON.stringify(wire);
    expect(dump).not.toContain('v1.iv.tag.ciphertext');
    expect(dump).not.toContain('f'.repeat(64));
    expect(dump).not.toContain('"userId"');
  });

  it('交换条目 DTO 只含 id/kind/label/value，不泄漏 shared 之外的内部列', () => {
    const wire = toExchangedContactWire(entry(), 'wx_alice_01');
    expect(Object.keys(wire).sort()).toEqual(['id', 'kind', 'label', 'value']);
    expect(JSON.stringify(wire)).not.toContain('valueCipher');
  });

  it('申请详情 DTO 不含任何联系方式字段', () => {
    const wire = toContactExchangeRequestWire(request());
    const keys = Object.keys(wire);
    for (const forbidden of ['value', 'valueCipher', 'valueFingerprint', 'entries', 'masked']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('审计日志载荷只挑白名单字段 —— 即使传入对象夹带 value 也不会进日志', () => {
    const audit = {
      id: 'audit-1',
      actorId: 'alice',
      subjectId: 'bob',
      requestId: 'req-1',
      action: 'view_contacts',
      entryIds: ['entry-1'],
      entryKinds: ['wechat'],
      at: new Date('2026-10-18T00:00:00.000Z'),
      // 故意夹带敏感字段（模拟未来某处把 join 结果直接丢进日志）
      value: 'wx_alice_01',
      valueCipher: 'v1.iv.tag.ciphertext',
      entries: [{ value: '13800138000' }],
    } as unknown as ContactAccessAuditRecord;

    const payload = toAuditLogPayload(audit);
    const dump = JSON.stringify(payload);
    expect(dump).not.toContain('wx_alice_01');
    expect(dump).not.toContain('13800138000');
    expect(dump).not.toContain('v1.iv.tag.ciphertext');
    expect(Object.keys(payload).sort()).toEqual(
      ['actorId', 'at', 'auditId', 'entryCount', 'entryKinds', 'event', 'requestId', 'subjectId'].sort(),
    );
  });
});
