/**
 * wildlife HTTP 仓储测试 —— 断言**契约形状**（规格 §10.1 / 契约 §6.1 / §11.2 / §11.3 / §11.11）：
 * - 路由由 `@kedaya/contracts` 的模块注册表派生（不硬编码模块名）；
 * - 审核走**已冻结**的 action 名 `moderate`，且用 body 的 `decision` 区分通过/拒绝；
 * - 所有 `POST` 带 `Idempotency-Key`（契约 §11.3），且**同内容重试复用同一个键**；
 * - 照片上传走 `multipart/form-data`（不经 JSON 序列化）；
 * - 游标**原样透传**（客户端不解析、不构造 —— 契约 §11.10-E）；
 * - 脏数据返回 `INTERNAL` 而不是静默通过；错误码原样透传。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import type { ApiClient, ApiRequest, ApiResult, RequestOptions } from '../api/client';
import { createWildlifeHttpRepository, stableIdempotencyKey } from './wildlife.http';

interface RecordedCall {
  method: ApiRequest['method'];
  path: string;
  query?: ApiRequest['query'];
  body?: unknown;
  idempotencyKey?: string;
  form?: FormData;
}

function createFakeClient(handler: (call: RecordedCall) => Result<unknown, ApiError>): {
  client: ApiClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record = (
    req: ApiRequest,
    options?: RequestOptions,
    form?: FormData,
  ): Result<unknown, ApiError> => {
    const call: RecordedCall = {
      method: req.method,
      path: req.path,
      ...(req.query === undefined ? {} : { query: req.query }),
      ...(req.body === undefined ? {} : { body: req.body }),
      ...(options?.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(form === undefined ? {} : { form }),
    };
    calls.push(call);
    return handler(call);
  };

  const client: ApiClient = {
    baseUrl: '/api/v1',
    request: async <T>(req: ApiRequest, options?: RequestOptions) =>
      record(req, options) as ApiResult<T>,
    get: async <T>(path: string, query?: ApiRequest['query'], options?: RequestOptions) =>
      record({ path, method: 'GET', ...(query ? { query } : {}) }, options) as ApiResult<T>,
    post: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'POST', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    patch: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PATCH', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    put: async <T>(path: string, body?: unknown, options?: RequestOptions) =>
      record({ path, method: 'PUT', ...(body === undefined ? {} : { body }) }, options) as ApiResult<T>,
    del: async <T>(path: string, options?: RequestOptions) =>
      record({ path, method: 'DELETE' }, options) as ApiResult<T>,
    upload: async <T>(path: string, form: FormData, options?: RequestOptions) =>
      record({ path, method: 'POST' }, options, form) as ApiResult<T>,
  };

  return { client, calls };
}

const ISO = '2026-10-17T00:30:00.000Z';
const BASE = `/${modulePath('wildlife')}`;

const SIGHTING_PAYLOAD = {
  id: 'ws-1',
  zoneId: 'wz-lake',
  species: 'sp-swan',
  speciesNameZh: '黑天鹅',
  status: 'PENDING',
  geo: { lat: 31.178, lng: 121.592 },
  geoWithheld: null,
  observedAt: ISO,
  observedAtFuzzed: '2026-10-17T00:00:00.000Z',
  individualId: null,
  autoSpeciesId: null,
  autoConfidence: null,
  classifiedBy: 'manual',
  correctedFromSpeciesId: null,
  note: null,
  isAnonymous: false,
  reporterLabel: '鸭鸭先冲',
  photoUrls: [],
  healthConcern: false,
  createdAt: ISO,
  moderatedBy: null,
  moderatedAt: null,
  rejectReason: null,
};

const TRACK_PAYLOAD = {
  id: 'wt-1',
  speciesId: 'sp-swan',
  speciesNameZh: '黑天鹅',
  individualId: null,
  spotIds: ['wsp-02'],
  path: { type: 'LineString', coordinates: [[121.591945, 31.177838], [121.592207, 31.177596]] },
  totalDistanceM: 37,
  spanStartAt: ISO,
  spanEndAt: ISO,
  sightingCount: 31,
  method: 'dbscan-chain',
  confidence: 0.58,
  isInferred: true,
  disclaimer: '本轨迹由 31 次同学上报推断得出，并非实测运动路径。',
  computedAt: ISO,
};

describe('wildlife HTTP 仓储 · 路由形状', () => {
  it('全部读接口路径由模块注册表派生（/api/v1/wildlife/*）', async () => {
    const { client, calls } = createFakeClient((call) => {
      if (call.path.endsWith('/species')) return ok([]);
      if (call.path.endsWith('/basemap')) {
        return ok({
          version: 'v1',
          imageUrl: '/wildlife/basemap.svg',
          widthPx: 1200,
          heightPx: 800,
          affine: [1, 0, 600, 0, -1, 400],
          calibrationRmsePx: 1.7,
          controlPointCount: 8,
          attribution: '自绘',
          license: 'original',
        });
      }
      if (call.path.endsWith('/tracks/wt-1')) return ok(TRACK_PAYLOAD);
      return ok({ items: [], nextCursor: null, total: 0 });
    });
    const repo = createWildlifeHttpRepository(client);

    await repo.basemap();
    await repo.species();
    await repo.zones({ limit: 5 });
    await repo.zoneDetail('wz-1');
    await repo.spots({ minConfidence: 0.4 });
    await repo.tracks({});
    await repo.trackDetail('wt-1');
    await repo.individuals({});
    await repo.sightings({});
    await repo.sightingDetail('ws-1');

    expect(calls.map((c) => c.path)).toEqual([
      `${BASE}/basemap`,
      `${BASE}/species`,
      `${BASE}/zones`,
      `${BASE}/zones/wz-1`,
      `${BASE}/spots`,
      `${BASE}/tracks`,
      `${BASE}/tracks/wt-1`,
      `${BASE}/individuals`,
      `${BASE}/items`,
      `${BASE}/items/ws-1`,
    ]);
  });

  it('查询参数只传有值的（游标原样透传，不解析不构造）', async () => {
    const { client, calls } = createFakeClient(() => ok({ items: [], nextCursor: null }));
    const repo = createWildlifeHttpRepository(client);

    await repo.sightings({ cursor: 'eyJvIjo0fQ==', limit: 5, species: 'sp-swan' });
    expect(calls[0]?.query).toEqual({ cursor: 'eyJvIjo0fQ==', limit: 5, species: 'sp-swan' });

    await repo.sightings({});
    expect(calls[1]?.query).toEqual({});
  });

  it('底图响应被解析为契约形状并派生占位标记', async () => {
    const { client } = createFakeClient(() =>
      ok({
        version: 'placeholder-v1',
        imageUrl: '/wildlife/basemap.svg',
        widthPx: 1200,
        heightPx: 800,
        affine: [1, 0, 600, 0, -1, 400],
        calibrationRmsePx: 1.7,
        controlPointCount: 8,
        attribution: '可达鸭项目自绘示意图（原创）',
        license: 'original',
      }),
    );
    const result = await createWildlifeHttpRepository(client).basemap();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isPlaceholder).toBe(true);
      expect(result.value.placeholderNotice).toContain('占位底图');
    }
  });

  it('脏数据（isInferred=false / 缺 disclaimer）→ INTERNAL，不静默通过', async () => {
    const { client } = createFakeClient(() => ok({ ...TRACK_PAYLOAD, isInferred: false, disclaimer: '' }));
    const result = await createWildlifeHttpRepository(client).trackDetail('wt-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect((result.error.details as { issues: string[] }).issues.length).toBeGreaterThan(0);
    }
  });

  it('错误码原样透传（FORBIDDEN / NOT_FOUND）', async () => {
    const { client } = createFakeClient(() => err({ code: 'FORBIDDEN', message: '需要两名审核员' }));
    const result = await createWildlifeHttpRepository(client).moderate('ws-1', {
      decision: 'PUBLISHED',
      moderatorId: 'u_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
      expect(result.error.message).toBe('需要两名审核员');
    }
  });
});

describe('wildlife HTTP 仓储 · 写操作与幂等（契约 §11.3）', () => {
  const createInput = {
    species: 'sp-cat',
    observedAt: ISO,
    geo: { lat: 31.1795, lng: 121.591 },
    zoneId: 'wz-lib-lawn',
    mediaIds: [],
    healthConcern: false,
    individualId: null,
    individualName: null,
    note: null,
    isAnonymous: false,
    autoSpeciesId: null,
    autoConfidence: null,
    classifiedBy: 'manual' as const,
    ethicsAcknowledged: true as const,
  };

  it('上报 POST 到 /items 且带 Idempotency-Key；同内容重试复用同一个键', async () => {
    const { client, calls } = createFakeClient(() => ok(SIGHTING_PAYLOAD));
    const repo = createWildlifeHttpRepository(client);

    await repo.createSighting(createInput);
    await repo.createSighting(createInput);

    expect(calls[0]?.path).toBe(`${BASE}/items`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.idempotencyKey).toBeTruthy();
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);

    // 内容变了 → 键也要变（否则会把新内容当成旧请求的重复）
    await repo.createSighting({ ...createInput, species: 'sp-swan' });
    expect(calls[2]?.idempotencyKey).not.toBe(calls[0]?.idempotencyKey);
  });

  it('审核 POST 到 /items/:id/moderate（契约 §11.2 冻结动作名），拒绝时带 reason', async () => {
    const { client, calls } = createFakeClient(() => ok({ ...SIGHTING_PAYLOAD, status: 'REJECTED' }));
    const repo = createWildlifeHttpRepository(client);

    await repo.moderate('ws-1', { decision: 'REJECTED', reason: '照片没拍到动物', moderatorId: 'u_1' });

    expect(calls[0]?.path).toBe(`${BASE}/items/ws-1/moderate`);
    expect(calls[0]?.body).toEqual({ decision: 'REJECTED', reason: '照片没拍到动物' });
    expect(calls[0]?.idempotencyKey).toBeTruthy();
  });

  it('审核不传 reason 时 body 里不出现该字段（避免把 undefined 序列化成 null）', async () => {
    const { client, calls } = createFakeClient(() => ok(SIGHTING_PAYLOAD));
    await createWildlifeHttpRepository(client).moderate('ws-1', {
      decision: 'PUBLISHED',
      moderatorId: 'u_1',
    });
    expect(calls[0]?.body).toEqual({ decision: 'PUBLISHED' });
  });

  it('照片上传走 multipart（FormData），带 clientPhotoId 且复用其作为幂等键', async () => {
    const { client, calls } = createFakeClient(() =>
      ok({
        mediaId: 'wm-1',
        thumbUrl: '/wildlife/photos/wm-1.webp',
        widthPx: 1200,
        heightPx: 900,
        sha256: 'a'.repeat(64),
        clientPhotoId: 'photo-abc',
      }),
    );
    const file = new File([new Uint8Array([1, 2])], 'cat.jpg', { type: 'image/jpeg' });
    const result = await createWildlifeHttpRepository(client).uploadMedia({
      file,
      clientPhotoId: 'photo-abc',
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe(`${BASE}/media`);
    expect(calls[0]?.form).toBeInstanceOf(FormData);
    expect(calls[0]?.form?.get('clientPhotoId')).toBe('photo-abc');
    expect(calls[0]?.form?.get('file')).toBeInstanceOf(File);
    expect(calls[0]?.idempotencyKey).toBe('photo-abc');
  });

  it('分类请求 POST 到 /classify；无能力时后端返回空数组 → 客户端返回 ok([])', async () => {
    const { client, calls } = createFakeClient(() => ok([]));
    const result = await createWildlifeHttpRepository(client).classify('wm-1', 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
    expect(calls[0]?.path).toBe(`${BASE}/classify`);
    expect(calls[0]?.body).toEqual({ mediaId: 'wm-1', topK: 3 });
  });
});

describe('stableIdempotencyKey', () => {
  it('同 scope 同 payload → 同键；不同 scope 或不同 payload → 不同键', () => {
    const a = stableIdempotencyKey('wildlife-sighting', { species: 'sp-cat' });
    const b = stableIdempotencyKey('wildlife-sighting', { species: 'sp-cat' });
    const c = stableIdempotencyKey('wildlife-sighting', { species: 'sp-swan' });
    const d = stableIdempotencyKey('wildlife-moderate', { species: 'sp-cat' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith('wildlife-sighting-')).toBe(true);
  });
});
