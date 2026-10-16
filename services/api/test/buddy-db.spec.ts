/**
 * 找搭子 · **真实数据库**验证（PGlite = PostgreSQL WASM + pgvector + 真 PrismaClient）
 *
 * 覆盖那些"只能在真库上证明"的验收项：
 *   - 手写迁移真的建起了 `vector(768)` 列与 8 条外键（规格 §4.2 / §4.3）
 *   - `BuddyVectorPrismaRepository` 的 `<=>` 查询真的能召回并按距离排序（规格 §4.4）
 *   - **参数绑定让注入不可能**：恶意字面量只被当作数据，表完好（验收 T15）
 *   - 反馈查询的 `WHERE section = $section` **真的在 SQL 里**（验收 T6）
 *   - `join` / `decide` 的 `FOR UPDATE` 事务与锁内名额检查（规格 §5.5 / §5.6 / T22）
 *   - 唯一约束真的挡住重复反馈（UPSERT 的前提，规格 D11）
 *
 * ⚠️ **限制**：PGlite 的 socket 服务端把查询全局串行化，因此这里的
 * "并发"是串行执行的 —— 它验证锁内逻辑，但**不能**证明真并发下不超员。
 * 见 `test/fixtures/pglite-prisma.ts` 的限制说明。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { BuddyVectorPrismaRepository } from '../src/modules/buddy/data/buddy-vector.repository';
import { BuddyFeedbackPrismaRepository } from '../src/modules/buddy/data/buddy-application.repository';
import { BuddyApplicationPrismaRepository } from '../src/modules/buddy/data/buddy-application.repository';
import { BuddyPostPrismaRepository, BuddyProfilePrismaRepository } from '../src/modules/buddy/data/buddy.repository';
import { createPglitePrisma, fakeConfig, reconnect, seedUser, type PglitePrisma } from './fixtures/pglite-prisma';

const DIM = 768;
const ME = 'user-me';
const CREATOR = 'user-creator';
const OTHER = 'user-other';

/** 造一个只有第 i 维为 1 的基向量（余弦距离可精确心算） */
function basis(i: number, dim = DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  vector[i] = 1;
  return vector;
}

let ctx: PglitePrisma;
let vectors: BuddyVectorPrismaRepository;
let feedbacks: BuddyFeedbackPrismaRepository;
let applications: BuddyApplicationPrismaRepository;
let posts: BuddyPostPrismaRepository;
let profiles: BuddyProfilePrismaRepository;

const NOW = new Date();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  ctx = await createPglitePrisma();
  const config = fakeConfig({ BUDDY_VECTOR_DIM: String(DIM) });
  vectors = new BuddyVectorPrismaRepository(ctx.prisma as never, config as never);
  feedbacks = new BuddyFeedbackPrismaRepository(ctx.prisma as never);
  applications = new BuddyApplicationPrismaRepository(ctx.prisma as never);
  posts = new BuddyPostPrismaRepository(ctx.prisma as never);
  profiles = new BuddyProfilePrismaRepository(ctx.prisma as never);

  await seedUser(ctx.prisma, ME, '我');
  await seedUser(ctx.prisma, CREATOR, '鸭鸭');
  await seedUser(ctx.prisma, OTHER, '同学乙');
}, 120_000);

afterAll(async () => {
  await ctx?.dispose();
});

async function createPost(overrides: {
  id: string;
  creatorId?: string;
  activity?: string;
  status?: string;
  startsAt?: Date;
  capacity?: number;
  joinedCount?: number;
  tags?: string[];
  embedding?: number[] | null;
}): Promise<void> {
  await ctx.prisma.buddyPost.create({
    data: {
      id: overrides.id,
      creatorId: overrides.creatorId ?? CREATOR,
      activity: overrides.activity ?? 'sport',
      status: overrides.status ?? 'OPEN',
      title: `活动 ${overrides.id}`,
      description: null,
      location: '体育馆',
      startsAt: overrides.startsAt ?? new Date(NOW.getTime() + DAY),
      capacity: overrides.capacity ?? 4,
      joinedCount: overrides.joinedCount ?? 1,
      tags: overrides.tags ?? [],
    },
  });
  if (overrides.embedding) {
    await vectors.setPostEmbedding(overrides.id, overrides.embedding, 'test');
  }
}

