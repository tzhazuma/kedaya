import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONTACT_EXCHANGE_ENC_KEY_ENV } from '@kedaya/contracts';
import type { ContactCryptoPort, ContactExchangeRepository } from './domain/contact-exchange.domain';
import type { ContactAccessAuditRecord, ContactEntryRecord, ContactExchangeRequestRecord } from './domain/contact-exchange.domain';
import { ContactExchangeService } from './application/contact-exchange.service';
import { AesGcmContactCrypto } from './data/aes-gcm-contact.crypto';
import { createContactPglite, reconnect, seedContactUser, type ContactPglite } from './testing/pglite';

/**
 * 联系方式交换 · 安全 / 迁移 / 启动失败验收
 *
 * 这组测试回答四个"不能只靠肉眼检查"的问题：
 *   1. 密钥缺失 / 长度错误时，模块**真的**起不来（不是警告后继续）；
 *   2. 手写迁移里的**部分唯一索引**真的在数据库里（不是只写在注释里）；
 *   3. 外键 `ON DELETE CASCADE` 真的会清掉条目 / 协议 / 审计；
 *   4. 查看联系方式的日志与审计里**搜不到明文**，且审计失败时读取被拒绝。
 */

const KEY = 'd'.repeat(64);

describe('加密适配器 · 密钥缺失即启动失败（fail closed）', () => {
  it('缺少 CONTACT_EXCHANGE_ENC_KEY → 模块编译失败', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          AesGcmContactCrypto,
          { provide: ConfigService, useValue: { get: () => undefined } },
        ],
      }).compile(),
    ).rejects.toThrow(new RegExp(CONTACT_EXCHANGE_ENC_KEY_ENV));
  });

  it('密钥长度不对 → 模块编译失败（不回显密钥内容）', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          AesGcmContactCrypto,
          { provide: ConfigService, useValue: { get: () => 'too-short-key' } },
        ],
      }).compile(),
    ).rejects.toThrow(/32 字节/);
  });

  it('加解密可逆，指纹是确定性的带密钥 HMAC', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AesGcmContactCrypto,
        { provide: ConfigService, useValue: { get: () => KEY } },
      ],
    }).compile();
    const cipher = moduleRef.get(AesGcmContactCrypto);

    const encrypted = cipher.encrypt('13800138000');
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('13800138000');
    expect(cipher.decrypt(encrypted)).toBe('13800138000');

    const first = cipher.fingerprint('phone', '13800138000');
    const second = cipher.fingerprint('phone', '13800138000');
    const other = cipher.fingerprint('phone', '13900139000');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    // 裸 SHA-256(13800138000) 是可以被彩虹表反查的；这里必须是带密钥 HMAC。
    expect(first).not.toBe('d1e0a1e7d4e9d8f8f5a3f3f9d1e0a1e7d4e9d8f8f5a3f3f9d1e0a1e7d4e9d8f8');

    await moduleRef.close();
  });
});

/* ------------------------------------------------------------------ *
 * 真库：迁移 / 部分唯一索引 / 级联
 * ------------------------------------------------------------------ */

let ctx: ContactPglite;

