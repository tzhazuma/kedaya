import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IdempotencyStore } from '../src/common/idempotency/idempotency.store';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AUTH_PORT, USER_REPOSITORY, type UserRecord, type UserRepository } from '../src/modules/auth/domain/auth.domain';
import { CampusCardModule } from '../src/modules/campus-card/campus-card.module';
import { CAMPUS_CARD_TRANSACTION_REPOSITORY } from '../src/modules/campus-card/domain/campus-card.domain';
import { ScheduleModule } from '../src/modules/schedule/schedule.module';
import { TechpieModule } from '../src/modules/techpie/techpie.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createInMemoryDelegate, type InMemoryDelegate } from './fixtures/fake-prisma';

/**
 * TechPie 整合 **Phase 0 端到端验收**（规格 §9.1 的 P0-1 … P0-8）
 *
 * ## 这组测试为什么走真实 HTTP
 *
 * 它装配**真实的**控制器 / 守卫 / 拦截器 / 异常过滤器 / 仓储 / 用例，
 * 只把两样东西换成假的：
 *   · `PrismaService`  → 内存版（本机没有 PostgreSQL，先例见 `wildlife-http.spec.ts`）；
 *   · `USER_REPOSITORY` → 内存账户表（避免 `include` 关系查询）。
 *
 * 因此"409 而不是 401"、"白名单 403"、"响应里没有凭证键名"这些结论
 * 是**在真实请求/响应上**验证的，不是对着 mock 断言。
 *
 * ## 上游**全超时**的环境是刻意的（I5）
 *
 * `AUTH_PORT` 与校园会话表的读操作都被注入 300ms 延迟。
 * 于是：
 *   · `GET /auth/session` 必须 < 50ms（它**不得**碰任何上游）；
 *   · `GET /auth/me` 会被拖慢（它**确实**要读绑定）—— 这一条是**对照**，
 *     用来证明"延迟是真的存在"，否则 I5 的断言可能只是测了个空环境。
 */

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const ENC_KEY = '0'.repeat(64);
const USER_ID = 'user-techpie';
const OTHER_USER_ID = 'user-other';

/** 上游延迟（ms）：足以让"碰了上游"的端点明显超预算 */
const UPSTREAM_LATENCY_MS = 300;

const delay = <T>(value: T, ms = UPSTREAM_LATENCY_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

/* ------------------------------------------------------------------ *
 * 假基础设施
 * ------------------------------------------------------------------ */

/**
 * I5 的**因果**证据（不只是计时）：记录"读取校园会话表"的次数。
 *
 * `GET /auth/session` 是**纯本地读取** —— 它必须一次都不碰校园会话表。
 * 计时断言在负载高时会抖，所以真正的判据是这些计数器（确定性的），
 * 计时只是同一命题的旁证。
 */
const campusSessionReads = { count: 0 };

/** 校园会话表：读操作**故意**很慢（用于 I5 的对照） */
const campusSessionDelegate: InMemoryDelegate = createInMemoryDelegate([], 'session');
const slowCampusSession: InMemoryDelegate = {
  ...campusSessionDelegate,
  findMany: async (args) => {
    campusSessionReads.count += 1;
    return delay(await campusSessionDelegate.findMany(args));
  },
  findFirst: async (args) => {
    campusSessionReads.count += 1;
    return delay(await campusSessionDelegate.findFirst(args));
  },
  findUnique: async (args) => {
    campusSessionReads.count += 1;
    return delay(await campusSessionDelegate.findUnique(args));
  },
};

const techpieLink = createInMemoryDelegate([], 'link');
const techpieSyncJob = createInMemoryDelegate([], 'job');
const scheduleCourse = createInMemoryDelegate([], 'course');

const fakePrisma = {
  techpieLink,
  techpieSyncJob,
  campusSession: slowCampusSession,
  scheduleCourse,
  $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

const fakeConfig = {
  get: (key: string): string | undefined =>
    ({
      JWT_SECRET,
      JWT_ACCESS_TTL: '900',
      JWT_REFRESH_TTL: '2592000',
      CAMPUS_SESSION_ENC_KEY: ENC_KEY,
    })[key],
};

const usersById = new Map<string, UserRecord>();

const fakeUsers: UserRepository = {
  async upsertFromIdentity(identity) {
    const id = USER_ID;
    const record: UserRecord = {
      id,
      displayName: identity.realName ?? '同学',
      avatarUrl: null,
      department: identity.department ?? null,
      studentId: identity.externalId,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    usersById.set(id, record);
    return record;
  },
  async findById(id) {
    return usersById.get(id) ?? null;
  },
};

/** 上游身份提供方：**永远超时**（I5 的环境要求），并且是可断言的 spy */
const upstreamAuthCalls = { count: 0 };
const hangingAuthPort = {
  authenticateTicket: async (): Promise<never> => {
    upstreamAuthCalls.count += 1;
    await delay(null);
    throw new Error('上游 CAS 超时');
  },
};

/** 校园卡汇总：e2e 只关心"绑定后可读"，用固定值代替聚合查询 */
const fakeCampusCardRepo = {
  list: async () => ({ items: [], nextCursor: null }),
  findById: async () => null,
  create: async () => {
    throw new Error('not used');
  },
  update: async () => {
    throw new Error('not used');
  },
  remove: async () => undefined,
  summarize: async () => ({ totalOutFen: 1234, totalInFen: 5000, count: 3 }),
};

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: ConfigService, useValue: fakeConfig },
  ],
  exports: [PrismaService, ConfigService],
})
class FakeInfraModule {}

