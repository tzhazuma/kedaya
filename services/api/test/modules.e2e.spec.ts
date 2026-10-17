import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, modulePath, TRACE_HEADER } from '@kedaya/contracts';
import { AppModule } from '../src/app.module';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { PrismaService } from '../src/prisma/prisma.service';
import { BUDDY_ACTIVITIES } from '../src/modules/buddy/domain/buddy.domain';
import { FORUM_BOARDS } from '../src/modules/forum/domain/forum.domain';
import { DORM_HARMONY_EXPECTATIONS } from '../src/modules/dorm-harmony/domain/dorm-harmony.domain';

/**
 * **六模块端到端**测试：真实 HTTP + 真实 PostgreSQL + 真实 JWT。
 *
 * 与其它三个测试文件的分工：
 *   · `*.service.spec.ts`            —— 领域规则（假仓储）
 *   · `local-auth.integration.spec.ts` —— 自建账号打真库
 *   · `app-assembly.spec.ts`         —— 只证明"能装配起来"
 *   · **本文件**                     —— 六个模块的**主流程真的能跑通**：
 *     注册两个账号 → 一个发布、另一个响应 → 状态机走完，
 *     并且每一步都过了 Nest 管道 / 守卫 / Prisma。
 *
 * 数据库不可用时整组跳过。
 */

const PASSWORD = 'Kedaya2026';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  traceId: string;
}

