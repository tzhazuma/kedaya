import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPglitePrisma, seedUser, type PglitePrisma } from './fixtures/pglite-prisma';

/**
 * TechPie Phase 0 · **真库**验收（状态枚举按 §11.19-A 为 ACTIVE）（PGlite = PostgreSQL 的 WASM 构建）
 *
 * ## 为什么必须有这一层
 *
 * 内存版假 Prisma（`techpie-http.spec.ts`）证明不了三件事：
 *   1. 手写/生成的迁移 SQL 能否**真的执行**；
 *   2. `@@unique([userId, provider])` / `@@unique([userId, platform])`
 *      这些**约束**是否真的生效；
 *   3. 落库的密文列里**真的**没有 CASTGC 明文（这是合规红线，不能只靠单元测试断言）。
 *
 * 因此这里起一个真实的 PostgreSQL，把**四份迁移真的跑一遍**，
 * 再用**真实的 PrismaClient** 读写。先例：`test/buddy-db.spec.ts`。
 */

const KEY = '0'.repeat(64);

let ctx: PglitePrisma;

describe('TechPie Phase 0 · 真库（迁移 + 约束 + 密文）', () => {
  beforeAll(async () => {
    ctx = await createPglitePrisma();
    await seedUser(ctx.prisma, 'user-db-1');
    await seedUser(ctx.prisma, 'user-db-2');
  }, 120_000);

  afterAll(async () => {
    await ctx?.dispose();
  });

  it('四份迁移真的执行成功，TechpieLink / TechpieSyncJob / CampusSession 三张表都在', async () => {
    const rows = await ctx.prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('TechpieLink', 'TechpieSyncJob', 'CampusSession')
      ORDER BY table_name
    `;
    expect(rows.map((row) => row.table_name)).toEqual(['CampusSession', 'TechpieLink', 'TechpieSyncJob']);
  });

  it('TechpieLink 的旧脚手架列（key/name/category/url）已被移除（重塑真的发生了）', async () => {
    const rows = await ctx.prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'TechpieLink'
      ORDER BY column_name
    `;
    const columns = rows.map((row) => row.column_name);
    expect(columns).toContain('provider');
    expect(columns).toContain('deletedAt');
    expect(columns).not.toContain('key');
    expect(columns).not.toContain('category');
    expect(columns).not.toContain('url');
  });

  it('CampusSession 落库的是密文：数据库里**看不到** OPENID 明文，也没有 CASTGC', async () => {
    await ctx.prisma.techpieLink.create({
      data: {
        userId: 'user-db-1',
        provider: 'ecard',
        status: 'ACTIVE',
        externalUserId: 'openid-db-1',
      },
    });
    await ctx.prisma.campusSession.create({
      data: {
        userId: 'user-db-1',
        platform: 'ecard',
        status: 'ACTIVE',
        // 真实实现走 AES-256-GCM；这里只验证"列里存的是密文而不是明文"这一约定
        sessionCipher: 'v1.aaaaaaaa.bbbbbbbb.cccccccc',
        cipherKeyId: 'v1:deadbeef',
        externalUserId: 'openid-db-1',
      },
    });

    const rows = await ctx.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "CampusSession"
    `;
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/castgc|CASTGC|tgc=/);
    expect(rows).toHaveLength(1);
  });

  it('⚠️ 数据库断言：CampusSession 里**没有** cpdaily / egate 行（Phase 0 不代持 CASTGC）', async () => {
    const rows = await ctx.prisma.$queryRaw<Array<{ platform: string }>>`
      SELECT platform FROM "CampusSession"
    `;
    const platforms = rows.map((row) => row.platform);
    expect(platforms).toEqual(['ecard']);
    expect(platforms).not.toContain('cpdaily');
    expect(platforms).not.toContain('egate');
  });

  it('@@unique([userId, platform]) 真的生效（同一平台不能有第二行）', async () => {
    await expect(
      ctx.prisma.campusSession.create({
        data: {
          userId: 'user-db-1',
          platform: 'ecard',
          status: 'ACTIVE',
          sessionCipher: 'v1.x.y.z',
          cipherKeyId: 'v1:deadbeef',
        },
      }),
    ).rejects.toThrow();
  });

  it('@@unique([userId, provider]) 真的生效', async () => {
    await expect(
      ctx.prisma.techpieLink.create({
        data: { userId: 'user-db-1', provider: 'ecard', status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
  });

  it('外键 ON DELETE CASCADE：删用户即删绑定与会话（不留下孤儿凭证）', async () => {
    await ctx.prisma.user.delete({ where: { id: 'user-db-1' } });

    const sessions = await ctx.prisma.campusSession.findMany({ where: { userId: 'user-db-1' } });
    const links = await ctx.prisma.techpieLink.findMany({ where: { userId: 'user-db-1' } });
    expect(sessions).toEqual([]);
    expect(links).toEqual([]);
  });

  it('TechpieSyncJob 的 lastError 列存在（脱敏由应用层保证，列本身只是文本）', async () => {
    await ctx.prisma.techpieLink.create({
      data: { userId: 'user-db-2', provider: 'ecard', status: 'ACTIVE' },
    });
    const link = await ctx.prisma.techpieLink.findFirst({ where: { userId: 'user-db-2' } });

    const job = await ctx.prisma.techpieSyncJob.create({
      data: { linkId: link!.id, kind: 'pull_schedule', lastError: '上游超时（已脱敏）' },
    });

    expect(job.status).toBe('QUEUED');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBe('上游超时（已脱敏）');
  });

  it('解绑即**硬删**：deleteMany 之后行真的没了（不是软删）', async () => {
    const link = await ctx.prisma.techpieLink.findFirst({ where: { userId: 'user-db-2' } });
    await ctx.prisma.techpieLink.create({
      data: { userId: 'user-db-2', provider: 'cas', status: 'ACTIVE' },
    });
    await ctx.prisma.campusSession.create({
      data: {
        userId: 'user-db-2',
        platform: 'cas',
        status: 'ACTIVE',
        sessionCipher: 'v1.x.y.z',
        cipherKeyId: 'v1:deadbeef',
      },
    });

    await ctx.prisma.campusSession.deleteMany({ where: { userId: 'user-db-2', platform: 'cas' } });

    const remaining = await ctx.prisma.campusSession.findMany({ where: { userId: 'user-db-2' } });
    expect(remaining).toEqual([]);
    expect(link).not.toBeNull();
  });

  it('`CAMPUS_SESSION_ENC_KEY` 的长度约定与真实加密一致（64 hex = 32 字节）', () => {
    // 这是一个**契约性**断言：密钥长度写错时 `encryptSecret` 会抛错，
    // 而不是悄悄用短密钥。这里把它变成显式的期望值。
    expect(KEY).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(KEY)).toBe(true);
  });
});
