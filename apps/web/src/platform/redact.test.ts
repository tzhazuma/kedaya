/**
 * 日志 / 埋点脱敏测试（规格 §10.3 硬要求）。
 *
 * 断言的是**白名单**语义（不是黑名单）：
 * - 不在 `LOG_SAFE_FIELDS` 里的键**整条丢弃**；
 * - 即便字段名安全，值里出现凭证形态也一律掩码；
 * - `createSafeTraceLogger` 在进入环形缓冲 / sink / 控制台**之前**就完成脱敏。
 */
import { describe, expect, it } from 'vitest';

import { LOG_FORBIDDEN_KEYS } from '@/domain/models/techpie';

import {
  LOG_SAFE_FIELDS,
  REDACTED,
  createSafeTraceLogger,
  findSecretPatterns,
  maskSecrets,
  redactForLog,
  scanSerializedForSecrets,
} from './redact';

describe('白名单脱敏（默认拒绝）', () => {
  it('白名单外的键整条丢弃（不是置空）', () => {
    const redacted = redactForLog({
      action: 'READ',
      moduleId: 'techpie',
      credential: { studentId: '2023XXXXXX', password: 'hunter2' },
      cookie: 'CASTGC=TGT-1234',
      sessionCipher: 'v1:abc',
      ticket: 'wvt_123456',
      note: '随手记的',
      payload: 'KEDAYA-ECARD-1',
      headers: { Authorization: 'Bearer x' },
    });

    expect(redacted).toEqual({ action: 'READ', moduleId: 'techpie' });
    expect(Object.keys(redacted)).not.toContain('credential');
    expect(Object.keys(redacted)).not.toContain('cookie');
    expect(Object.keys(redacted)).not.toContain('ticket');
    expect(Object.keys(redacted)).not.toContain('payload');
  });

  it('保留的字段里的凭证形态会被掩码（键安全 ≠ 值安全）', () => {
    const redacted = redactForLog({
      action: 'LOGIN',
      // `reason` 是白名单字段，但值里带了 cookie
      reason: 'failed with CASTGC=TGT-1234',
    });
    expect(redacted.reason).toBe(`failed with ${REDACTED}`);
    expect(JSON.stringify(redacted)).not.toMatch(/castgc/i);
  });

  it('嵌套对象同样只保留白名单键', () => {
    const redacted = redactForLog({
      action: 'READ',
      status: { code: 'OK', sessionToken: 'x', traceId: 't-1' },
    });
    expect(redacted).toEqual({ action: 'READ', status: { traceId: 't-1' } });
  });

  it('非对象输入返回空对象（不抛异常）', () => {
    expect(redactForLog(null)).toEqual({});
    expect(redactForLog('text')).toEqual({});
    expect(redactForLog([1, 2])).toEqual({});
  });

  it('白名单本身不含任何凭证味字段名', () => {
    for (const key of LOG_SAFE_FIELDS) {
      expect(key.toLowerCase()).not.toMatch(/cookie|session|tgc|ticket|password|secret|token|payload/);
    }
  });
});

describe('值级掩码', () => {
  it('识别已知凭证形态', () => {
    expect(findSecretPatterns('CASTGC=TGT-1')).toContain('castgc');
    expect(findSecretPatterns('ticket=wvt_1')).toContain('webviewTicket');
    expect(findSecretPatterns('https://x/?ticket=abc')).toContain('ticketParam');
    expect(findSecretPatterns('password=hunter2')).toContain('password');
    expect(findSecretPatterns('Bearer eyJhbGciOi.abc.def')).toContain('bearer');
    expect(findSecretPatterns('KEDAYA-ECARD-000001')).toContain('paymentCodePayload');
    expect(findSecretPatterns('一切正常')).toEqual([]);
  });

  it('maskSecrets 替换所有命中（大小写不敏感）', () => {
    expect(maskSecrets('a castgc=x b CASTGC=y c')).toBe(`a ${REDACTED} b ${REDACTED} c`);
  });

  it('scanSerializedForSecrets 能扫描序列化后的对象', () => {
    expect(scanSerializedForSecrets({ a: 'wvt_123' })).toContain('webviewTicket');
    expect(scanSerializedForSecrets({ a: 'ok' })).toEqual([]);
  });
});

describe('safe trace logger', () => {
  it('进入 sink 与缓冲的都已经脱敏', () => {
    const seen: unknown[] = [];
    const logger = createSafeTraceLogger((event) => seen.push(event));

    logger.track({
      name: 'techpie.webview.opened',
      moduleId: 'techpie',
      data: {
        capabilityId: 'webview.ecourse',
        host: 'ecourse.shanghaitech.edu.cn',
        // 调用方手滑传了这些：
        ticket: 'wvt_123456',
        credential: { password: 'hunter2' },
        cookie: 'CASTGC=TGT-1',
      },
    });

    const serialized = JSON.stringify(logger.recent());
    expect(serialized).not.toMatch(/wvt_/);
    expect(serialized).not.toMatch(/hunter2/);
    expect(serialized).not.toMatch(/castgc/i);
    expect(serialized).not.toContain('ticket');
    expect(serialized).toContain('webview.ecourse');

    expect(JSON.stringify(seen)).not.toMatch(/wvt_/);
    expect(JSON.stringify(seen)).not.toMatch(/hunter2/);
  });

  it('事件名与 traceId 也会过掩码（防有人把票据塞进 name）', () => {
    const logger = createSafeTraceLogger();
    logger.track({ name: 'open wvt_abcdef', traceId: 'CASTGC=x' });
    const serialized = JSON.stringify(logger.recent());
    expect(serialized).not.toMatch(/wvt_/);
    expect(serialized).not.toMatch(/castgc/i);
  });

  it('clear 清空缓冲', () => {
    const logger = createSafeTraceLogger();
    logger.track({ name: 'a' });
    expect(logger.recent()).toHaveLength(1);
    logger.clear();
    expect(logger.recent()).toHaveLength(0);
  });
});

describe('禁用键清单（规格 §10.3 与契约 §11.4 I1 的并集）', () => {
  it('包含 I1 的 8 个键 + 付款码正文', () => {
    expect(LOG_FORBIDDEN_KEYS).toEqual(
      expect.arrayContaining([
        'cookie',
        'cookies',
        'session',
        'sessionToken',
        'tgc',
        'castgc',
        'ticket',
        'tenant',
        'payload',
      ]),
    );
  });

  it('这些键一个都不能出现在白名单里', () => {
    for (const forbidden of LOG_FORBIDDEN_KEYS) {
      expect(LOG_SAFE_FIELDS).not.toContain(forbidden);
    }
  });
});
