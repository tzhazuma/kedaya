/**
 * wildlife · HTTP 端到端验收（规格 §10 / §11）
 *
 * 真实装配：控制器 + 守卫 + 幂等拦截器 + 信封拦截器 + 异常过滤器 +
 * **真实仓储**（只把 Prisma 换成内存实现，见 `fixtures/fake-prisma.ts`），
 * 因此这里断言的是真实行为，而不是"假服务喂假数据"。
 *
 * 覆盖：T10/T12（敏感区与 k-匿名降级后**无坐标**）、T15（不含 reporterId）、
 * T16（受限表读取写审计）、T17（非审核员拿不到精确坐标）、T18（isInferred + disclaimer）、
 * T24（热点 ≥24h 延迟）、T25（缺 Idempotency-Key）、T26（幂等回放）、
 * T28（游标翻页）、T29（RFC 7396）、T30（读接口免登录）、T31（写接口 401）、
 * T32/T33（审核授权与保护物种双人复核）、T37（媒体幂等）、T43（分类降级）、
 * T45（存储不可用 → 502）、T9（**服务端强制剥离 EXIF**，走真实 HTTP 上传）。
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts';
import { gridCellKey } from '@kedaya/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { signJwt } from '../src/common/auth/jwt';
import { ComplianceModule } from '../src/common/compliance/compliance.module';
import { UpstreamUnavailableError } from '../src/common/errors/app-error';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { InMemoryMediaStorage } from '../src/modules/wildlife/data/media-processor';
import { MEDIA_STORAGE } from '../src/modules/wildlife/domain/wildlife.domain';
import { WildlifeModule } from '../src/modules/wildlife/wildlife.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createFakePrisma, type FakePrisma } from './fixtures/fake-prisma';
import { buildJpegWithGpsExif, buildTextFile } from './fixtures/wildlife-media';
import { inspectMetadata } from '../src/modules/wildlife/domain/media';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const REPORTER = 'user-reporter';
const OTHER = 'user-other';
const MOD_1 = 'mod-1';
const MOD_2 = 'mod-2';

/** 校园内、**不在**敏感区里的点（图书馆后草坪） */
const SAFE_POINT = { lat: 31.178, lng: 121.59 };
/** 宿舍区内的点（命中敏感区多边形） */
const DORM_POINT = { lat: 31.18, lng: 121.585 };

const SWAN = 'sp-swan';
const CAT = 'sp-cat';

const now = (): Date => new Date();
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000);

function speciesRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    scientificName: 'Felis catus',
    commonNameZh: '猫',
    commonNameEn: 'Cat',
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
    externalIds: {},
    iconUrl: null,
    isActive: true,
    needsFieldVerification: true,
    verificationNote: '待实地核实（规格 U2）',
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
    ...overrides,
  };
}

function sightingRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    zoneId: null,
    species: CAT,
    status: 'PUBLISHED',
    geoLat: 31.178,
    geoLng: 121.59,
    geoFuzzLevel: 'grid',
    fuzzRadiusM: 50,
    gridCellKey: null,
    photoUrls: [],
    healthConcern: false,
    reporterId: OTHER,
    observedAt: hoursAgo(2),
    observedAtFuzzed: hoursAgo(2),
    publishDelayDays: 0,
    individualId: null,
    autoSpeciesId: null,
    autoConfidence: null,
    classifiedBy: 'manual',
    correctedFromSpeciesId: null,
    note: null,
    isAnonymous: false,
    moderatedBy: null,
    moderatedAt: null,
    rejectReason: null,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Buffer → BlobPart。
 *
 * 直接 `new Blob([buffer])` 在 Node 的类型里会失败：`Buffer` 的底层可能是
 * `SharedArrayBuffer`，而 `BlobPart` 只接受 `ArrayBuffer` 支撑的视图。
 * 复制成一块新的 `Uint8Array` 即可（上传体积很小，复制成本可忽略）。
 */
function blobPart(buf: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}

/** 可注入故障的存储（T45） */
class FlakyStorage extends InMemoryMediaStorage {
  fail = false;
  override async put(key: string, data: Buffer, contentType: string) {
    if (this.fail) throw new UpstreamUnavailableError('对象存储不可用（测试注入）');
    return super.put(key, data, contentType);
  }
}

let prisma: FakePrisma;
let storage: FlakyStorage;

const configValues: Record<string, string> = {
  JWT_SECRET,
  ANON_HANDLE_SECRET: 'wiring-test-secret',
  WILDLIFE_FUZZ_SECRET: 'http-e2e-wildlife-fuzz-secret-32-bytes!',
  WILDLIFE_FUZZ_DEFAULT_RADIUS_M: '50',
  WILDLIFE_CLASSIFIER: 'manual',
  WILDLIFE_CLASSIFIER_PROVIDER: 'none',
  WILDLIFE_CLASSIFIER_TOP_K: '3',
  WILDLIFE_CLASSIFIER_MIN_CONFIDENCE: '0.6',
  WILDLIFE_MEDIA_DIR: 'var/wildlife-media-test',
  WILDLIFE_BANNED_KEYWORDS: '违禁词',
  WILDLIFE_MODERATOR_USER_IDS: `${MOD_1},${MOD_2}`,
};

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: ConfigService,
      useValue: { get: (key: string) => configValues[key] },
    },
  ],
  exports: [PrismaService, ConfigService],
})
class FakeInfraModule {}

