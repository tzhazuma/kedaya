import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { createInMemoryDelegate, type InMemoryDelegate } from '../../../../test/fixtures/fake-prisma';
import { PrismaService } from '../../../prisma/prisma.service';
import { CampusSessionError, PHASE0_BINDABLE_PLATFORMS } from '../domain/ports/campus-session.port';
import { CampusSessionService } from './campus-session.service';

/**
 * Phase 0 的**合规硬约束**回归测试（裁决 §11.18-D）
 *
 * 这组测试要证明的核心命题也是**否定性**的：
 *
 *   > 需要代持 CASTGC 的平台，在代码里**没有任何写入路径**。
 *
 * 不是"暂时禁用"，而是 `bind()` 的第一行就把它们拒掉、且**一行都不写库**。
 * 同时证明：明文密码（U12）连**读**都没被读过，更不会进库 / 进错误信息。
 */

const KEY = '0'.repeat(64); // 64 hex = 32 bytes（AES-256）

function makeConfig(): ConfigService {
  return { get: (key: string) => (key === 'CAMPUS_SESSION_ENC_KEY' ? KEY : undefined) } as unknown as ConfigService;
}

function build() {
  const techpieLink: InMemoryDelegate = createInMemoryDelegate([], 'link');
  const campusSession: InMemoryDelegate = createInMemoryDelegate([], 'session');
  const prisma = {
    techpieLink,
    campusSession,
    $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
  } as unknown as PrismaService;

  return { service: new CampusSessionService(prisma, makeConfig()), techpieLink, campusSession };
}