@Module({
  imports: [FakeInfraModule, TechpieModule, AuthModule, ScheduleModule, CampusCardModule],
  providers: [
    TraceMiddleware,
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class TechpieProbeModule {}

/* ------------------------------------------------------------------ *
 * 断言工具
 * ------------------------------------------------------------------ */

/** 契约 §11.4 I1 的 8 个禁用键名（在测试里独立抄一遍，避免实现改了测试跟着漂） */
const FORBIDDEN_KEYS = [
  'cookie',
  'cookies',
  'session',
  'sessiontoken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
];

/** 递归收集一个 JSON 结构里出现的所有键名（小写、忽略 `_`/`-`） */
function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.push(key.toLowerCase().replace(/[_-]/g, ''));
      collectKeys(child, acc);
    }
  }
  return acc;
}

/**
 * P0-8：响应体里绝不允许出现的键名。
 *
 * ⚠️ **已登记的规格内部冲突**：契约 §11.4 I1 与规格 §8.3 把 `ticket` 列为禁用键，
 * 而规格 §8.4 的 `POST /webview-session` 响应**明文要求**返回 `ticket`。
 * 我们按 I1 的**本意**执行 —— 禁令保护的是**一级身份会话**与**绑定摘要**
 * （"别把二级凭证混进一级通道"）—— 而 WebView 票据是一个**独立的一次性资源**，
 * 它本身不是校园凭证（不含任何 cookie 材料，30 秒、一次性、绑定 host）。
 *
 * 因此：`ticket` 只在那一个端点的响应里被**显式放行**，其余一律禁止。
 * 这条冲突已写进交付说明的未决问题，需要 Lead 收敛契约措辞。
 */
function expectNoCredentialKeys(body: unknown, label: string, allow: readonly string[] = []): void {
  const keys = collectKeys(body);
  const leaked = keys.filter((key) => FORBIDDEN_KEYS.includes(key) && !allow.includes(key));
  expect(leaked, `${label} 的响应里出现了禁用键名`).toEqual([]);
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  traceId: string;
}