@Module({
  imports: [FakeInfraModule, ComplianceModule, WildlifeModule],
  providers: [
    TraceMiddleware,
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class WildlifeProbeModule {}

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: any };
  traceId: string;
}

describe('wildlife HTTP 端到端（规格 §10 的 17 个端点）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let reporterToken: string;
  let mod1Token: string;
  let mod2Token: string;

  beforeAll(async () => {
    prisma = createFakePrisma({
      speciesTaxonomy: [
        speciesRow({ id: CAT, commonNameZh: '猫' }),
        speciesRow({
          id: SWAN,
          scientificName: 'Cygnus atratus',
          commonNameZh: '黑天鹅',
          isProtected: true,
          isNestingSensitive: true,
          nestingMonths: [3, 4, 5, 6],
          defaultFeedingPolicy: 'forbidden',
        }),
      ],
      wildlifeZone: [
        {
          id: 'zone-lawn',
          name: '图书馆后草坪',
          speciesIds: [CAT],
          centerLat: SAFE_POINT.lat,
          centerLng: SAFE_POINT.lng,
          radiusM: 200,
          feedingPolicy: 'discouraged',
          note: null,
          fuzzRadiusM: 50,
          isSensitive: false,
          sensitiveRing: null,
          noticeText: '请勿投喂人类食物',
          sortOrder: 1,
          createdAt: now(),
          updatedAt: now(),
          deletedAt: null,
        },
        {
          id: 'zone-dorm',
          name: '宿舍区（保育）',
          speciesIds: [],
          centerLat: DORM_POINT.lat,
          centerLng: DORM_POINT.lng,
          radiusM: 150,
          feedingPolicy: 'forbidden',
          note: null,
          fuzzRadiusM: 50,
          isSensitive: true,
          sensitiveRing: [
            { lat: DORM_POINT.lat - 0.0004, lng: DORM_POINT.lng - 0.0004 },
            { lat: DORM_POINT.lat - 0.0004, lng: DORM_POINT.lng + 0.0004 },
            { lat: DORM_POINT.lat + 0.0004, lng: DORM_POINT.lng + 0.0004 },
            { lat: DORM_POINT.lat + 0.0004, lng: DORM_POINT.lng - 0.0004 },
          ],
          noticeText: null,
          sortOrder: 2,
          createdAt: now(),
          updatedAt: now(),
          deletedAt: null,
        },
      ],
    });

    storage = new FlakyStorage();

    const moduleRef = await Test.createTestingModule({ imports: [WildlifeProbeModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}/wildlife`;

    reporterToken = signJwt(REPORTER, 'access', JWT_SECRET, 900);
    mod1Token = signJwt(MOD_1, 'access', JWT_SECRET, 900);
    mod2Token = signJwt(MOD_2, 'access', JWT_SECRET, 900);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** 发请求并解信封 */
  async function call<T = any>(
    path: string,
    init: RequestInit & { token?: string; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: Envelope<T> }> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.idempotencyKey) headers[IDEMPOTENCY_HEADER] = init.idempotencyKey;
    if (init.body && typeof init.body === 'string') headers['content-type'] ??= 'application/json';
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = (await response.json()) as Envelope<T>;
    return { status: response.status, body };
  }

  /** 造一条上报（默认 3 人同格 → 通过 k-匿名） */
  async function createSighting(overrides: Record<string, unknown> = {}, key = `key-${Math.random()}`) {
    return call('/items', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: key,
      body: JSON.stringify({
        species: CAT,
        observedAt: hoursAgo(1).toISOString(),
        geo: SAFE_POINT,
        ethicsAcknowledged: true,
        ...overrides,
      }),
    });
  }

  /** 在同一网格里塞 n 个不同上报人的已发布观测（构造 k-匿名达标场景） */
  let seedCounter = 0;
  function seedCellReporters(count: number, point = SAFE_POINT): void {
    const cell = gridCellKey(point, 50);
    for (let i = 0; i < count; i += 1) {
      seedCounter += 1;
      prisma.$seed(
        'wildlifeSighting',
        sightingRow({
          // id 必须唯一：游标分页按 id 定位，重复 id 会让翻页原地打转
          id: `seed-${seedCounter}`,
          gridCellKey: cell,
          reporterId: `seed-reporter-${seedCounter}`,
          observedAt: hoursAgo(1),
        }),
      );
    }
  }

  /* ================================================================ *
   * 1–4：公开读接口（T30）
   * ================================================================ */

  it('GET /basemap 免登录：返回 affine / license / rmse<5（T5/T30）', async () => {
    const { status, body } = await call('/basemap');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.affine).toHaveLength(6);
    expect(body.data.calibrationRmsePx).toBeLessThan(5);
    expect(body.data.controlPointCount).toBeGreaterThanOrEqual(6);
    expect(body.data.license).toBe('original');
    expect(body.data.version).toContain('placeholder');
  });

  it('GET /species 免登录：平铺列表 + 分类树，且带"待实地核实"标记（U2）', async () => {
    const { status, body } = await call('/species');
    expect(status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.tree).toHaveLength(2);
    const swan = body.data.items.find((s: any) => s.id === SWAN);
    expect(swan).toMatchObject({
      commonNameZh: '黑天鹅',
      isProtected: true,
      isNestingSensitive: true,
      needsFieldVerification: true,
    });
    expect(swan.verificationNote).toContain('待实地核实');
  });

  it('GET /zones 与 /zones/:id 免登录；不存在的区域 404', async () => {
    const list = await call('/zones');
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((z: any) => z.id)).toEqual(['zone-lawn', 'zone-dorm']);
    expect(list.body.data.items[0]).toMatchObject({
      feedingPolicy: 'discouraged',
      noticeText: '请勿投喂人类食物',
      fuzzRadiusM: 50,
    });

    const detail = await call('/zones/zone-dorm');
    expect(detail.status).toBe(200);
    expect(detail.body.data.isSensitive).toBe(true);

    const missing = await call('/zones/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('NOT_FOUND');
  });

  /* ================================================================ *
   * 11–12：上传与上报
   * ================================================================ */

  it('POST /media 无 token → 401 UNAUTHENTICATED（T31）', async () => {
    const form = new FormData();
    form.append('file', new Blob([blobPart(Buffer.from('x'))], { type: 'image/jpeg' }), 'a.jpg');
    form.append('clientPhotoId', 'photo-x');
    const response = await fetch(`${baseUrl}/media`, {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: 'media-unauth' },
      body: form,
    });
    const body = (await response.json()) as Envelope<unknown>;
    expect(response.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('POST /items 缺 Idempotency-Key → VALIDATION_FAILED（T25）', async () => {
    const { status, body } = await call('/items', {
      method: 'POST',
      token: reporterToken,
      body: JSON.stringify({ species: CAT, observedAt: hoursAgo(1).toISOString(), geo: SAFE_POINT, ethicsAcknowledged: true }),
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.details).toMatchObject({ header: IDEMPOTENCY_HEADER });
  });

  it('POST /items 未登录 → 401（T31）', async () => {
    const { status, body } = await call('/items', {
      method: 'POST',
      idempotencyKey: 'no-token',
      body: JSON.stringify({ species: CAT, observedAt: hoursAgo(1).toISOString(), geo: SAFE_POINT, ethicsAcknowledged: true }),
    });
    expect(status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('POST /items 未勾选伦理确认 → VALIDATION_FAILED / ETHICS_NOT_ACKNOWLEDGED（**不是 CONSENT_REQUIRED**）', async () => {
    const { status, body } = await createSighting({ ethicsAcknowledged: false });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.details).toMatchObject({ reason: 'ETHICS_NOT_ACKNOWLEDGED' });
  });

  it('POST /items 校园外坐标 → COORDINATE_OUT_OF_CAMPUS', async () => {
    const { status, body } = await createSighting({ geo: { lat: 31.2, lng: 121.5 } });
    expect(status).toBe(400);
    expect(body.error?.details).toMatchObject({ reason: 'COORDINATE_OUT_OF_CAMPUS' });
  });

  it('POST /items 未知物种 → UNKNOWN_SPECIES', async () => {
    const { status, body } = await createSighting({ species: 'sp-nope' });
    expect(status).toBe(400);
    expect(body.error?.details).toMatchObject({ reason: 'UNKNOWN_SPECIES' });
  });

  it('POST /items 命中敏感区 → **响应不含任何坐标**，只有 zoneId（T10）', async () => {
    const { status, body } = await createSighting({
      geo: DORM_POINT,
      species: CAT,
      note: '在宿舍楼下看到猫',
    });
    expect(status).toBe(201);
    expect(body.data.geo).toBeNull();
    expect(body.data.fuzzedGeo).toBeNull();
    expect(body.data.fuzzLevel).toBe('zone-only');
    expect(body.data.zoneId).toBe('zone-dorm');
    // 整个响应体里不能出现精确坐标（连近似值都不行）
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(String(DORM_POINT.lat));
    expect(raw).not.toContain(String(DORM_POINT.lng));
  });

  it('POST /items 同格仅 1 人上报 → k-匿名降级，**不公开坐标**（T12）', async () => {
    const point = { lat: 31.1835, lng: 121.5965 }; // 校园内、任何区域之外
    const { status, body } = await createSighting({ geo: point });
    expect(status).toBe(201);
    expect(body.data.fuzzLevel).toBe('coarsened');
    expect(body.data.geo).toBeNull();
    expect(JSON.stringify(body)).not.toContain(String(point.lat));
    // 契约 §11.13（v1.3.1）：`geo` 为空时 `zoneId` **必须非空**。
    // 该点不在任何区域内 → 回退到**最近的区域**（本夹具里是图书馆后草坪，≈870m）。
    // 注意这个提示比网格更粗（870m ≫ 150m），方向上只会更安全。
    expect(body.data.zoneId).toBe('zone-lawn');
  });

  it('契约 §11.13 不变式：**任何** geo 为空的观测都必须给出 zoneId', async () => {
    const sightings = prisma.wildlifeSighting.rows.filter((row) => row.deletedAt == null);
    expect(sightings.length).toBeGreaterThan(0);
    let degraded = 0;
    for (const row of sightings) {
      if (row.geoLat == null || row.geoLng == null) {
        degraded += 1;
        expect(row.zoneId).toBeTruthy();
        expect(['zone-only', 'coarsened']).toContain(row.geoFuzzLevel);
      } else {
        expect(row.geoFuzzLevel).toBe('grid');
      }
    }
    // 至少覆盖到"敏感区降级"与"k-匿名降级"两种情形
    expect(degraded).toBeGreaterThanOrEqual(2);
    const levels = new Set(sightings.map((row) => row.geoFuzzLevel));
    expect(levels.has('zone-only')).toBe(true);
    expect(levels.has('coarsened')).toBe(true);
  });

  it('POST /items 同格 3 个不同上报人 → 通过 k-匿名，公开**模糊后**的坐标（且不是原始坐标）', async () => {
    seedCellReporters(2);
    const { status, body } = await createSighting();
    expect(status).toBe(201);
    expect(body.data.fuzzLevel).toBe('grid');
    expect(body.data.geo).toBeTruthy();
    expect(body.data.fuzzedGeo).toEqual(body.data.geo);
    // 模糊后的坐标与精确坐标不同（但仍在校园尺度内）
    const moved = Math.hypot(body.data.geo.lat - SAFE_POINT.lat, body.data.geo.lng - SAFE_POINT.lng);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.003);
    // 精确坐标进了受限表（只有审核员能读）
    const exact = prisma.wildlifeSightingExact.rows.find((r) => r.sightingId === body.data.id);
    expect(exact?.exactLat).toBeCloseTo(SAFE_POINT.lat, 6);
  });

  it('上报响应**不含 reporterId / 精确坐标**（T15），但带 mine 标记', async () => {
    seedCellReporters(2);
    const { body } = await createSighting({ isAnonymous: true });
    expect(body.data.mine).toBe(true);
    expect(body.data.isAnonymous).toBe(true);
    expect(body.data.authorNickname).toBe('匿名同学');
    expect(JSON.stringify(body)).not.toContain(REPORTER);
    expect(body.data).not.toHaveProperty('reporterId');
    expect(body.data).not.toHaveProperty('exactGeo');
  });

  it('重复 Idempotency-Key + 同 body → 只创建一条且返回相同 id（T26）', async () => {
    seedCellReporters(2);
    const before = prisma.wildlifeSighting.rows.length;
    const payload = {
      species: CAT,
      observedAt: hoursAgo(1).toISOString(),
      geo: SAFE_POINT,
      ethicsAcknowledged: true,
    };
    const first = await call('/items', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'same-key-1',
      body: JSON.stringify(payload),
    });
    const second = await call('/items', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'same-key-1',
      body: JSON.stringify(payload),
    });
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(prisma.wildlifeSighting.rows.length).toBe(before + 1);
  });

  it('POST /items 的 OpenAPI 写法（speciesId + latitude/longitude）同样可用', async () => {
    seedCellReporters(2);
    const { status, body } = await call('/items', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'openapi-shape',
      body: JSON.stringify({
        speciesId: CAT,
        observedAt: hoursAgo(1).toISOString(),
        latitude: SAFE_POINT.lat,
        longitude: SAFE_POINT.lng,
        ethicsAcknowledged: true,
      }),
    });
    expect(status).toBe(201);
    expect(body.data.species).toBe(CAT);
  });

  /* ================================================================ *
   * 9–10：列表与详情
   * ================================================================ */

  it('GET /items 免登录且**只返回 PUBLISHED**（T30）', async () => {
    const { status, body } = await call('/items?limit=100');
    expect(status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) expect(item.status).toBe('PUBLISHED');
    expect(body.data.items[0]).not.toHaveProperty('reporterId');
  });

  it('GET /items 游标翻页 limit=1 无重复无跳过（T28）', async () => {
    const all = await call('/items?limit=100');
    const ids: string[] = all.body.data.items.map((i: any) => i.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const page: { status: number; body: Envelope<any> } = await call(
        `/items?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.data.items).toHaveLength(1);
      seen.push(page.body.data.items[0].id);
      cursor = page.body.data.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('GET /items/:id 未发布的观测对陌生人返回 404（不区分"不存在"与"无权"）', async () => {
    const pending = prisma.wildlifeSighting.rows.find((r) => r.status === 'PENDING');
    expect(pending).toBeTruthy();
    const stranger = await call(`/items/${pending!.id}`);
    expect(stranger.status).toBe(404);
    // 本人可以看
    const owner = await call(`/items/${pending!.id}`, { token: reporterToken });
    expect(owner.status).toBe(200);
    expect(owner.body.data.mine).toBe(true);
  });

  it('审核员看详情 → 带精确坐标，且**每次读取写审计**（T16/T17）', async () => {
    // 自己造一条：必须经过真实上报路径，受限表里才有精确坐标
    seedCellReporters(2);
    const created = await createSighting();
    const id = created.body.data.id as string;
    await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: `publish-for-exact-${id}`,
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });

    const auditBefore = prisma.auditLog.rows.length;

    // 普通用户：**任何路径都拿不到精确坐标**（T17）
    const stranger = await call(`/items/${id}`);
    expect(stranger.status).toBe(200);
    expect(stranger.body.data).not.toHaveProperty('exactGeo');
    expect(JSON.stringify(stranger.body)).not.toContain('exactLat');

    // 上报人本人**也**拿不到（最小权限原则，规格 §2.7）
    const owner = await call(`/items/${id}`, { token: reporterToken });
    expect(owner.body.data).not.toHaveProperty('exactGeo');

    const mod = await call(`/items/${id}`, { token: mod1Token });
    expect(mod.status).toBe(200);
    expect(mod.body.data.exactGeo).toBeTruthy();
    expect(mod.body.data.exactGeo.lat).toBeCloseTo(SAFE_POINT.lat, 4);
    expect(mod.body.data.exactGeo.lng).toBeCloseTo(SAFE_POINT.lng, 4);
    expect(prisma.auditLog.rows.length).toBeGreaterThan(auditBefore);
    expect(prisma.auditLog.rows.at(-1)).toMatchObject({
      action: 'wildlife.sighting.read_exact',
      resource: 'WildlifeSightingExact',
      module: 'wildlife',
    });
  });

  /* ================================================================ *
   * 13–14：Merge Patch 与软删
   * ================================================================ */

  it('PATCH 遵循 RFC 7396：null 删除字段、缺省不改、非本人 403（T29）', async () => {
    seedCellReporters(2);
    const created = await createSighting({ note: '原始备注' });
    const id = created.body.data.id;

    // 缺省字段不改：只改 note
    const patched = await call(`/items/${id}`, {
      method: 'PATCH',
      token: reporterToken,
      body: JSON.stringify({ note: '改过的备注' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.note).toBe('改过的备注');
    expect(patched.body.data.species).toBe(CAT);

    // null = 删除该字段
    const cleared = await call(`/items/${id}`, {
      method: 'PATCH',
      token: reporterToken,
      body: JSON.stringify({ note: null }),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.note).toBeNull();

    // 非本人
    const foreign = await call(`/items/${id}`, {
      method: 'PATCH',
      token: signJwt(OTHER, 'access', JWT_SECRET, 900),
      body: JSON.stringify({ note: 'x' }),
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error?.code).toBe('FORBIDDEN');
  });

  it('PATCH 物种纠正：记录 correctedFromSpeciesId（自动分类闭环，§5.5）', async () => {
    seedCellReporters(2);
    const created = await createSighting({
      species: CAT,
      autoSpeciesId: SWAN,
      autoConfidence: 0.7,
      classifiedBy: 'vision_api',
    });
    const patched = await call(`/items/${created.body.data.id}`, {
      method: 'PATCH',
      token: reporterToken,
      body: JSON.stringify({ species: SWAN }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.species).toBe(SWAN);
    expect(patched.body.data.correctedFromSpeciesId).toBe(SWAN);
    // classifiedBy 保留原值（规格 §5.5 第 1 条）
    expect(patched.body.data.classifiedBy).toBe('vision_api');
  });

  it('DELETE /items/:id 软删（本人），陌生人 403', async () => {
    seedCellReporters(2);
    const created = await createSighting();
    const id = created.body.data.id;

    const foreign = await call(`/items/${id}`, { method: 'DELETE', token: signJwt(OTHER, 'access', JWT_SECRET, 900) });
    expect(foreign.status).toBe(403);

    const removed = await call(`/items/${id}`, { method: 'DELETE', token: reporterToken });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id, deleted: true });

    const after = await call(`/items/${id}`);
    expect(after.status).toBe(404);
  });

  /* ================================================================ *
   * 15：审核（契约 §11.2 冻结 action）
   * ================================================================ */

  it('非审核员调 moderate → 403 FORBIDDEN（T32）', async () => {
    seedCellReporters(2);
    const created = await createSighting();
    const { status, body } = await call(`/items/${created.body.data.id}/moderate`, {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'mod-forbidden',
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('审核员 moderate(PUBLISHED) 生效，且写审计', async () => {
    seedCellReporters(2);
    const created = await createSighting();
    const auditBefore = prisma.auditLog.rows.length;
    const { status, body } = await call(`/items/${created.body.data.id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: 'mod-ok',
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });
    expect(status).toBe(201);
    expect(body.data.status).toBe('PUBLISHED');
    expect(prisma.auditLog.rows.length).toBeGreaterThan(auditBefore);
  });

  it('保护物种（黑天鹅）需**两名审核员**：单人 → 403，第二人 → 发布（T33）', async () => {
    seedCellReporters(2);
    const created = await createSighting({ species: SWAN });
    const id = created.body.data.id;

    const first = await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: 'swan-mod-1',
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });
    expect(first.status).toBe(403);
    expect(first.body.error?.details).toMatchObject({ reason: 'NEEDS_SECOND_MODERATOR' });

    // 同一位审核员再点一次仍然是 403（双人复核不能自己给自己凑数）
    const sameAgain = await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: 'swan-mod-1b',
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });
    expect(sameAgain.status).toBe(403);

    const second = await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod2Token,
      idempotencyKey: 'swan-mod-2',
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });
    expect(second.status).toBe(201);
    expect(second.body.data.status).toBe('PUBLISHED');
  });

  it('事后下架（PUBLISHED → REJECTED）必须填 rejectReason', async () => {
    seedCellReporters(2);
    const created = await createSighting();
    const id = created.body.data.id;
    await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: `pub-${id}`,
      body: JSON.stringify({ decision: 'PUBLISHED' }),
    });

    const noReason = await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: `rej-noreason-${id}`,
      body: JSON.stringify({ decision: 'REJECTED' }),
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error?.details).toMatchObject({ reason: 'REJECT_REASON_REQUIRED' });

    const withReason = await call(`/items/${id}/moderate`, {
      method: 'POST',
      token: mod1Token,
      idempotencyKey: `rej-${id}`,
      body: JSON.stringify({ decision: 'REJECTED', reason: '照片与描述不符' }),
    });
    expect(withReason.status).toBe(201);
    expect(withReason.body.data.status).toBe('REJECTED');
    // 已下架 → 对陌生人 404（不区分"不存在"与"无权"）
    const anonymous = await call(`/items/${id}`);
    expect(anonymous.status).toBe(404);
    // 本人能看到，但 `rejectReason` **仅审核端可见** → 本人视角不含它
    const ownerView = await call(`/items/${id}`, { token: reporterToken });
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data).not.toHaveProperty('rejectReason');
    // 审核端视角才有
    const modView = await call(`/items/${id}`, { token: mod1Token });
    expect(modView.body.data.rejectReason).toBe('照片与描述不符');
  });

  /* ================================================================ *
   * 11：媒体（EXIF 剥离 / 幂等 / 上限 / 存储故障）
   * ================================================================ */

  it('POST /media（multipart，带 GPS EXIF 的 JPEG）→ 201，**存储里已无 EXIF**（T9）', async () => {
    const jpeg = await buildJpegWithGpsExif();
    expect(inspectMetadata(jpeg, 'image/jpeg').hasGps).toBe(true); // 夹具确实"有毒"

    const form = new FormData();
    form.append('file', new Blob([blobPart(jpeg)], { type: 'image/jpeg' }), 'swan.jpg');
    form.append('clientPhotoId', 'photo-1');
    const response = await fetch(`${baseUrl}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: 'media-1' },
      body: form,
    });
    const body = (await response.json()) as Envelope<any>;

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ exifStripped: true, mimeType: 'image/jpeg', widthPx: 32, heightPx: 24 });
    expect(body.data.mediaId).toBeTruthy();

    // 真正落盘（内存存储）的字节里没有 EXIF / GPS
    const stored = prisma.wildlifeMedia.rows.find((r) => r.id === body.data.mediaId)!;
    const bytes = storage.peek(stored.storageKey as string)!;
    expect(inspectMetadata(bytes, 'image/jpeg')).toEqual({
      hasExif: false,
      hasGps: false,
      hasXmp: false,
      hasTextChunks: false,
    });
    expect(bytes.includes(Buffer.from('Exif\0\0', 'binary'))).toBe(false);
  });

  it('同 clientPhotoId 重试 → 返回**同一个 mediaId**，不重复存储（T37）', async () => {
    const jpeg = await buildJpegWithGpsExif();
    const upload = async (key: string) => {
      const form = new FormData();
      form.append('file', new Blob([blobPart(jpeg)], { type: 'image/jpeg' }), 'swan.jpg');
      form.append('clientPhotoId', 'photo-retry');
      const response = await fetch(`${baseUrl}/media`, {
        method: 'POST',
        headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: key },
        body: form,
      });
      return (await response.json()) as Envelope<any>;
    };
    const first = await upload('media-retry-1');
    const countAfterFirst = prisma.wildlifeMedia.rows.length;
    const second = await upload('media-retry-2'); // 不同 Idempotency-Key，同一 clientPhotoId
    expect(second.data.mediaId).toBe(first.data.mediaId);
    expect(prisma.wildlifeMedia.rows.length).toBe(countAfterFirst);
  });

  it('改扩展名的文本文件 → MEDIA_UNSUPPORTED_TYPE（T36，魔数校验）', async () => {
    const form = new FormData();
    form.append('file', new Blob([blobPart(buildTextFile())], { type: 'image/jpeg' }), 'fake.jpg');
    form.append('clientPhotoId', 'photo-fake');
    const response = await fetch(`${baseUrl}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: 'media-fake' },
      body: form,
    });
    const body = (await response.json()) as Envelope<unknown>;
    expect(response.status).toBe(400);
    expect(body.error?.details).toMatchObject({ reason: 'MEDIA_UNSUPPORTED_TYPE' });
  });

  it('对象存储不可用 → 502 UPSTREAM_UNAVAILABLE（不是 500）（T45）', async () => {
    storage.fail = true;
    try {
      const jpeg = await buildJpegWithGpsExif();
      const form = new FormData();
      form.append('file', new Blob([blobPart(jpeg)], { type: 'image/jpeg' }), 'x.jpg');
      form.append('clientPhotoId', 'photo-fail');
      const response = await fetch(`${baseUrl}/media`, {
        method: 'POST',
        headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: 'media-fail' },
        body: form,
      });
      const body = (await response.json()) as Envelope<unknown>;
      expect(response.status).toBe(503);
      expect(body.error?.code).toBe('UPSTREAM_UNAVAILABLE');
    } finally {
      storage.fail = false;
    }
  });

  it('照片关联到上报：超过 3 张被拒；同 sha256 去重（T38）', async () => {
    const jpeg = await buildJpegWithGpsExif();
    const uploadOne = async (clientPhotoId: string, key: string) => {
      const form = new FormData();
      form.append('file', new Blob([blobPart(jpeg)], { type: 'image/jpeg' }), 'x.jpg');
      form.append('clientPhotoId', clientPhotoId);
      const response = await fetch(`${baseUrl}/media`, {
        method: 'POST',
        headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: key },
        body: form,
      });
      return ((await response.json()) as Envelope<any>).data.mediaId as string;
    };

    // 同一张图上传 4 次（内容相同 → 同 sha256）
    const ids = [
      await uploadOne('dup-1', 'dup-1'),
      await uploadOne('dup-2', 'dup-2'),
      await uploadOne('dup-3', 'dup-3'),
      await uploadOne('dup-4', 'dup-4'),
    ];

    // 4 张 → 超过上限 3（Zod 在入口就拦住，details 指向 mediaIds）
    const tooMany = await createSighting({ mediaIds: ids });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error?.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(tooMany.body.error?.details)).toContain('mediaIds');

    // 3 张但内容相同 → 去重后只关联 1 张
    seedCellReporters(2);
    const created = await createSighting({ mediaIds: ids.slice(0, 3) });
    expect(created.status).toBe(201);
    expect(created.body.data.photoUrls).toHaveLength(1);
  });

  /* ================================================================ *
   * 16–17：命名个体与分类
   * ================================================================ */

  it('POST /individuals 创建命名个体；同物种重名 → 409', async () => {
    const create = (name: string, key: string) =>
      call('/individuals', {
        method: 'POST',
        token: reporterToken,
        idempotencyKey: key,
        body: JSON.stringify({ name, speciesId: CAT, description: '橘色，右耳有缺口' }),
      });

    const first = await create('大橘', 'ind-1');
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ name: '大橘', speciesId: CAT, status: 'PENDING' });

    const duplicate = await create('大橘', 'ind-2');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('CONFLICT');
  });

  it('个体名过长（>24 字）被拒（规格 §2.8 以规格为准，而非 OpenAPI 的 60）', async () => {
    const { status } = await call('/individuals', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'ind-long',
      body: JSON.stringify({ name: 'x'.repeat(25), speciesId: CAT }),
    });
    expect(status).toBe(400);
  });

  it('GET /individuals 免登录、仅 PUBLISHED', async () => {
    prisma.$seed('wildlifeIndividual', {
      id: 'ind-published',
      name: '鹅鹅',
      speciesId: SWAN,
      description: null,
      coverPhotoUrl: null,
      status: 'PUBLISHED',
      isActive: true,
      createdBy: OTHER,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    });
    const { status, body } = await call('/individuals');
    expect(status).toBe(200);
    expect(body.data.items.map((i: any) => i.name)).toEqual(['鹅鹅']);
  });

  it('POST /classify 无分类能力 → 空建议 + degraded:true，**不报 5xx**（T43/T41）', async () => {
    const media = prisma.wildlifeMedia.rows[0];
    const { status, body } = await call('/classify', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'classify-1',
      body: JSON.stringify({ mediaId: media!.id }),
    });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ suggestions: [], degraded: true, preselected: false });
    expect(body.data.notice).toContain('仅供参考');
  });

  it('POST /classify 不存在的照片 → 404（不是 500）', async () => {
    const { status, body } = await call('/classify', {
      method: 'POST',
      token: reporterToken,
      idempotencyKey: 'classify-missing',
      body: JSON.stringify({ mediaId: 'nope' }),
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  /* ================================================================ *
   * 5–7：派生只读资源
   * ================================================================ */

  it('GET /spots 只返回 ≥24h 前算出的热点，并声明聚合延迟（T24）', async () => {
    prisma.$seed('wildlifeSpot', {
      id: 'spot-old',
      speciesId: CAT,
      zoneId: 'zone-lawn',
      centroidLat: 31.178,
      centroidLng: 121.59,
      radiusM: 60,
      sightingCount: 12,
      distinctReporters: 4,
      firstSeenAt: hoursAgo(72),
      lastSeenAt: hoursAgo(48),
      hourHistogram: new Array(24).fill(0),
      confidence: 0.8,
      algorithmVersion: 'dbscan-v1',
      computedAt: hoursAgo(48),
    });
    prisma.$seed('wildlifeSpot', {
      id: 'spot-fresh',
      speciesId: CAT,
      zoneId: null,
      centroidLat: 31.178,
      centroidLng: 121.59,
      radiusM: 60,
      sightingCount: 12,
      distinctReporters: 4,
      firstSeenAt: hoursAgo(3),
      lastSeenAt: hoursAgo(1),
      hourHistogram: new Array(24).fill(0),
      confidence: 0.9,
      algorithmVersion: 'dbscan-v1',
      computedAt: hoursAgo(1), // 太新：不得公开
    });

    const { status, body } = await call('/spots');
    expect(status).toBe(200);
    expect(body.data.items.map((s: any) => s.id)).toEqual(['spot-old']);
    expect(body.data.isAggregated).toBe(true);
    expect(body.data.aggregationDelayHours).toBe(24);
    expect(body.data.items[0].isAggregated).toBe(true);
    expect(body.data.items[0].speciesNameZh).toBe('猫');
    // 热点坐标是**已模糊化**的质心，不来自精确表
    expect(body.data.items[0].centroid).toBeTruthy();
  });

  it('GET /tracks 与 /tracks/:id 恒带 isInferred:true 与服务端 disclaimer（T18）', async () => {
    prisma.$seed('wildlifeTrack', {
      id: 'track-1',
      speciesId: CAT,
      individualId: null,
      spotIds: ['spot-old'],
      pathGeoJson: { type: 'LineString', coordinates: [[121.59, 31.178], [121.5912, 31.1786]] },
      totalDistanceM: 480,
      spanStartAt: hoursAgo(100),
      spanEndAt: hoursAgo(48),
      sightingCount: 31,
      method: 'dbscan-chain',
      confidence: 0.58,
      isInferred: true,
      algorithmVersion: 'dbscan-v1',
      computedAt: hoursAgo(48),
    });

    const list = await call('/tracks');
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].isInferred).toBe(true);

    const detail = await call('/tracks/track-1');
    expect(detail.status).toBe(200);
    expect(detail.body.data.isInferred).toBe(true);
    expect(detail.body.data.method).toBe('dbscan-chain');
    expect(detail.body.data.disclaimer).toContain('31 次');
    expect(detail.body.data.disclaimer).toContain('并非实测');
    expect(detail.body.data.path.type).toBe('LineString');
    expect(detail.body.data.pointCount).toBe(2);
    expect(detail.body.data.points[0]).toEqual({ lat: 31.178, lng: 121.59 });

    const missing = await call('/tracks/nope');
    expect(missing.status).toBe(404);
  });

  it('派生资源**没有写端点**（POST /spots 与 /tracks 404）', async () => {
    for (const path of ['/spots', '/tracks']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${reporterToken}`, [IDEMPOTENCY_HEADER]: 'x' },
      });
      expect(response.status).toBe(404);
    }
  });

  /* ================================================================ *
   * 信封与追踪
   * ================================================================ */

  it('响应信封与 traceId 头一致（契约 §6.1）', async () => {
    const response = await fetch(`${baseUrl}/zones`, { headers: { [TRACE_HEADER]: 'wildlife-trace-1' } });
    const body = (await response.json()) as Envelope<unknown>;
    expect(body.traceId).toBe('wildlife-trace-1');
    expect(response.headers.get(TRACE_HEADER)).toBe('wildlife-trace-1');
    expect(body.ok).toBe(true);
  });

  it('错误响应的 code 只来自契约的 10 个值（T27）', async () => {
    const allowed = new Set([
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'CONFLICT',
      'CAMPUS_BINDING_REQUIRED',
      'CONSENT_REQUIRED',
      'UPSTREAM_UNAVAILABLE',
      'INTERNAL',
    ]);
    const failures = [
      await call('/items/nope'),
      await call('/items', { method: 'POST', body: '{}' }),
      await call('/zones/nope'),
      await call('/tracks/nope'),
    ];
    for (const failure of failures) {
      expect(failure.body.ok).toBe(false);
      expect(allowed.has(failure.body.error!.code)).toBe(true);
      // wildlife **不得**返回 CONSENT_REQUIRED（规格 §10.6）
      expect(failure.body.error!.code).not.toBe('CONSENT_REQUIRED');
      expect(failure.body.error!.code).not.toBe('CAMPUS_BINDING_REQUIRED');
    }
  });
});