describe('Phase 0 · 校园会话保管库（规格 §2.5 / §5.3；裁决 §11.18-D）', () => {
  /* ================================================================ *
   * 1. 唯一被允许的写入者：ecard + OPENID
   * ================================================================ */

  it('校园卡（ecard）走 OPENID 通道可以绑定，且状态是 LINKED', async () => {
    const { service, techpieLink, campusSession } = build();

    const summary = await service.bind('user-1', 'ecard', {
      kind: 'openid',
      channel: 'wechat',
      openId: 'openid-20260001',
    });

    expect(summary).toMatchObject({ platform: 'ecard', status: 'LINKED', phase: 'phase0' });
    expect(techpieLink.rows).toHaveLength(1);
    expect(campusSession.rows).toHaveLength(1);
  });

  it('落库的是**密文**：库里看不到 openId 明文，也不会有任何 CASTGC', async () => {
    const { service, campusSession } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'openid-20260001' });

    const row = campusSession.rows[0]!;
    expect(String(row.sessionCipher)).not.toContain('openid-20260001');
    expect(String(row.sessionCipher)).toMatch(/^v1\./); // AES-256-GCM 信封格式
    expect(JSON.stringify(campusSession.rows)).not.toMatch(/castgc|CASTGC|tgc=/i);
    // 密钥版本可轮换
    expect(String(row.cipherKeyId)).toMatch(/^v1:/);
  });

  it('**绝不**写 `TechpieLink.tokenCipher`（Phase 0 没有第三方 token 通道，U13）', async () => {
    const { service, techpieLink } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'openid-1' });

    expect(techpieLink.rows[0]!.tokenCipher ?? null).toBeNull();
  });

  /* ================================================================ *
   * 2. 需要 CASTGC 的平台：**没有任何写入路径**
   * ================================================================ */

  it.each(['egate', 'cpdaily', 'cas', 'techpie'] as const)(
    'bind(%s) 被拒绝，且**一行都不写库**（不是"先做着等批准"）',
    async (platform) => {
      const { service, techpieLink, campusSession } = build();

      await expect(
        service.bind('user-1', platform, { kind: 'openid', channel: 'wechat', openId: 'x' }),
      ).rejects.toMatchObject({ reason: 'PHASE_BLOCKED' });

      // 最关键的两条断言：**没有 link、没有 session**
      expect(techpieLink.rows).toHaveLength(0);
      expect(campusSession.rows).toHaveLength(0);
    },
  );

  it('PHASE_BLOCKED 的错误信息里带未决问题编号（机器可见地指向 U7 / U12）', async () => {
    const { service } = build();
    await expect(
      service.bind('user-1', 'cpdaily', { kind: 'openid', channel: 'wechat', openId: 'x' }),
    ).rejects.toMatchObject({
      reason: 'PHASE_BLOCKED',
      details: { blockedBy: ['U7', 'U12'], phase0BindablePlatforms: [...PHASE0_BINDABLE_PLATFORMS] },
    });
  });

  it('Phase 0 可绑定平台只有 ecard（枚举本身是唯一的准入闸门）', () => {
    expect([...PHASE0_BINDABLE_PLATFORMS]).toEqual(['ecard']);
  });

  /* ================================================================ *
   * 3. 明文密码（U12）：连读都不读
   * ================================================================ */

  it('password 凭证被拒绝，且**一行都不写库**', async () => {
    const { service, techpieLink, campusSession } = build();

    await expect(
      service.bind('user-1', 'ecard', { kind: 'password', studentId: '20260001', password: 'hunter2' }),
    ).rejects.toMatchObject({ reason: 'PLAIN_PASSWORD_REFUSED' });

    expect(techpieLink.rows).toHaveLength(0);
    expect(campusSession.rows).toHaveLength(0);
  });

  it('⚠️ 明文密码**绝不出现在错误信息或 details 里**（规格 §10.3）', async () => {
    const { service } = build();

    const error = await service
      .bind('user-1', 'ecard', { kind: 'password', studentId: '20260001', password: 'hunter2' })
      .catch((caught: unknown) => caught as CampusSessionError);

    const serialized = JSON.stringify({
      message: (error as Error).message,
      details: (error as CampusSessionError).details,
      stack: (error as Error).stack,
    });
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('20260001');
  });

  it('先于平台检查的顺序无关紧要：CASTGC 平台 + 明文密码也是"不写库"', async () => {
    const { service, techpieLink, campusSession } = build();
    await expect(
      service.bind('user-1', 'cpdaily', { kind: 'password', studentId: 'x', password: 'y' }),
    ).rejects.toBeInstanceOf(CampusSessionError);
    expect(techpieLink.rows).toHaveLength(0);
    expect(campusSession.rows).toHaveLength(0);
  });

  /* ================================================================ *
   * 4. 绑定 / 查询 / 解绑 / 续期
   * ================================================================ */

  it('重复绑定已 LINKED 的平台 → ALREADY_LINKED（不静默覆盖）', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });

    await expect(
      service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'b' }),
    ).rejects.toMatchObject({ reason: 'ALREADY_LINKED' });
  });

  it('OPENID 凭证不合法（channel 不对 / openId 为空）→ INVALID_CREDENTIAL', async () => {
    const { service, techpieLink } = build();
    await expect(
      service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: '   ' }),
    ).rejects.toMatchObject({ reason: 'INVALID_CREDENTIAL' });
    expect(techpieLink.rows).toHaveLength(0);
  });

  it('listBindings / getBinding 返回的摘要**不含任何凭证键名**（I1 的镜像）', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'openid-1' });

    const list = await service.listBindings('user-1');
    const single = await service.getBinding('user-1', 'ecard');

    expect(list).toHaveLength(1);
    expect(single).toMatchObject({ platform: 'ecard', status: 'LINKED' });
    const keys = Object.keys(single!).map((key) => key.toLowerCase());
    for (const forbidden of ['cookie', 'cookies', 'session', 'sessiontoken', 'tgc', 'castgc', 'ticket', 'tenant']) {
      expect(keys).not.toContain(forbidden);
    }
    // 也绝不回显密文/指纹/tokenCipher
    expect(JSON.stringify(list)).not.toMatch(/sessionCipher|tokenCipher|fingerprint|v1\./);
  });

  it('别人的绑定查不到（按 userId 隔离）', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });

    expect(await service.getBinding('user-2', 'ecard')).toBeNull();
    expect(await service.listBindings('user-2')).toEqual([]);
  });

  it('解绑**硬删**凭证副本（整行），并把 link 标成 REVOKED', async () => {
    const { service, techpieLink, campusSession } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });
    expect(campusSession.rows).toHaveLength(1);

    await service.unbind('user-1', 'ecard');

    // 关键：凭证副本**真的没了**，不是"标记失效"
    expect(campusSession.rows).toHaveLength(0);
    expect(techpieLink.rows[0]!.status).toBe('REVOKED');
    expect(techpieLink.rows[0]!.deletedAt).not.toBeNull();
    expect(await service.getBinding('user-1', 'ecard')).toBeNull();
  });

  it('解绑后再绑：不会残留旧凭证（新密文覆盖 + 旧行已删）', async () => {
    const { service, campusSession } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });
    const firstCipher = String(campusSession.rows[0]!.sessionCipher);
    await service.unbind('user-1', 'ecard');
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'b' });

    expect(campusSession.rows).toHaveLength(1);
    expect(String(campusSession.rows[0]!.sessionCipher)).not.toBe(firstCipher);
  });

  it('续期 → RENEW_NOT_SUPPORTED（**绝不谎称已续期**，失败模式 F3）', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });

    await expect(service.renew('user-1', 'ecard')).rejects.toMatchObject({
      reason: 'RENEW_NOT_SUPPORTED',
      details: { blockedBy: ['U8'] },
    });
  });

  it('对不存在的绑定续期 → NOT_FOUND', async () => {
    const { service } = build();
    await expect(service.renew('user-1', 'ecard')).rejects.toMatchObject({ reason: 'NOT_FOUND' });
  });

  /* ================================================================ *
   * 5. I3：cookie 出口（属性箭头函数，全仓唯一调用点在其调用方）
   * ================================================================ */

  it('OPENID 通道**没有**可注入的 cookie —— 如实报错，而不是编一个假的 header 串', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });

    await expect(service.cookieHeaderFor('user-1', 'ecard')).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
  });

  it('未绑定时取 cookie → NOT_FOUND（不会返回空串让调用方误以为成功）', async () => {
    const { service } = build();
    await expect(service.cookieHeaderFor('user-1', 'ecard')).rejects.toMatchObject({ reason: 'NOT_FOUND' });
  });

  it('解绑后取 cookie → NOT_FOUND（凭证副本已被硬删）', async () => {
    const { service } = build();
    await service.bind('user-1', 'ecard', { kind: 'openid', channel: 'wechat', openId: 'a' });
    await service.unbind('user-1', 'ecard');

    await expect(service.cookieHeaderFor('user-1', 'ecard')).rejects.toMatchObject({ reason: 'NOT_FOUND' });
  });
});
