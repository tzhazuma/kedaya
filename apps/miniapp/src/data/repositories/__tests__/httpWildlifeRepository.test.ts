import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { createHttpWildlifeRepository } from '../httpWildlifeRepository'
import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import type { UploadMediaInput, WildlifeMediaUploaderPort } from '../../../domain/ports/wildlifeRepository'
import { wildlifeBasemap, wildlifeSpecies, wildlifeZone } from '../../../application/__tests__/testDoubles'
import type { WildlifeMedia, WildlifeSightingCreateBody } from '../../../domain/models/wildlife'

/**
 * 真后端野生动物仓储的**路径 / 幂等键 / 坐标透传**测试。
 *
 * 断言：
 * - URL 落在 OpenAPI 的 `/wildlife/*` 路径下；
 * - 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）；
 * - `uploadMedia` 委托给 multipart 上传端口（`ApiClient` 只发 JSON）；
 * - `createSighting` **原样透传 WGS84 body**，不在仓储层做任何坐标系转换
 *   （转换只有 domain 的两个入口，不允许出现第三处）。
 */

interface RecordedCall {
  method: 'GET' | 'POST'
  path: string
  query?: QueryMap
  body?: unknown
  extras?: ApiRequestExtras
}

interface FakeApiClient extends ApiClient {
  calls: RecordedCall[]
}

function createFakeApiClient(
  handler: (call: RecordedCall) => Result<unknown, ApiError> = () => ok({}),
): FakeApiClient {
  const calls: RecordedCall[] = []

  function unsupported(): never {
    throw new Error('该测试只覆盖 GET / POST')
  }

  return {
    calls,
    async request() {
      return unsupported()
    },
    async get<T>(path: string, query?: QueryMap): Promise<Result<T, ApiError>> {
      const call: RecordedCall = { method: 'GET', path, ...(query === undefined ? {} : { query }) }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async post<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      const call: RecordedCall = {
        method: 'POST',
        path,
        ...(body === undefined ? {} : { body }),
        ...(extras === undefined ? {} : { extras }),
      }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async patch() {
      return unsupported()
    },
    async put() {
      return unsupported()
    },
    async del() {
      return unsupported()
    },
  }
}

interface FakeUploader extends WildlifeMediaUploaderPort {
  uploads: UploadMediaInput[]
}

function createFakeUploader(): FakeUploader {
  const uploads: UploadMediaInput[] = []
  return {
    uploads,
    async upload(input: UploadMediaInput): Promise<Result<WildlifeMedia, { code: 'INTERNAL'; message: string }>> {
      uploads.push(input)
      return ok({
        mediaId: 'wm-1',
        thumbUrl: 'https://cdn.example/thumb.webp',
        exifStripped: true,
        widthPx: 100,
        heightPx: 100,
        byteSize: 1000,
        mimeType: 'image/jpeg',
        sha256: 'sha',
        clientPhotoId: input.clientPhotoId,
      })
    },
  }
}

const page = <T>(items: T[]): { items: T[]; nextCursor: string | null; total: number } => ({
  items,
  nextCursor: null,
  total: items.length,
})

const SIGHTING_BODY: WildlifeSightingCreateBody = {
  // 已经是 WGS84（用例层转换过）
  latitude: 31.1795,
  longitude: 121.591,
  observedAt: '2026-10-16T06:00:00.000Z',
  speciesId: 'sp-cat',
  individualId: null,
  mediaIds: [],
  zoneId: null,
  healthConcern: false,
  isAnonymous: false,
  autoSpeciesId: null,
  autoConfidence: null,
  classifiedBy: 'manual',
  ethicsAcknowledged: true,
}

describe('wildlife · http 仓储 · 路径映射（OpenAPI wildlife/*）', () => {
  it('读接口全部落在 wildlife/* 下，且带游标分页参数', async () => {
    const client = createFakeApiClient((call) => {
      if (call.path === 'wildlife/basemap') return ok(wildlifeBasemap())
      if (call.path === 'wildlife/species') return ok([wildlifeSpecies('sp-1')])
      if (call.path === 'wildlife/zones') return ok([wildlifeZone('wz-1')])
      if (call.path === 'wildlife/spots') return ok(page([]))
      if (call.path === 'wildlife/tracks') return ok(page([]))
      if (call.path === 'wildlife/individuals') return ok([])
      if (call.path === 'wildlife/items') return ok(page([]))
      return ok({})
    })
    const repo = createHttpWildlifeRepository(client, createFakeUploader())

    await repo.basemap()
    await repo.listSpecies()
    await repo.listZones()
    await repo.zoneDetail('wz-1')
    await repo.listSpots({ speciesId: 'sp-1', limit: 5 })
    await repo.listTracks({ cursor: 'x', limit: 3 })
    await repo.trackDetail('wt-1')
    await repo.listIndividuals('sp-1')
    await repo.listSightings({ limit: 2 })
    await repo.sightingDetail('ws-1')

    const paths = client.calls.map((call) => call.path)
    expect(paths).toEqual([
      'wildlife/basemap',
      'wildlife/species',
      'wildlife/zones',
      'wildlife/zones/wz-1',
      'wildlife/spots',
      'wildlife/tracks',
      'wildlife/tracks/wt-1',
      'wildlife/individuals',
      'wildlife/items',
      'wildlife/items/ws-1',
    ])

    const spotsCall = client.calls.find((call) => call.path === 'wildlife/spots')
    expect(spotsCall?.query?.speciesId).toBe('sp-1')
    expect(spotsCall?.query?.limit).toBe(5)
    const tracksCall = client.calls.find((call) => call.path === 'wildlife/tracks')
    expect(tracksCall?.query?.cursor).toBe('x')
  })

  it('路径参数会被 URL 编码（防止注入到别的路径）', async () => {
    const client = createFakeApiClient(() => ok(wildlifeZone('wz-1')))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())
    await repo.zoneDetail('a/b?c=1')
    expect(client.calls[0]?.path).toBe('wildlife/zones/a%2Fb%3Fc%3D1')
  })

  it('分页响应被映射成 WildlifePage（保留 total）', async () => {
    const client = createFakeApiClient(() => ok({ items: [], nextCursor: 'next', total: 42 }))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())
    const result = await repo.listSpots()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.nextCursor).toBe('next')
      expect(result.value.total).toBe(42)
    }
  })

  it('ApiError → RepositoryError 带上 traceId 与 details', async () => {
    const client = createFakeApiClient(() =>
      err({
        code: 'VALIDATION_FAILED',
        message: '坐标不在校园内',
        details: { reason: 'COORDINATE_OUT_OF_CAMPUS' },
      }),
    )
    const repo = createHttpWildlifeRepository(client, createFakeUploader())
    const result = await repo.listZones()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.message).toBe('坐标不在校园内')
      expect(result.error.details).toEqual({ reason: 'COORDINATE_OUT_OF_CAMPUS' })
    }
  })
})