describe('六模块端到端（真实 HTTP + 真实 Postgres）', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let base: string;
  let dbAvailable = false;

  /** 清理用：记录本次造出的所有数据 */
  const created = {
    emails: [] as string[],
    flea: [] as string[],
    errand: [] as string[],
    buddy: [] as string[],
    lostFound: [] as string[],
    forum: [] as string[],
    dormCases: [] as string[],
  };

  let ownerToken = '';
  let otherToken = '';
  let ownerId = '';
  let otherId = '';

  beforeAll(async () => {
    process.env.AUTH_DEV_EXPOSE_CODES = 'true';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));

    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }, 60_000);

  afterAll(async () => {
    if (dbAvailable) {
      // 关系都没有配 onDelete: Cascade，按依赖倒序手动清理
      await prisma.forumReply.deleteMany({ where: { postId: { in: created.forum } } });
      await prisma.forumPost.deleteMany({ where: { id: { in: created.forum } } });
      await prisma.buddyMember.deleteMany({ where: { groupId: { in: created.buddy } } });
      await prisma.buddyGroup.deleteMany({ where: { id: { in: created.buddy } } });
      await prisma.dormHarmonyMessage.deleteMany({ where: { caseId: { in: created.dormCases } } });
      await prisma.dormHarmonyCase.deleteMany({ where: { id: { in: created.dormCases } } });
      await prisma.fleaItem.deleteMany({ where: { id: { in: created.flea } } });
      await prisma.errandTask.deleteMany({ where: { id: { in: created.errand } } });
      await prisma.lostFoundItem.deleteMany({ where: { id: { in: created.lostFound } } });
      await prisma.verificationCode.deleteMany({ where: { target: { in: created.emails } } });
      // 审计日志：动作来自这两个账号，以及匿名模块（actorId 为 null，只能按资源 id 清）
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: [ownerId, otherId] } },
            {
              resourceId: {
                in: [
                  ...created.flea,
                  ...created.errand,
                  ...created.buddy,
                  ...created.lostFound,
                  ...created.forum,
                  ...created.dormCases,
                ],
              },
            },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { credential: { email: { in: created.emails } } } });
    }
    await app?.close();
  }, 60_000);

  /* ---------------- HTTP 小工具 ---------------- */

  /**
   * 拼 URL。`modulePath()` 返回的是**不带前导斜杠**的相对路径
   * （`'flea-market/items'`），直接拼会得到 `/api/v1flea-market/items` ——
   * 这种路径连全局前缀都不匹配，会掉到 Express 的原生 404（HTML），
   * 而不是 Nest 的 JSON 信封。所以统一在这里补斜杠。
   */
  function url(path: string): string {
    return `${base}/${API_BASE_PATH.replace(/^\//, '')}/${path.replace(/^\/+/, '')}`.replace(
      /\/+$/,
      '',
    );
  }

  async function call<T>(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<{ status: number; envelope: Envelope<T> }> {
    const response = await fetch(url(path), {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const envelope = (await response.json()) as Envelope<T>;
    return { status: response.status, envelope };
  }

  /** 期望成功：失败时把后端的真实错误抛出来，方便定位 */
  async function ok<T>(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<T> {
    const { status, envelope } = await call<T>(path, options);
    if (!envelope.ok) {
      throw new Error(`${options.method ?? 'GET'} ${path} → ${status} ${envelope.error?.code}: ${envelope.error?.message}`);
    }
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(envelope.traceId).toMatch(/^[0-9a-f-]{36}$/);
    return envelope.data as T;
  }

  /** 期望失败，返回错误码与文案 */
  async function fail(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<{ status: number; code: string; message: string }> {
    const { status, envelope } = await call(path, options);
    expect(envelope.ok, `${path} 本应失败但成功了`).toBe(false);
    return { status, code: envelope.error?.code ?? '', message: envelope.error?.message ?? '' };
  }

  async function registerUser(tag: string): Promise<{ id: string; token: string }> {
    const email = `e2e-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@kedaya.test`;
    created.emails.push(email);

    const receipt = await ok<{ devCode?: string }>('/auth/account/register/code', {
      method: 'POST',
      body: { email },
    });
    expect(receipt.devCode).toMatch(/^\d{6}$/);

    const session = await ok<{ user: { id: string }; accessToken: string }>(
      '/auth/account/register',
      { method: 'POST', body: { email, code: receipt.devCode, password: PASSWORD } },
    );
    return { id: session.user.id, token: session.accessToken };
  }

  const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  beforeAll(async () => {
    if (!dbAvailable) return;
    const owner = await registerUser('owner');
    const other = await registerUser('other');
    ownerId = owner.id;
    otherId = other.id;
    ownerToken = owner.token;
    otherToken = other.token;
  }, 60_000);

  /* ---------------- 未登录也能读（幂等，各方可缓存） ---------------- */

  it('六个模块的公开列表都可匿名读取，且是统一分页形状', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    for (const path of [
      modulePath('flea-market', 'items'),
      modulePath('errand', 'items'),
      modulePath('buddy', 'groups'),
      modulePath('lost-found', 'items'),
      modulePath('forum', 'posts'),
    ]) {
      const page = await ok<{ items: unknown[]; nextCursor: string | null }>(path);
      expect(Array.isArray(page.items), path).toBe(true);
      expect(page.nextCursor === null || typeof page.nextCursor === 'string', path).toBe(true);
    }

    const boards = await ok<Array<{ board: string; postCount: number }>>(
      modulePath('forum', 'boards'),
    );
    expect(boards.map((row) => row.board)).toEqual([...FORUM_BOARDS]);
  });

  it('宿舍矛盾**不提供**公开列表（403，旱在隐私上不做取舍）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const result = await fail(modulePath('dorm-harmony', 'cases'));
    expect(result.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  it('未登录写操作一律 401，而不是 500 或静默成功', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const cases: Array<[string, string, unknown]> = [
      [modulePath('flea-market', 'items'), 'POST', { title: 'x', priceFen: 1, category: 'books' }],
      [modulePath('errand', 'items'), 'POST', { title: 'x' }],
      [modulePath('buddy', 'groups'), 'POST', { title: 'x' }],
      [modulePath('lost-found', 'items'), 'POST', { title: 'x' }],
      [modulePath('forum', 'posts'), 'POST', { title: 'x' }],
    ];

    for (const [path, method, body] of cases) {
      const result = await fail(path, { method, body });
      expect(result.status, path).toBe(401);
      expect(result.code, path).toBe('UNAUTHENTICATED');
    }
  });

  /* ---------------- 跳蚤市场 ---------------- */

  it('跳蚤市场：发布 → 别人预定 → 卖家标记售出，状态机全程落库', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const items = modulePath('flea-market', 'items');
    const item = await ok<{ id: string; status: string; priceFen: number; sellerId: string }>(
      items,
      {
        method: 'POST',
        token: ownerToken,
        body: {
          title: 'E2E 机械键盘',
          description: '成色不错',
          priceFen: 12_800,
          category: 'electronics',
          condition: 'good',
          campusSpot: '二号宿舍楼下',
        },
      },
    );
    created.flea.push(item.id);
    expect(item.status).toBe('on-sale');
    expect(item.sellerId).toBe(ownerId);
    expect(item.priceFen).toBe(12_800);

    // 卖家不能预定自己的东西
    expect((await fail(`${items}/${item.id}/reserve`, { method: 'POST', token: ownerToken })).code).toBe(
      'VALIDATION_FAILED',
    );

    const reserved = await ok<{ status: string; reservedById: string }>(
      `${items}/${item.id}/reserve`,
      { method: 'POST', token: otherToken },
    );
    expect(reserved.status).toBe('reserved');
    expect(reserved.reservedById).toBe(otherId);

    // 已被预定 → 另一个人再预定是冲突（同一买家再来一次也会被拒）
    expect((await fail(`${items}/${item.id}/reserve`, { method: 'POST', token: otherToken })).status).toBe(
      409,
    );

    const sold = await ok<{ status: string; soldAt: string | null }>(
      `${items}/${item.id}/sold`,
      { method: 'POST', token: ownerToken },
    );
    expect(sold.status).toBe('sold');
    expect(sold.soldAt).not.toBeNull();

    // mine=1 能查到自己的发布，别人的查不到
    const mine = await ok<{ items: Array<{ id: string }> }>(`${items}?mine=1&limit=50`, {
      token: ownerToken,
    });
    expect(mine.items.map((row) => row.id)).toContain(item.id);

    const others = await ok<{ items: Array<{ id: string }> }>(`${items}?mine=1&limit=50`, {
      token: otherToken,
    });
    expect(others.items.map((row) => row.id)).not.toContain(item.id);

    // 状态筛选真的按状态过滤
    const soldList = await ok<{ items: Array<{ id: string; status: string }> }>(
      `${items}?status=sold&limit=50`,
    );
    expect(soldList.items.every((row) => row.status === 'sold')).toBe(true);
    expect(soldList.items.map((row) => row.id)).toContain(item.id);
  }, 30_000);

  /* ---------------- 跑腿 ---------------- */

  it('跑腿：发布 → 接单 → 送达 → 确认完成（且只允许对应角色操作）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const items = modulePath('errand', 'items');
    const task = await ok<{ id: string; status: string; requesterId: string }>(items, {
      method: 'POST',
      token: ownerToken,
      body: {
        title: 'E2E 取快递',
        detail: '菜鸟驿站 3 号柜',
        rewardFen: 500,
        fromPlace: '菜鸟驿站',
        toPlace: '5 号楼',
        deadline: future(6),
      },
    });
    created.errand.push(task.id);
    expect(task.status).toBe('open');
    expect(task.requesterId).toBe(ownerId);

    // 发布者不能接自己的单
    expect((await fail(`${items}/${task.id}/accept`, { method: 'POST', token: ownerToken })).code).toBe(
      'VALIDATION_FAILED',
    );

    const accepted = await ok<{ status: string; runnerId: string }>(`${items}/${task.id}/accept`, {
      method: 'POST',
      token: otherToken,
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.runnerId).toBe(otherId);

    // 发布者不能替跑腿者点"已送达"
    expect((await fail(`${items}/${task.id}/deliver`, { method: 'POST', token: ownerToken })).code).toBe(
      'FORBIDDEN',
    );

    const delivered = await ok<{ status: string }>(`${items}/${task.id}/deliver`, {
      method: 'POST',
      token: otherToken,
    });
    expect(delivered.status).toBe('delivered');

    // 跑腿者不能自己确认完成
    expect((await fail(`${items}/${task.id}/complete`, { method: 'POST', token: otherToken })).status).toBe(
      403,
    );

    const done = await ok<{ status: string }>(`${items}/${task.id}/complete`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(done.status).toBe('completed');

    // 终态后不能再取消
    expect((await fail(`${items}/${task.id}/cancel`, { method: 'POST', token: ownerToken })).status).toBe(
      409,
    );

    const detail = await ok<{ id: string; status: string }>(`${items}/${task.id}`);
    expect(detail.status).toBe('completed');
  }, 30_000);

  /* ---------------- 找搭子 ---------------- */

  it('找搭子：发起 → 加入至满员自动置 full → 组长关闭', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const groups = modulePath('buddy', 'groups');
    const group = await ok<{ id: string; status: string; capacity: number }>(groups, {
      method: 'POST',
      token: ownerToken,
      body: {
        activity: BUDDY_ACTIVITIES[0],
        title: 'E2E 图书馆自习',
        description: '一下午',
        campusSpot: '图书馆 3 楼',
        startsAt: future(24),
        capacity: 2,
      },
    });
    created.buddy.push(group.id);
    expect(group.status).toBe('recruiting');
    expect(group.capacity).toBe(2);

    // 组长自己"加入"自己的搭子是非法操作（400 而不是 409，与后端一致）
    expect((await fail(`${groups}/${group.id}/join`, { method: 'POST', token: ownerToken })).status).toBe(
      400,
    );

    await ok(`${groups}/${group.id}/join`, { method: 'POST', token: otherToken });

    const full = await ok<{ status: string; members: unknown[] }>(`${groups}/${group.id}`);
    expect(full.status).toBe('full');
    expect(full.members).toHaveLength(2);

    // 满员后再加入
    const rejected = await fail(`${groups}/${group.id}/join`, { method: 'POST', token: ownerToken });
    expect(rejected.code).toBe('VALIDATION_FAILED');

    // 满员状态不允许"停止招募"（只有 recruiting 才能 close）
    expect((await fail(`${groups}/${group.id}/close`, { method: 'POST', token: ownerToken })).status).toBe(409);

    // 有人退出 → 回落 recruiting（空位重新可加入）→ 组长关闭
    const left = await ok<{ status: string }>(`${groups}/${group.id}/leave`, {
      method: 'POST',
      token: otherToken,
    });
    expect(left.status).toBe('recruiting');

    const closed = await ok<{ status: string }>(`${groups}/${group.id}/close`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(closed.status).toBe('closed');

    // 关闭后不能再加入
    expect((await fail(`${groups}/${group.id}/join`, { method: 'POST', token: otherToken })).status).toBe(409);
  }, 30_000);

  /* ---------------- 失物招领 ---------------- */

  it('失物招领：发布 → 搜索 → 标记已找回 ↔ 重新开启', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const items = modulePath('lost-found', 'items');
    const item = await ok<{ id: string; status: string; kind: string }>(items, {
      method: 'POST',
      token: ownerToken,
      body: {
        kind: 'lost',
        title: 'E2E 蓝色水杯',
        description: '有贴纸',
        place: '一教 302',
        happenedAt: new Date(Date.now() - 3_600_000).toISOString(),
        contactHint: '站内信',
      },
    });
    created.lostFound.push(item.id);
    expect(item.status).toBe('open');
    expect(item.kind).toBe('lost');

    const searched = await ok<{ items: Array<{ id: string }> }>(`${items}?q=蓝色水杯&limit=50`);
    expect(searched.items.map((row) => row.id)).toContain(item.id);

    const filtered = await ok<{ items: Array<{ kind: string }> }>(`${items}?kind=found&limit=50`);
    expect(filtered.items.every((row) => row.kind === 'found')).toBe(true);

    const resolved = await ok<{ status: string }>(`${items}/${item.id}/resolve`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(resolved.status).toBe('resolved');

    // 重复标记是冲突
    expect((await fail(`${items}/${item.id}/resolve`, { method: 'POST', token: ownerToken })).status).toBe(409);

    const reopened = await ok<{ status: string; resolvedAt: string | null }>(
      `${items}/${item.id}/reopen`,
      { method: 'POST', token: ownerToken },
    );
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeNull();

    // 不是发布者不能改
    expect((await fail(`${items}/${item.id}`, { method: 'PATCH', token: otherToken, body: { title: '改我的' } })).status).toBe(403);
  }, 30_000);

  /* ---------------- 论坛 ---------------- */

  it('论坛：发帖 → 回复 → 关闭后不能再回复；匿名帖不可关闭', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const posts = modulePath('forum', 'posts');
    const post = await ok<{ id: string; status: string; replyCount: number }>(posts, {
      method: 'POST',
      token: ownerToken,
      body: { board: FORUM_BOARDS[0], title: 'E2E 主题', body: '大家好，这是端到端测试主题。' },
    });
    created.forum.push(post.id);
    expect(post.status).toBe('published');
    expect(post.replyCount).toBe(0);

    // 再发一条匿名帖：不保存作者身份
    const anon = await ok<{ id: string; authorId: string | null }>(posts, {
      method: 'POST',
      token: ownerToken,
      body: { board: FORUM_BOARDS[1], title: 'E2E 匿名主题', body: '不想被认出来', anonymous: true },
    });
    created.forum.push(anon.id);
    expect(anon.authorId).toBeNull();

    // mine=1 = 我发的（匿名帖没有作者，因此天然不在其中）
    const mine = await ok<{ items: Array<{ id: string }> }>(`${posts}?mine=1&limit=50`, {
      token: ownerToken,
    });
    expect(mine.items.map((row) => row.id)).toContain(post.id);
    expect(mine.items.map((row) => row.id)).not.toContain(anon.id);

    await ok(`${posts}/${post.id}/replies`, {
      method: 'POST',
      token: otherToken,
      body: { body: '第一条回复' },
    });

    const detail = await ok<{
      post: { replyCount: number; lastReplyAt: string | null };
      replies: { items: Array<{ body: string }>; nextCursor: string | null };
    }>(`${posts}/${post.id}`);
    expect(detail.post.replyCount).toBe(1);
    expect(detail.post.lastReplyAt).not.toBeNull();
    expect(detail.replies.items.map((row) => row.body)).toContain('第一条回复');

    // 非作者不能关闭
    expect((await fail(`${posts}/${post.id}/close`, { method: 'POST', token: otherToken })).status).toBe(403);

    await ok(`${posts}/${post.id}/close`, { method: 'POST', token: ownerToken });

    // 关闭后回复是冲突
    expect(
      (await fail(`${posts}/${post.id}/replies`, { method: 'POST', token: otherToken, body: { body: '来晚了' } })).status,
    ).toBe(409);

    // 关闭后的主题不在默认列表（默认只看 published），但显式筛 closed 能查到
    const publishedList = await ok<{ items: Array<{ id: string }> }>(`${posts}?limit=50`);
    expect(publishedList.items.map((row) => row.id)).not.toContain(post.id);
    const closedList = await ok<{ items: Array<{ id: string }> }>(
      `${posts}?status=closed&limit=50`,
    );
    expect(closedList.items.map((row) => row.id)).toContain(post.id);

    // 匿名帖：任何人（包括原作者）都不能关闭或删除
    const anonClose = await fail(`${posts}/${anon.id}/close`, { method: 'POST', token: ownerToken });
    expect(anonClose.code).toBe('FORBIDDEN');
    expect((await fail(`${posts}/${anon.id}`, { method: 'DELETE', token: ownerToken })).code).toBe('FORBIDDEN');
  }, 30_000);

  /* ---------------- 宿舍矛盾（匿名） ---------------- */

  it('宿舍矛盾：匿名提交拿一次性追踪码 → 凭码查看/留言 → 他人拿不到；调解员可回复', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const cases = modulePath('dorm-harmony', 'cases');
    const submitted = await ok<{ case: { id: string; status: string; anonHandle: string }; trackCode: string }>(
      cases,
      {
        method: 'POST',
        body: {
          building: '5 号楼',
          topic: '作息时间冲突',
          detail: '室友凌晨打游戏外放',
          expectation: DORM_HARMONY_EXPECTATIONS[0],
        },
      },
    );
    const caseId = submitted.case.id;
    created.dormCases.push(caseId);
    expect(submitted.case.status).toBe('submitted');
    expect(submitted.case.anonHandle.length).toBeGreaterThan(0);

    // 明文追踪码只返回这一次；库里只存哈希
    const row = await prisma.dormHarmonyCase.findUnique({ where: { id: caseId } });
    expect(row?.trackCodeHash).not.toBe(submitted.trackCode);
    expect(row?.trackCodeHash).toHaveLength(64);

    // 凭码可看
    const detail = await ok<{ id: string; messages: unknown[] }>(
      `${cases}/${caseId}?trackCode=${encodeURIComponent(submitted.trackCode)}`,
    );
    expect(detail.id).toBe(caseId);
    expect(detail.messages).toHaveLength(0);

    // 错码 / 不存在的案子 → 同一句话，不给枚举信号
    const wrongCode = await fail(`${cases}/${caseId}?trackCode=WRONG-CODE-0000`);
    const ghostCase = await fail(`${cases}/00000000-0000-0000-0000-000000000000?trackCode=WRONG-CODE-0000`);
    expect(wrongCode.message).toBe(ghostCase.message);
    expect(wrongCode.status).toBe(ghostCase.status);

    // 留言会把 submitted 推进为 in-progress
    const message = await ok<{ caseStatus: string }>(`${cases}/${caseId}/messages`, {
      method: 'POST',
      body: { trackCode: submitted.trackCode, body: '希望能当面聊一次' },
    });
    expect(message.caseStatus).toBe('in-progress');

    // 调解员回复需要登录，且是唯一实名入口
    expect(
      (await fail(`${cases}/${caseId}/mediator-reply`, { method: 'POST', body: { body: '我来跟进' } })).status,
    ).toBe(401);
    await ok(`${cases}/${caseId}/mediator-reply`, {
      method: 'POST',
      token: ownerToken,
      body: { body: '我是楼层调解员，我来跟进。' },
    });

    const withReplies = await ok<{ messages: Array<{ fromRole: string }> }>(
      `${cases}/${caseId}?trackCode=${encodeURIComponent(submitted.trackCode)}`,
    );
    expect(withReplies.messages.map((row) => row.fromRole)).toEqual(['student', 'mediator']);

    // 学生自己结案
    const closed = await ok<{ status: string }>(`${cases}/${caseId}/close`, {
      method: 'POST',
      body: { trackCode: submitted.trackCode },
    });
    expect(closed.status).toBe('closed');
  }, 30_000);

  it('响应头带回同一个 traceId（跨端串联链路）', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const response = await fetch(url(modulePath('flea-market', 'items')));
    const body = (await response.json()) as { traceId: string };
    expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
  });
});