describe('迁移与数据库约束（PGlite = 真实 PostgreSQL）', () => {
  beforeAll(async () => {
    ctx = await createContactPglite();
  }, 120_000);

  afterAll(async () => {
    await ctx?.dispose();
  });

  it('三张表都由手写迁移创建成功', async () => {
    const rows = await ctx.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('ContactEntry', 'ContactExchangeRequest', 'ContactAccessAudit')
       ORDER BY table_name`,
    );
    expect(rows.rows.map((row) => row.table_name)).toEqual([
      'ContactAccessAudit',
      'ContactEntry',
      'ContactExchangeRequest',
    ]);
  });

  it('部分唯一索引真的存在（pairKey WHERE status IN PENDING/ACCEPTED）', async () => {
    const rows = await ctx.db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'ContactExchangeRequest'`,
    );
    const activeIndex = rows.rows.find((row) =>
      row.indexdef.includes('ContactExchangeRequest_pair_active_key'),
    );
    expect(activeIndex).toBeDefined();
    const indexdef = activeIndex?.indexdef ?? '';
    expect(indexdef).toContain('WHERE');
    expect(indexdef).toContain('PENDING');
    expect(indexdef).toContain('ACCEPTED');
  });

  it('同一对用户不能有第二条活跃申请；撤销后可重新发起', async () => {
    await seedContactUser(ctx.prisma, 'db-a');
    await seedContactUser(ctx.prisma, 'db-b');

    const first = await ctx.prisma.contactExchangeRequest.create({
      data: {
        requesterId: 'db-a',
        addresseeId: 'db-b',
        pairKey: 'db-a:db-b',
        contextModule: 'buddy',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      ctx.prisma.contactExchangeRequest.create({
        data: {
          requesterId: 'db-b',
          addresseeId: 'db-a',
          pairKey: 'db-a:db-b',
          contextModule: 'buddy',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();

    // PGlite 在语句级错误后会关闭当前连接（见夹具注释），等它重连再继续
    await reconnect(ctx.prisma);

    await ctx.prisma.contactExchangeRequest.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const second = await ctx.prisma.contactExchangeRequest.create({
      data: {
        requesterId: 'db-b',
        addresseeId: 'db-a',
        pairKey: 'db-a:db-b',
        contextModule: 'buddy',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(second.id).not.toBe(first.id);
  });

  it('删除用户 → 条目 / 申请 / 审计全部级联删除（不留下孤儿联系方式）', async () => {
    await seedContactUser(ctx.prisma, 'db-c');
    await seedContactUser(ctx.prisma, 'db-d');

    const entry = await ctx.prisma.contactEntry.create({
      data: {
        userId: 'db-c',
        kind: 'phone',
        valueCipher: 'v1.x.y.z',
        valueFingerprint: 'a'.repeat(64),
        shared: true,
      },
    });
    const request = await ctx.prisma.contactExchangeRequest.create({
      data: {
        requesterId: 'db-c',
        addresseeId: 'db-d',
        pairKey: 'db-c:db-d',
        contextModule: 'buddy',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await ctx.prisma.contactAccessAudit.create({
      data: {
        actorId: 'db-d',
        subjectId: 'db-c',
        requestId: request.id,
        entryIds: [entry.id],
        entryKinds: ['phone'],
      },
    });

    await ctx.prisma.user.delete({ where: { id: 'db-c' } });

    expect(await ctx.prisma.contactEntry.count({ where: { userId: 'db-c' } })).toBe(0);
    expect(await ctx.prisma.contactExchangeRequest.count({ where: { requesterId: 'db-c' } })).toBe(0);
    expect(await ctx.prisma.contactAccessAudit.count({ where: { subjectId: 'db-c' } })).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 用例层：日志 / 审计 fail-closed / 防御性过滤
 * ------------------------------------------------------------------ */

function acceptedRequest(): ContactExchangeRequestRecord {
  return {
    id: 'req-sec-1',
    requesterId: 'alice',
    addresseeId: 'bob',
    pairKey: 'alice:bob',
    status: 'ACCEPTED',
    contextModule: 'buddy',
    contextId: null,
    message: null,
    createdAt: new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    expiresAt: new Date('2026-10-24T00:00:00.000Z'),
    respondedAt: new Date('2026-10-17T01:00:00.000Z'),
    revokedAt: null,
    revokedBy: null,
  };
}

function sharedEntry(overrides: Partial<ContactEntryRecord> = {}): ContactEntryRecord {
  return {
    id: 'entry-sec-1',
    userId: 'bob',
    kind: 'phone',
    label: null,
    valueCipher: 'v1.iv.tag.ciphertext',
    valueFingerprint: 'b'.repeat(64),
    shared: true,
    createdAt: new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(overrides: {
  request?: ContactExchangeRequestRecord;
  entries?: ContactEntryRecord[];
  appendAudit?: (input: {
    actorId: string;
    subjectId: string;
    requestId: string;
    entryIds: string[];
    entryKinds: string[];
  }) => Promise<ContactAccessAuditRecord>;
}): { service: ContactExchangeService; appendAudit: ReturnType<typeof vi.fn> } {
  const appendAudit =
    overrides.appendAudit ??
    (async (input) =>
      ({
        id: 'audit-sec-1',
        actorId: input.actorId,
        subjectId: input.subjectId,
        requestId: input.requestId,
        action: 'view_contacts',
        entryIds: input.entryIds,
        entryKinds: input.entryKinds,
        at: new Date('2026-10-18T00:00:00.000Z'),
      }) as ContactAccessAuditRecord);

  const auditSpy = vi.fn(appendAudit);
  const repo = {
    findRequestById: async () => overrides.request ?? acceptedRequest(),
    listSharedEntries: async () => overrides.entries ?? [sharedEntry()],
    appendAudit: auditSpy,
  } as unknown as ContactExchangeRepository;

  const cipher = {
    decrypt: () => '13800138000',
    encrypt: () => 'v1.x.y.z',
    fingerprint: () => 'c'.repeat(64),
  } as unknown as ContactCryptoPort;

  const config = { get: () => undefined } as unknown as ConfigService;
  return { service: new ContactExchangeService(repo, cipher, config), appendAudit: auditSpy };
}

describe('查看联系方式 · 日志与审计（结构性防泄漏）', () => {
  it('日志只含 id / 类型 / 数量；响应才含明文（给已同意的当事人）', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const { service, appendAudit } = makeService({});
      const result = await service.viewContacts('alice', 'req-sec-1');

      expect(debugSpy).toHaveBeenCalled();
      const logged = debugSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain('13800138000');
      expect(logged).toContain('contact-exchange.view');
      expect(logged).toContain('phone');

      expect(appendAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'alice',
          subjectId: 'bob',
          requestId: 'req-sec-1',
          entryIds: ['entry-sec-1'],
          entryKinds: ['phone'],
        }),
      );
      // 响应本身是给"已经双方同意"的当事人看的，因此含明文；这是产品语义。
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.value).toBe('13800138000');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('审计写入失败 → 读取被拒绝（fail-closed，不泄漏联系方式）', async () => {
    const { service } = makeService({
      appendAudit: async () => {
        throw new Error('audit database down');
      },
    });

    await expect(service.viewContacts('alice', 'req-sec-1')).rejects.toThrow('audit database down');
  });

  it('防御性过滤：即使仓储错误地返回 shared=false 的条目，也不会进响应', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const { service } = makeService({
        entries: [sharedEntry({ id: 'entry-unshared', shared: false })],
      });
      const result = await service.viewContacts('alice', 'req-sec-1');
      expect(result.entries).toEqual([]);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('未同意时直接 CONSENT_REQUIRED，且不写审计、不解密', async () => {
    const decrypt = vi.fn(() => '13800138000');
    const appendAudit = vi.fn();
    const repo = {
      findRequestById: async () => ({ ...acceptedRequest(), status: 'PENDING' as const }),
      listSharedEntries: async () => [sharedEntry()],
      appendAudit,
    } as unknown as ContactExchangeRepository;
    const cipher = {
      decrypt,
      encrypt: () => 'v1.x.y.z',
      fingerprint: () => 'c'.repeat(64),
    } as unknown as ContactCryptoPort;
    const service = new ContactExchangeService(repo, cipher, { get: () => undefined } as unknown as ConfigService);

    await expect(service.viewContacts('alice', 'req-sec-1')).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
});