describe('迁移的真实产物（规格 §4.2 / §4.3）', () => {
  it('embedding 列是 vector(768)（format_type 实测，不是猜的）', async () => {
    const rows = await ctx.db.query<{ formatted: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS formatted
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname IN ('BuddyProfile','BuddyPost') AND a.attname='embedding'
       ORDER BY c.relname`,
    );
    expect(rows.rows.map((row) => row.formatted)).toEqual(['vector(768)', 'vector(768)']);
  });

  it('脚手架占位表 BuddyGroup 已被迁移删除', async () => {
    const rows = await ctx.db.query<{ t: string | null }>(
      `SELECT to_regclass('public."BuddyGroup"')::text AS t`,
    );
    expect(rows.rows[0]?.t).toBeNull();
  });

  it('外键真的生效（引用不存在的用户被拒）', async () => {
    await expect(
      ctx.prisma.buddyPost.create({
        data: {
          creatorId: 'does-not-exist',
          activity: 'sport',
          title: 'x',
          location: '体育馆',
          startsAt: new Date(NOW.getTime() + DAY),
          capacity: 2,
        },
      }),
    ).rejects.toThrow();
    await reconnect(ctx.prisma); // 故意制造 DB 错误后等连接恢复（见夹具注释）
  });

  it('维度约束真的生效（往 vector(768) 写 3 维被拒）', async () => {
    await seedUser(ctx.prisma, 'user-dim', '维度');
    await expect(
      ctx.prisma.$executeRaw(
        Prisma.sql`INSERT INTO "BuddyProfile" ("userId","updatedAt","embedding")
                   VALUES (${'user-dim'}, now(), ${'[1,2,3]'}::vector)`,
      ),
    ).rejects.toThrow();
    await reconnect(ctx.prisma);
  });
});

describe('向量查询（规格 §4.4，验收 T15 的注入部分）', () => {
  beforeAll(async () => {
    await createPost({ id: 'vec-near', embedding: basis(0), startsAt: new Date(NOW.getTime() + DAY) });
    await createPost({ id: 'vec-far', embedding: basis(1), startsAt: new Date(NOW.getTime() + 2 * DAY) });
    await createPost({ id: 'vec-no-embedding', embedding: null });
    await createPost({ id: 'vec-closed', status: 'CLOSED', embedding: basis(0) });
    await createPost({ id: 'vec-past', startsAt: new Date(NOW.getTime() - DAY), embedding: basis(0) });
    await createPost({ id: 'vec-study', activity: 'study', embedding: basis(0) });
  }, 60_000);

  it('`<=>` 余弦距离召回：近的在前，且过滤掉无向量/非 OPEN/已过期/不在板块内的帖子', async () => {
    const hits = await vectors.findSimilarPosts(basis(0), ['sport', 'game'], 10);
    const ids = hits.map((hit) => hit.postId);

    expect(ids).toContain('vec-near');
    expect(ids).toContain('vec-far');
    expect(ids).not.toContain('vec-no-embedding');
    expect(ids).not.toContain('vec-closed');
    expect(ids).not.toContain('vec-past');
    expect(ids).not.toContain('vec-study'); // study 不属于 sport 板块

    expect(ids[0]).toBe('vec-near');
    expect(hits[0]?.distance).toBeCloseTo(0, 6);
    expect(hits[1]?.distance).toBeCloseTo(1, 6);
  });

  it('LIMIT 生效', async () => {
    const hits = await vectors.findSimilarPosts(basis(0), ['sport'], 1);
    expect(hits).toHaveLength(1);
  });

  it('**注入不可能**：恶意字面量作为绑定参数只被当作数据，真表完好', async () => {
    const evil = `[1,0,0]'); DROP TABLE "BuddyPost"; --`;
    await expect(vectors.findSimilarPosts(evil as unknown as number[], ['sport'], 10)).rejects.toThrow();
    await reconnect(ctx.prisma); // 见夹具注释：语句级错误后 socket 会关闭连接

    // 表还在，数据还在
    const count = await ctx.prisma.buddyPost.count();
    expect(count).toBeGreaterThan(0);
    const stillThere = await ctx.prisma.buddyPost.findUnique({ where: { id: 'vec-near' } });
    expect(stillThere).not.toBeNull();
  });

  it('非数值分量在**进入 SQL 之前**就被拒绝（纵深防御，不依赖数据库报错）', async () => {
    const withNaN = [...basis(0)];
    withNaN[3] = Number.NaN;
    await expect(vectors.findSimilarPosts(withNaN, ['sport'], 10)).rejects.toThrow(/不是有限数/);
  });

  it('写入 → 读回 向量无损（embedding::text 往返）', async () => {
    // `setProfileEmbedding` 是 UPDATE：资料行必须先存在（否则影响 0 行，读回 null）
    await profiles.upsert(ME, {
      sections: ['sport'],
      interestTags: [],
      activityTags: [],
      skillLevel: 'casual',
      availability: [],
      preferredAreas: [],
      department: null,
      bio: null,
      matchEnabled: true,
    });
    await vectors.setProfileEmbedding(ME, basis(5), 'test-model');
    const read = await vectors.findProfileEmbedding(ME);
    expect(read).toHaveLength(DIM);
    expect(read?.[5]).toBe(1);
    expect(read?.filter((value) => value !== 0)).toHaveLength(1);
  });

  it('清空向量后读回 null（撤回匹配资料，验收 T30 的一半）', async () => {
    await vectors.setProfileEmbedding(ME, basis(5), 'test-model');
    await vectors.clearProfileEmbedding(ME);
    expect(await vectors.findProfileEmbedding(ME)).toBeNull();
  });

  it('批量读 embedding：只返回有向量的行', async () => {
    const map = await vectors.findPostEmbeddings(['vec-near', 'vec-no-embedding', 'vec-far']);
    expect([...map.keys()].sort()).toEqual(['vec-far', 'vec-near']);
  });
});

describe('反馈的 section 隔离（规格 §3.6，验收 T6 的数据层部分）', () => {
  it('`WHERE section = $section` **真的在 SQL 里**：academic 的 dislike 不出现在 daily 的结果里', async () => {
    await createPost({ id: 'fb-post', activity: 'study' });
    await feedbacks.upsert({
      userId: ME,
      targetPostId: 'fb-post',
      section: 'academic',
      action: 'dislike',
    });

    const academic = await feedbacks.listByUserAndSection(ME, 'academic');
    const daily = await feedbacks.listByUserAndSection(ME, 'daily');
    const sport = await feedbacks.listByUserAndSection(ME, 'sport');

    expect(academic).toHaveLength(1);
    expect(academic[0]).toMatchObject({ targetPostId: 'fb-post', action: 'dislike' });
    expect(daily).toHaveLength(0);
    expect(sport).toHaveLength(0);
  });

  it('同一帖子可以在**不同板块**各有一条反馈（唯一键含 section）', async () => {
    await createPost({ id: 'fb-post-2', activity: 'sport' });
    await feedbacks.upsert({ userId: ME, targetPostId: 'fb-post-2', section: 'academic', action: 'dislike' });
    await feedbacks.upsert({ userId: ME, targetPostId: 'fb-post-2', section: 'daily', action: 'like' });

    const academic = (await feedbacks.listByUserAndSection(ME, 'academic')).filter(
      (row) => row.targetPostId === 'fb-post-2',
    );
    const daily = (await feedbacks.listByUserAndSection(ME, 'daily')).filter(
      (row) => row.targetPostId === 'fb-post-2',
    );
    expect(academic).toHaveLength(1);
    expect(daily).toHaveLength(1);
    // daily 的 like 仍然生效（验收 T6 的后半句）
    expect(daily[0]?.action).toBe('like');
    expect(academic[0]?.action).toBe('dislike');
  });

  it('同一 (user, post, section) 重复反馈是 **UPSERT 覆盖**，不累积（规格 D11）', async () => {
    await createPost({ id: 'fb-post-3', activity: 'meal' });
    await feedbacks.upsert({ userId: ME, targetPostId: 'fb-post-3', section: 'daily', action: 'skip' });
    await feedbacks.upsert({ userId: ME, targetPostId: 'fb-post-3', section: 'daily', action: 'like' });
    await feedbacks.upsert({ userId: ME, targetPostId: 'fb-post-3', section: 'daily', action: 'like' });

    const rows = await feedbacks.listByUserAndSection(ME, 'daily');
    const forPost = rows.filter((row) => row.targetPostId === 'fb-post-3');
    expect(forPost).toHaveLength(1);
    expect(forPost[0]?.action).toBe('like');

    // 数据库层面确实只有一行（唯一索引在挡）
    const count = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "BuddyMatchFeedback" WHERE "targetPostId"='fb-post-3' AND section='daily'`,
    );
    expect(count.rows[0]?.n).toBe(1);
  });
});

describe('申请与决定的行锁事务（规格 §5.5 / §5.6）', () => {
  it('join 建 PENDING 申请且**不**递增 joinedCount（它是申请，不是入队）', async () => {
    await createPost({ id: 'lock-post-1', capacity: 2, joinedCount: 1 });
    const outcome = await applications.createLocked({ postId: 'lock-post-1', applicantId: ME, message: '一起？' });
    expect(outcome.kind).toBe('CREATED');

    const post = await ctx.prisma.buddyPost.findUnique({ where: { id: 'lock-post-1' } });
    expect(post?.joinedCount).toBe(1);
  });

  it('重复申请 → ALREADY_APPLIED（不插第二行）', async () => {
    const again = await applications.createLocked({ postId: 'lock-post-1', applicantId: ME });
    expect(again).toMatchObject({ kind: 'FAILED', reason: 'ALREADY_APPLIED' });
  });

  it('申请自己的帖子 → CANNOT_JOIN_OWN_POST', async () => {
    await createPost({ id: 'lock-post-own', creatorId: CREATOR });
    const outcome = await applications.createLocked({ postId: 'lock-post-own', applicantId: CREATOR });
    expect(outcome).toMatchObject({ kind: 'FAILED', reason: 'CANNOT_JOIN_OWN_POST' });
  });

  it('非 OPEN 的帖子 → POST_NOT_OPEN', async () => {
    await createPost({ id: 'lock-post-closed', status: 'CLOSED' });
    const outcome = await applications.createLocked({ postId: 'lock-post-closed', applicantId: ME });
    expect(outcome).toMatchObject({ kind: 'FAILED', reason: 'POST_NOT_OPEN' });
  });

  it('已满 → POST_FULL', async () => {
    await createPost({ id: 'lock-post-full', capacity: 2, joinedCount: 2 });
    const outcome = await applications.createLocked({ postId: 'lock-post-full', applicantId: ME });
    expect(outcome).toMatchObject({ kind: 'FAILED', reason: 'POST_FULL' });
  });

  it('decide(ACCEPTED) 递增 joinedCount；满员时状态转 FULL（走 canTransition）', async () => {
    await createPost({ id: 'decide-post', capacity: 2, joinedCount: 1 });
    const join = await applications.createLocked({ postId: 'decide-post', applicantId: ME });
    expect(join.kind).toBe('CREATED');
    const applicationId = join.kind === 'CREATED' ? join.application.id : '';

    const decided = await applications.decideLocked({
      postId: 'decide-post',
      applicationId,
      creatorId: CREATOR,
      decision: 'ACCEPTED',
    });

    expect(decided.kind).toBe('ACCEPTED');
    if (decided.kind === 'ACCEPTED') {
      expect(decided.post.joinedCount).toBe(2);
      expect(decided.post.status).toBe('FULL'); // 2 >= capacity
      expect(decided.application.status).toBe('ACCEPTED');
      expect(decided.application.decidedBy).toBe(CREATOR);
      expect(decided.application.decidedAt).not.toBeNull();
    }
  });

  it('⚠️ 锁内重新检查名额：申请之后名额被占满 → POST_FULL（验收 T22 的核心逻辑）', async () => {
    await createPost({ id: 'race-post', capacity: 2, joinedCount: 1 });
    const joinA = await applications.createLocked({ postId: 'race-post', applicantId: ME });
    const joinB = await applications.createLocked({ postId: 'race-post', applicantId: OTHER });
    expect(joinA.kind).toBe('CREATED');
    expect(joinB.kind).toBe('CREATED'); // 申请时两个都合法（join 不占名额）

    const first = await applications.decideLocked({
      postId: 'race-post',
      applicationId: joinA.kind === 'CREATED' ? joinA.application.id : '',
      creatorId: CREATOR,
      decision: 'ACCEPTED',
    });
    expect(first.kind).toBe('ACCEPTED'); // 占掉最后一个名额 → FULL

    // 第二次接受必须失败：**在锁内**重新读了 joinedCount
    const second = await applications.decideLocked({
      postId: 'race-post',
      applicationId: joinB.kind === 'CREATED' ? joinB.application.id : '',
      creatorId: CREATOR,
      decision: 'ACCEPTED',
    });
    expect(second).toMatchObject({ kind: 'FAILED', reason: 'POST_FULL' });

    const post = await ctx.prisma.buddyPost.findUnique({ where: { id: 'race-post' } });
    expect(post?.joinedCount).toBe(2); // 没有超员
  });

  it('非发起人 decide → NOT_CREATOR（验收 T23 的数据层部分）', async () => {
    await createPost({ id: 'perm-post', capacity: 4 });
    const join = await applications.createLocked({ postId: 'perm-post', applicantId: ME });
    const outcome = await applications.decideLocked({
      postId: 'perm-post',
      applicationId: join.kind === 'CREATED' ? join.application.id : '',
      creatorId: OTHER, // 不是发起人
      decision: 'ACCEPTED',
    });
    expect(outcome).toMatchObject({ kind: 'FAILED', reason: 'NOT_CREATOR' });
  });

  it('用**别的帖子**的 applicationId → APPLICATION_NOT_FOUND（不区分不存在与不属于该帖）', async () => {
    await createPost({ id: 'cross-a', capacity: 4 });
    await createPost({ id: 'cross-b', capacity: 4 });
    const join = await applications.createLocked({ postId: 'cross-a', applicantId: ME });
    const outcome = await applications.decideLocked({
      postId: 'cross-b',
      applicationId: join.kind === 'CREATED' ? join.application.id : '',
      creatorId: CREATOR,
      decision: 'ACCEPTED',
    });
    expect(outcome).toMatchObject({ kind: 'FAILED', reason: 'APPLICATION_NOT_FOUND' });
  });

  it('撤回后重新申请**复用同一行**（规格 U7）：状态回到 PENDING，不插新行', async () => {
    await createPost({ id: 'reuse-post', capacity: 4 });
    const join = await applications.createLocked({ postId: 'reuse-post', applicantId: ME });
    const applicationId = join.kind === 'CREATED' ? join.application.id : '';

    const withdrawn = await applications.withdraw({ postId: 'reuse-post', applicantId: ME });
    expect(withdrawn.kind).toBe('WITHDRAWN');

    const again = await applications.createLocked({ postId: 'reuse-post', applicantId: ME, message: '再试一次' });
    expect(again.kind).toBe('REACTIVATED');
    if (again.kind === 'REACTIVATED') {
      expect(again.application.id).toBe(applicationId); // 同一行
      expect(again.application.status).toBe('PENDING');
      expect(again.application.message).toBe('再试一次');
    }

    const rows = await ctx.prisma.buddyApplication.findMany({ where: { postId: 'reuse-post' } });
    expect(rows).toHaveLength(1);
  });

  it('已 ACCEPTED 的申请不能撤回 → APPLICATION_NOT_PENDING', async () => {
    await createPost({ id: 'accepted-post', capacity: 4 });
    const join = await applications.createLocked({ postId: 'accepted-post', applicantId: ME });
    await applications.decideLocked({
      postId: 'accepted-post',
      applicationId: join.kind === 'CREATED' ? join.application.id : '',
      creatorId: CREATOR,
      decision: 'ACCEPTED',
    });
    const withdrawn = await applications.withdraw({ postId: 'accepted-post', applicantId: ME });
    expect(withdrawn).toMatchObject({ kind: 'FAILED', reason: 'APPLICATION_NOT_PENDING' });
  });
});

describe('帖子仓储（真实 SQL）', () => {
  it('列表默认按 createdAt_desc 且游标可翻页（无重复无跳过）', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await posts.list({ limit: 3, cursor, sort: 'createdAt_desc', startsAfter: new Date(0) });
      for (const item of result.items) seen.push(item.post.id);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length); // 无重复
    const all = await posts.list({ limit: 1000, sort: 'createdAt_desc', startsAfter: new Date(0) });
    expect(seen.length).toBe(all.items.length); // 无跳过
  }, 60_000);

  it('startsAt_asc 的**复合游标**不跳条（规格 §5.9 / U3 的偏离点）', async () => {
    // 造一批 startsAt 与 id 顺序**相反**的帖子：这是单键游标会跳条的场景
    const base = NOW.getTime() + 10 * DAY;
    for (let i = 0; i < 5; i += 1) {
      await createPost({
        id: `cursor-z${i}`, // id 升序
        startsAt: new Date(base + (5 - i) * HOUR), // startsAt 降序 → 与 id 顺序相反
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await posts.list({
        limit: 2,
        cursor,
        sort: 'startsAt_asc',
        startsAfter: new Date(base - DAY),
      });
      for (const item of result.items) seen.push(item.post.id);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    const expected = seen.length;
    const all = await posts.list({ limit: 100, sort: 'startsAt_asc', startsAfter: new Date(base - DAY) });
    expect(expected).toBe(all.items.length);
    // 顺序确实是 startsAt 升序
    const times = all.items.map((item) => item.post.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  }, 60_000);

  it('findRuleCandidates 不需要任何扩展（纯 PostgreSQL）且按 startsAt 升序', async () => {
    const rows = await posts.findRuleCandidates(['sport', 'game'], 10, NOW);
    expect(rows.length).toBeGreaterThan(0);
    const times = rows.map((row) => row.post.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const row of rows) {
      expect(row.post.status).toBe('OPEN');
      expect(row.post.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('findById 对已删除（deletedAt 非空）返回 null —— 与"不存在"同一个 404', async () => {
    await createPost({ id: 'soft-deleted' });
    await ctx.prisma.buddyPost.update({ where: { id: 'soft-deleted' }, data: { deletedAt: new Date() } });
    expect(await posts.findById('soft-deleted')).toBeNull();
    expect(await posts.findById('no-such-id')).toBeNull();
  });

  it('findMyApplicationStatuses 只返回该用户的申请', async () => {
    await createPost({ id: 'status-post', capacity: 4 });
    await applications.createLocked({ postId: 'status-post', applicantId: ME });
    const mine = await posts.findMyApplicationStatuses(ME, ['status-post']);
    const others = await posts.findMyApplicationStatuses(OTHER, ['status-post']);
    expect(mine.get('status-post')).toBe('PENDING');
    expect(others.has('status-post')).toBe(false);
  });
});

describe('资料仓储（真实 SQL）', () => {
  it('findEnabledByUserIds **只**返回 matchEnabled=true 的行（规格 §6.3）', async () => {
    await seedUser(ctx.prisma, 'user-enabled', '开了匹配');
    await seedUser(ctx.prisma, 'user-disabled', '没开匹配');
    await profiles.upsert('user-enabled', {
      sections: ['sport'],
      interestTags: ['badminton'],
      activityTags: [],
      skillLevel: 'regular',
      availability: [],
      preferredAreas: [],
      department: '信息学院',
      bio: null,
      matchEnabled: true,
    });
    await profiles.upsert('user-disabled', {
      sections: ['sport'],
      interestTags: ['music'],
      activityTags: [],
      skillLevel: 'casual',
      availability: [],
      preferredAreas: [],
      department: null,
      bio: null,
      matchEnabled: false,
    });

    const map = await profiles.findEnabledByUserIds(['user-enabled', 'user-disabled']);
    expect(map.has('user-enabled')).toBe(true);
    expect(map.has('user-disabled')).toBe(false);
  });

  it('remove 是硬删（行真的没了）', async () => {
    await profiles.upsert(ME, {
      sections: ['sport'],
      interestTags: [],
      activityTags: [],
      skillLevel: 'casual',
      availability: [],
      preferredAreas: [],
      department: null,
      bio: null,
      matchEnabled: true,
    });
    expect(await profiles.findByUserId(ME)).not.toBeNull();
    await profiles.remove(ME);
    expect(await profiles.findByUserId(ME)).toBeNull();
  });

  it('availability 的 Json 往返（数组结构不被压成字符串）', async () => {
    await profiles.upsert(ME, {
      sections: ['sport'],
      interestTags: [],
      activityTags: [],
      skillLevel: 'casual',
      availability: [{ dow: 6, startMin: 840, endMin: 1020 }],
      preferredAreas: ['体育馆'],
      department: null,
      bio: null,
      matchEnabled: true,
    });
    const read = await profiles.findByUserId(ME);
    expect(read?.availability).toEqual([{ dow: 6, startMin: 840, endMin: 1020 }]);
  });
});