describe('wildlife · http 仓储 · 写接口与幂等键（契约 §11.3）', () => {
  it('createSighting 落在 wildlife/items 并带 Idempotency-Key，body 原样透传 WGS84', async () => {
    const client = createFakeApiClient(() => ok({ id: 'ws-1' }))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())

    await repo.createSighting(SIGHTING_BODY, 'idem-1')

    const call = client.calls[0]
    expect(call?.method).toBe('POST')
    expect(call?.path).toBe('wildlife/items')
    expect(call?.extras?.idempotencyKey).toBe('idem-1')
    // ⚠️ 仓储层**不做**坐标系转换：传进来什么就发什么（转换只有 domain 两个入口）
    expect(call?.body).toEqual(SIGHTING_BODY)
    expect((call?.body as WildlifeSightingCreateBody).latitude).toBe(31.1795)
  })

  it('createIndividual 落在 wildlife/individuals 并带 Idempotency-Key', async () => {
    const client = createFakeApiClient(() => ok({ id: 'wi-1' }))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())

    await repo.createIndividual({ name: '大橘', speciesId: 'sp-cat' }, 'idem-2')

    const call = client.calls[0]
    expect(call?.path).toBe('wildlife/individuals')
    expect(call?.extras?.idempotencyKey).toBe('idem-2')
    expect(call?.body).toEqual({ name: '大橘', speciesId: 'sp-cat' })
  })

  it('classify 落在 wildlife/classify，body 只有 mediaId', async () => {
    const client = createFakeApiClient(() => ok({ suggestions: [], degraded: true }))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())

    const result = await repo.classify('wm-9')
    expect(client.calls[0]?.path).toBe('wildlife/classify')
    expect(client.calls[0]?.body).toEqual({ mediaId: 'wm-9' })
    expect(result.ok && result.value.degraded).toBe(true)
  })

  it('uploadMedia **委托**给 multipart 上传端口（ApiClient 只发 JSON，不能传文件）', async () => {
    const client = createFakeApiClient(() => ok({}))
    const uploader = createFakeUploader()
    const repo = createHttpWildlifeRepository(client, uploader)

    const result = await repo.uploadMedia({
      tempFilePath: 'wxfile://tmp/a.jpg',
      widthPx: 100,
      heightPx: 100,
      byteSize: 1000,
      mimeType: 'image/jpeg',
      clientPhotoId: 'cp-9',
      idempotencyKey: 'cp-9',
    })

    expect(uploader.uploads).toHaveLength(1)
    expect(uploader.uploads[0]?.clientPhotoId).toBe('cp-9')
    // 没有走 JSON 通道
    expect(client.calls).toHaveLength(0)
    expect(result.ok && result.value.mediaId).toBe('wm-1')
  })

  it('未传幂等键时不伪造一个（由调用方负责，契约 §11.3 的硬约束在用例层）', async () => {
    const client = createFakeApiClient(() => ok({ id: 'ws-1' }))
    const repo = createHttpWildlifeRepository(client, createFakeUploader())
    await repo.createSighting(SIGHTING_BODY)
    expect(client.calls[0]?.extras?.idempotencyKey).toBeUndefined()
  })
})