describe('TechPie Phase 0 · 端到端验收（规格 §9.1 的 P0-1 … P0-8）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  let otherToken: string;

  const auth = (bearer = token): Record<string, string> => ({ authorization: `Bearer ${bearer}` });
  const jsonAuth = (bearer = token): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${bearer}`,
  });

  beforeAll(async () => {
    usersById.set(USER_ID, {
      id: USER_ID,
      displayName: '同学0001',
      avatarUrl: null,
      department: '信息学院',
      studentId: '20260001',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    usersById.set(OTHER_USER_ID, {
      id: OTHER_USER_ID,
      displayName: '同学0002',
      avatarUrl: null,
      department: '生命学院',
      studentId: '20260002',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    const moduleRef = await Test.createTestingModule({ imports: [TechpieProbeModule] })
      .overrideProvider(USER_REPOSITORY)
      .useValue(fakeUsers)
      .overrideProvider(AUTH_PORT)
      .useValue(hangingAuthPort)
      .overrideProvider(CAMPUS_CARD_TRANSACTION_REPOSITORY)
      .useValue(fakeCampusCardRepo)
      .compile();

    // DI 图能被解析（含 TechpieModule → AuthModule/ScheduleModule/CampusCardModule 的跨模块依赖）
    expect(moduleRef.get(IdempotencyStore)).toBeInstanceOf(IdempotencyStore);

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;

    token = signJwt(USER_ID, 'access', JWT_SECRET, 900);
    otherToken = signJwt(OTHER_USER_ID, 'access', JWT_SECRET, 900);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /* ================================================================ *
   * P0-1 / I1：一级身份会话不含 8 个禁用键
   * ================================================================ */

  describe('P0-1 · I1：KedaYaIdentitySession 的序列化', () => {
    it('GET /auth/session 恰好返回 4 个身份字段', async () => {
      const response = await fetch(`${baseUrl}/auth/session`, { headers: auth() });
      const body = (await response.json()) as Envelope<Record<string, unknown>>;

      expect(response.status).toBe(200);
      expect(Object.keys(body.data!).sort()).toEqual(['department', 'name', 'studentId', 'userId']);
      expect(body.data!.studentId).toBe('20260001');
    });

    it('GET /auth/session 的响应体里扫不到 8 个禁用键名，也没有长 base64 串', async () => {
      const response = await fetch(`${baseUrl}/auth/session`, { headers: auth() });
      const body = await response.json();

      expectNoCredentialKeys(body, 'GET /auth/session');
      expect(JSON.stringify(body)).not.toMatch(/castgc|tgc|sessionToken/i);
      expect(JSON.stringify(body)).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
    });

    it('未登录 → 401 UNAUTHENTICATED', async () => {
      const response = await fetch(`${baseUrl}/auth/session`);
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(401);
      expect(body.error!.code).toBe('UNAUTHENTICATED');
    });
  });

  /* ================================================================ *
   * P0-5 / I5：GET /auth/session 在上游全超时下 < 50ms
   * ================================================================ */

  describe('P0-5 · I5：启动路径不被上游拖死（契约 §8 首帧）', () => {
    it('⚠️ 因果判据：GET /auth/session 一次都不碰上游身份与校园会话表', async () => {
      // 预热一次（首次请求含路由解析/懒加载，不算进预算）
      await fetch(`${baseUrl}/auth/session`, { headers: auth() });

      const authBefore = upstreamAuthCalls.count;
      const sessionBefore = campusSessionReads.count;

      const response = await fetch(`${baseUrl}/auth/session`, { headers: auth() });
      expect(response.status).toBe(200);

      // 这才是 I5 的真正内容："不得触发任何上游调用"
      expect(upstreamAuthCalls.count).toBe(authBefore);
      expect(campusSessionReads.count).toBe(sessionBefore);
    });

    it('mock 上游全超时下，GET /auth/session < 50ms 返回（取 5 次最优，避免负载抖动）', async () => {
      await fetch(`${baseUrl}/auth/session`, { headers: auth() });

      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        const response = await fetch(`${baseUrl}/auth/session`, { headers: auth() });
        best = Math.min(best, performance.now() - started);
        expect(response.status).toBe(200);
      }

      // 取最优值：这台机器同时跑着 55 个 vitest worker + PGlite，
      // 单次测量的抖动与"有没有调上游"无关（后者由上面的因果判据钉死）。
      expect(best).toBeLessThan(50);
    });

    it('对照组：POST /auth/login 确实会被上游拖慢（证明"超时环境"是真的）', async () => {
      // `AUTH_PORT` 被替换成"300ms 后超时"的假上游。
      // 如果 I5 的断言只是在空环境里跑得快，这条对照就会一起变快 —— 于是 I5 失效。
      const started = performance.now();
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: 'mock-20260001' }),
      });
      const elapsed = performance.now() - started;

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeGreaterThanOrEqual(UPSTREAM_LATENCY_MS - 50);
    });
  });

  /* ================================================================ *
   * P0-4 / I4：已登录但未绑定 → 409（不是 401）
   * ================================================================ */

  describe('P0-4 · I4：登录但未绑定 → 409 CAMPUS_BINDING_REQUIRED', () => {
    it('带合法 JWT 但没绑定时访问 schedule → 409（**不是** 401）', async () => {
      const response = await fetch(`${baseUrl}/schedule/items`, { headers: auth() });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(409);
      expect(body.error!.code).toBe('CAMPUS_BINDING_REQUIRED');
      expect(body.error!.code).not.toBe('UNAUTHENTICATED');
    });

    it('409 的 details 里机器可见地告诉客户端"去绑定"（不是"重新登录"）', async () => {
      const response = await fetch(`${baseUrl}/schedule/items`, { headers: auth() });
      const body = (await response.json()) as Envelope<never>;

      expect(body.error!.details).toMatchObject({ platform: 'cpdaily', next: 'GO_BIND' });
    });

    it('完全没有 JWT → 401 UNAUTHENTICATED（两种状态必须区分开）', async () => {
      const response = await fetch(`${baseUrl}/schedule/items`);
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(401);
      expect(body.error!.code).toBe('UNAUTHENTICATED');
    });

    it('已绑定 cpdaily（直接造数据，**不经过绑定接口**）→ 放行', async () => {
      // ⚠️ 这里刻意**绕过** `POST /techpie/links`：Phase 0 没有 cpdaily 的绑定路径，
      // 因此只能直接造一行"已绑定"的元数据来验证守卫的放行分支。
      // 注意造的是 **TechpieLink 元数据**，没有 CampusSession 行 ——
      // 也就是说这个测试**没有**制造任何校园凭证副本。
      techpieLink.rows.push({
        id: 'seed-cpdaily',
        userId: USER_ID,
        provider: 'cpdaily',
        status: 'LINKED',
        externalUserId: '20260001',
        tokenCipher: null,
        expiresAt: null,
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const response = await fetch(`${baseUrl}/schedule/items`, { headers: auth() });
      expect(response.status).toBe(200);

      // 清理，避免影响后续用例
      const index = techpieLink.rows.findIndex((row) => row.id === 'seed-cpdaily');
      if (index >= 0) techpieLink.rows.splice(index, 1);
    });
  });

  /* ================================================================ *
   * P0-6：校园卡 OPENID 绑定，全程不产生任何 CASTGC
   * ================================================================ */

  describe('P0-6 · 校园卡走 OPENID 通道（与 CASTGC 完全解耦）', () => {
    it('POST /techpie/links（ecard + openid）→ 201 LINKED', async () => {
      const response = await fetch(`${baseUrl}/techpie/links`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'bind-ecard-1' },
        body: JSON.stringify({
          platform: 'ecard',
          credential: { kind: 'openid', channel: 'wechat', openId: 'openid-20260001' },
        }),
      });
      const body = (await response.json()) as Envelope<{ platform: string; status: string }>;

      expect(response.status).toBe(201);
      expect(body.data).toMatchObject({ platform: 'ecard', status: 'LINKED' });
    });

    it('绑定后余额查询成功（第二级能力可用）', async () => {
      const response = await fetch(`${baseUrl}/campus-card/summary`, { headers: auth() });
      const body = (await response.json()) as Envelope<{ totalOutFen: number }>;

      expect(response.status).toBe(200);
      expect(body.data!.totalOutFen).toBe(1234);
    });

    it('⚠️ 数据库断言：CampusSession 只有 ecard 行，**没有任何 cpdaily 行**', () => {
      const platforms = campusSessionDelegate.rows.map((row) => row.platform);
      expect(platforms).toContain('ecard');
      expect(platforms).not.toContain('cpdaily');
      expect(platforms).not.toContain('egate');
      expect(platforms).not.toContain('cas');
    });

    it('⚠️ 全库扫描：没有任何一行含 CASTGC / tgc= 明文', () => {
      const dump = JSON.stringify({
        links: techpieLink.rows,
        sessions: campusSessionDelegate.rows,
        jobs: techpieSyncJob.rows,
      });
      expect(dump).not.toMatch(/castgc|CASTGC|tgc=/);
    });

    it('密文落库（库里看不到 OPENID 明文）', () => {
      const row = campusSessionDelegate.rows.find((item) => item.platform === 'ecard')!;
      expect(String(row.sessionCipher)).toMatch(/^v1\./);
      expect(String(row.sessionCipher)).not.toContain('openid-20260001');
    });

    it('绑定响应里不含 8 个禁用键名（P0-8 的一部分）', async () => {
      const response = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const body = await response.json();
      expectNoCredentialKeys(body, 'GET /techpie/links');
    });
  });

  /* ================================================================ *
   * Phase 1+ 的绑定：**没有任何路径**（裁决 §11.18-D）
   * ================================================================ */

  describe('Phase 1+ 的绑定被拒绝，且**一行都不写库**', () => {
    it('POST /techpie/links（cpdaily）→ 403 FORBIDDEN，且没有新行', async () => {
      const before = { links: techpieLink.rows.length, sessions: campusSessionDelegate.rows.length };

      const response = await fetch(`${baseUrl}/techpie/links`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'bind-cpdaily-1' },
        body: JSON.stringify({
          platform: 'cpdaily',
          credential: { kind: 'openid', channel: 'wechat', openId: 'x' },
        }),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(403);
      expect(body.error!.code).toBe('FORBIDDEN');
      expect(body.error!.details).toMatchObject({ reason: 'PHASE_BLOCKED' });
      expect(techpieLink.rows.length).toBe(before.links);
      expect(campusSessionDelegate.rows.length).toBe(before.sessions);
    });

    it('POST /techpie/links（明文密码）→ 403，且密码**不出现在响应里**', async () => {
      const response = await fetch(`${baseUrl}/techpie/links`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'bind-password-1' },
        body: JSON.stringify({
          platform: 'ecard',
          credential: { kind: 'password', studentId: '20260001', password: 'hunter2' },
        }),
      });
      const raw = await response.text();

      expect(response.status).toBe(403);
      expect(raw).not.toContain('hunter2');
      expect(raw).toContain('PLAIN_PASSWORD_REFUSED');
    });

    it('POST /auth/campus-bindings（cpdaily）同样被拒绝（兼容端点不绕过合规闸门）', async () => {
      const response = await fetch(`${baseUrl}/auth/campus-bindings`, {
        method: 'POST',
        headers: jsonAuth(),
        body: JSON.stringify({ platform: 'cpdaily', credential: { kind: 'openid', channel: 'wechat', openId: 'x' } }),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(403);
      expect(body.error!.details).toMatchObject({ reason: 'PHASE_BLOCKED' });
    });
  });

  /* ================================================================ *
   * P0-7：webview-session 的白名单（fail-closed）
   * ================================================================ */

  describe('P0-7 · POST /techpie/webview-session 的白名单校验', () => {
    it('非白名单域名 → 403 FORBIDDEN（P0-7）', async () => {
      const response = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'wv-evil-1' },
        body: JSON.stringify({ platform: 'ecard', targetUrl: 'https://evil.com/' }),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(403);
      expect(body.error!.code).toBe('FORBIDDEN');
      expect(body.error!.details).toMatchObject({ reason: 'TARGET_URL_NOT_ALLOWED', check: 'NOT_ALLOWLISTED' });
    });

    it.each([
      ['userinfo 绕过', 'https://shanghaitech.edu.cn@evil.com/'],
      ['非 443 端口', 'https://ecourse.shanghaitech.edu.cn:8443/'],
      ['IP 字面量', 'https://127.0.0.1/'],
      ['后缀通配绕过', 'https://ecourse.shanghaitech.edu.cn.evil.com/'],
      ['学校根域（不允许通配整个 shanghaitech.edu.cn）', 'https://shanghaitech.edu.cn/'],
    ])('服务端拒绝 %s → 403', async (_label, url) => {
      const response = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: `wv-${encodeURIComponent(url)}` },
        body: JSON.stringify({ platform: 'ecard', targetUrl: url }),
      });
      expect(response.status).toBe(403);
    });

    it('http 明文 → 422 VALIDATION_FAILED', async () => {
      const response = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'wv-http-1' },
        body: JSON.stringify({ platform: 'ecard', targetUrl: 'http://ecourse.shanghaitech.edu.cn/' }),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(422);
      expect(body.error!.code).toBe('VALIDATION_FAILED');
    });

    it('白名单内的地址 → 201 一次性票据（30 秒 / singleUse / 不含 cookie）', async () => {
      const response = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'wv-ok-1' },
        body: JSON.stringify({ platform: 'ecard', targetUrl: 'https://ecourse.shanghaitech.edu.cn/' }),
      });
      const body = (await response.json()) as Envelope<{
        ticket: string;
        expiresInSec: number;
        singleUse: boolean;
        targetHost: string;
      }>;

      expect(response.status).toBe(201);
      expect(body.data!.ticket.startsWith('wvt_')).toBe(true);
      expect(body.data!.expiresInSec).toBe(30);
      expect(body.data!.singleUse).toBe(true);
      expect(body.data!.targetHost).toBe('ecourse.shanghaitech.edu.cn');
      // `ticket` 是规格 §8.4 明文规定的响应字段（见上面 expectNoCredentialKeys 的说明）
      expectNoCredentialKeys(body, 'POST /techpie/webview-session', ['ticket']);
      // 但它**绝不含**任何 cookie 材料 —— 票据是引用，不是凭证
      expect(JSON.stringify(body)).not.toMatch(/CASTGC|JSESSIONID|EGATE=/i);
      expect(JSON.stringify(body)).not.toMatch(/cookie/i);
    });

    it('用票据换一次性打开地址 → mode=direct（W4：用户自登录，我们不接触 cookie）', async () => {
      const issueResponse = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'wv-ok-2' },
        body: JSON.stringify({ targetUrl: 'https://elrc.shanghaitech.edu.cn/' }),
      });
      const issued = (await issueResponse.json()) as Envelope<{ ticket: string }>;

      const response = await fetch(`${baseUrl}/techpie/webview-session/${issued.data!.ticket}`, {
        method: 'POST',
        headers: auth(),
      });
      const body = (await response.json()) as Envelope<{ mode: string; cookieInjected: boolean }>;

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({ mode: 'direct', cookieInjected: false });
    });

    it('票据**用后即焚**：第二次兑换 → 404', async () => {
      const issueResponse = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: { ...jsonAuth(), [IDEMPOTENCY_HEADER]: 'wv-ok-3' },
        body: JSON.stringify({ targetUrl: 'https://elrc.shanghaitech.edu.cn/' }),
      });
      const issued = (await issueResponse.json()) as Envelope<{ ticket: string }>;
      const url = `${baseUrl}/techpie/webview-session/${issued.data!.ticket}`;

      expect((await fetch(url, { method: 'POST', headers: auth() })).status).toBe(200);
      expect((await fetch(url, { method: 'POST', headers: auth() })).status).toBe(404);
    });

    it('缺 Idempotency-Key → VALIDATION_FAILED（契约 §11.3）', async () => {
      const response = await fetch(`${baseUrl}/techpie/webview-session`, {
        method: 'POST',
        headers: jsonAuth(),
        body: JSON.stringify({ targetUrl: 'https://elrc.shanghaitech.edu.cn/' }),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(body.error!.code).toBe('VALIDATION_FAILED');
    });
  });

  /* ================================================================ *
   * P0-8：全部响应不含 8 个凭证键名
   * ================================================================ */

  describe('P0-8 · techpie 与 campus-card 的全部响应都不含凭证键名', () => {
    it('GET /techpie/capabilities（含 allowlistPlaceholder 机器可见标记）', async () => {
      const response = await fetch(`${baseUrl}/techpie/capabilities`, { headers: auth() });
      const body = (await response.json()) as Envelope<{
        items: unknown[];
        allowlistPlaceholder: boolean;
        unboundCount: number;
      }>;

      expect(response.status).toBe(200);
      expect(body.data!.allowlistPlaceholder).toBe(true);
      expect(body.data!.items.length).toBeGreaterThan(0);
      expectNoCredentialKeys(body, 'GET /techpie/capabilities');
    });

    it('未绑定项以 CAMPUS_BINDING_REQUIRED **引导**返回，而不是报错', async () => {
      // 用一个没绑定的用户（OTHER_USER_ID）
      const response = await fetch(`${baseUrl}/techpie/capabilities`, { headers: auth(otherToken) });
      const body = (await response.json()) as Envelope<{
        items: Array<{ id: string; status: string; guidance: string | null }>;
        unboundCount: number;
      }>;

      expect(response.status).toBe(200); // 200 而不是 409 —— 清单本身不是校园能力
      const balance = body.data!.items.find((item) => item.id === 'ecard.balance')!;
      expect(balance.status).toBe('CAMPUS_BINDING_REQUIRED');
      expect(balance.guidance).toBeTruthy();
      expect(body.data!.unboundCount).toBeGreaterThan(0);
    });

    it('GET /techpie/links / GET /techpie/links/:id / GET /techpie/sync-jobs 都不含凭证键名', async () => {
      const listResponse = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const list = (await listResponse.json()) as Envelope<{ items: Array<{ id: string }> }>;
      expect(listResponse.status).toBe(200);
      expectNoCredentialKeys(list, 'GET /techpie/links');

      const linkId = list.data!.items[0]!.id;
      const detailResponse = await fetch(`${baseUrl}/techpie/links/${linkId}`, { headers: auth() });
      expect(detailResponse.status).toBe(200);
      expectNoCredentialKeys(await detailResponse.json(), 'GET /techpie/links/:id');

      const jobsResponse = await fetch(`${baseUrl}/techpie/sync-jobs`, { headers: auth() });
      expect(jobsResponse.status).toBe(200);
      expectNoCredentialKeys(await jobsResponse.json(), 'GET /techpie/sync-jobs');
    });

    it('GET /campus-card/summary 不含凭证键名', async () => {
      const response = await fetch(`${baseUrl}/campus-card/summary`, { headers: auth() });
      expect(response.status).toBe(200);
      expectNoCredentialKeys(await response.json(), 'GET /campus-card/summary');
    });
  });

  /* ================================================================ *
   * 其余端点的行为（规格 §8.1 的 8 个端点逐一覆盖）
   * ================================================================ */

  describe('规格 §8.1 · 其余端点的行为', () => {
    it('GET /techpie/links/:id 非本人 → 404（不泄漏存在性）', async () => {
      const listResponse = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const list = (await listResponse.json()) as Envelope<{ items: Array<{ id: string }> }>;
      const linkId = list.data!.items[0]!.id;

      const response = await fetch(`${baseUrl}/techpie/links/${linkId}`, { headers: auth(otherToken) });
      expect(response.status).toBe(404);
    });

    it('POST /techpie/links/:id/renew → 409 CONFLICT / RENEW_NOT_SUPPORTED（不谎称已续期）', async () => {
      const listResponse = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const list = (await listResponse.json()) as Envelope<{ items: Array<{ id: string }> }>;
      const linkId = list.data!.items[0]!.id;

      const response = await fetch(`${baseUrl}/techpie/links/${linkId}/renew`, {
        method: 'POST',
        headers: { ...auth(), [IDEMPOTENCY_HEADER]: 'renew-1' },
      });
      const body = (await response.json()) as Envelope<never>;

      expect(response.status).toBe(409);
      expect(body.error!.code).toBe('CONFLICT');
      expect(body.error!.details).toMatchObject({ reason: 'RENEW_NOT_SUPPORTED' });
    });

    it('DELETE /techpie/links/:id → 真正删除凭证副本（CampusSession 整行消失）', async () => {
      const listResponse = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const list = (await listResponse.json()) as Envelope<{ items: Array<{ id: string }> }>;
      const linkId = list.data!.items[0]!.id;
      expect(campusSessionDelegate.rows.length).toBeGreaterThan(0);

      const response = await fetch(`${baseUrl}/techpie/links/${linkId}`, { method: 'DELETE', headers: auth() });
      expect(response.status).toBe(200);

      // 硬删：凭证副本**真的没了**
      expect(campusSessionDelegate.rows.filter((row) => row.userId === USER_ID)).toHaveLength(0);
      // 解绑后能力回到"需绑定"（不是登出）
      const summary = await fetch(`${baseUrl}/campus-card/summary`, { headers: auth() });
      const body = (await summary.json()) as Envelope<never>;
      expect(summary.status).toBe(409);
      expect(body.error!.code).toBe('CAMPUS_BINDING_REQUIRED');
    });

    it('GET /techpie/links 走游标分页（limit 生效、nextCursor 形状正确）', async () => {
      const response = await fetch(`${baseUrl}/techpie/links?limit=1`, { headers: auth() });
      const body = (await response.json()) as Envelope<{ items: unknown[]; nextCursor: string | null }>;

      expect(response.status).toBe(200);
      expect(body.data!.items.length).toBeLessThanOrEqual(1);
      expect(body.data!.nextCursor === null || typeof body.data!.nextCursor === 'string').toBe(true);
    });

    it('非法 cursor → 422/400 VALIDATION_FAILED（严格校验，不把噪声喂给数据库）', async () => {
      const response = await fetch(`${baseUrl}/techpie/links?cursor=!!!not-base64!!!`, { headers: auth() });
      const body = (await response.json()) as Envelope<never>;

      expect(body.error!.code).toBe('VALIDATION_FAILED');
    });

    it('响应头带 traceId，且与信封里的 traceId 一致', async () => {
      const response = await fetch(`${baseUrl}/techpie/links`, { headers: auth() });
      const body = (await response.json()) as Envelope<unknown>;

      expect(response.headers.get(TRACE_HEADER)).toBe(body.traceId);
    });
  });

  /* ================================================================ *
   * 兼容端点：/auth/campus-bindings 仍然可用（冻结 OpenAPI 已登记）
   * ================================================================ */

  describe('兼容端点 · /auth/campus-bindings', () => {
    it('GET /auth/campus-bindings 返回绑定摘要（**不含凭证**）', async () => {
      const response = await fetch(`${baseUrl}/auth/campus-bindings`, { headers: auth() });
      const body = (await response.json()) as Envelope<unknown[]>;

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expectNoCredentialKeys(body, 'GET /auth/campus-bindings');
    });

    it('GET /auth/campus-bindings/:platform/capability 只回布尔值', async () => {
      const response = await fetch(`${baseUrl}/auth/campus-bindings/ecard/capability`, { headers: auth() });
      const body = (await response.json()) as Envelope<{ available: boolean }>;

      expect(response.status).toBe(200);
      expect(typeof body.data!.available).toBe('boolean');
    });

    it('DELETE /auth/campus-bindings/:platform 对不存在的平台值 → VALIDATION_FAILED', async () => {
      const response = await fetch(`${baseUrl}/auth/campus-bindings/not-a-platform`, {
        method: 'DELETE',
        headers: auth(),
      });
      const body = (await response.json()) as Envelope<never>;

      expect(body.error!.code).toBe('VALIDATION_FAILED');
    });
  });
});
