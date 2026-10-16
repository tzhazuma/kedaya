import { describe, expect, it } from 'vitest'
import { err, gcj02ToWgs84, ok, wgs84ToGcj02 } from '@kedaya/shared'

import {
  createFakeCache,
  createFakeSessionStore,
  createFakeWildlifeRepository,
  fixedClock,
  TEST_NOW_ISO,
  upstreamError,
  wildlifeSpecies,
} from '../../__tests__/testDoubles'
import { createReportSightingUseCase, isCachedWildlifeReportPrefs } from '../reportSighting'
import type { PhotoInput } from '../reportSighting'

/**
 * 上报观测用例测试（规格 §4 / §5 / §8 / §9）。
 *
 * ⚠️ **本文件最关键的断言**：从 `<map>` 点选拿到的是 **GCJ-02**，
 * 提交给 `POST /items` 的 body **必须**是 **WGS84**。
 * 这里直接断言 `body.latitude === gcj02ToWgs84(...)`，
 * 并额外断言「body 不等于用户点选的 GCJ-02 值」—— 后者能抓住「忘了转换」。
 */

const CACHE_KEY = 'test:wildlife:report'
const ETHICS_KEY = 'test:wildlife:ethics'
/** 校园内的一个 WGS84 点（图书馆后草坪附近） */
const CAMPUS_WGS84 = { lat: 31.1795, lng: 121.591 }

const PHOTO: PhotoInput = {
  tempFilePath: 'wxfile://tmp/photo-1.jpg',
  widthPx: 1200,
  heightPx: 900,
  byteSize: 300_000,
  mimeType: 'image/jpeg',
}

function setup(options: { profile?: boolean } = {}) {
  const repository = createFakeWildlifeRepository({
    species: [ok([wildlifeSpecies('sp-1', { commonNameZh: '猫' })])],
    individuals: [ok([])],
  })
  const cache = createFakeCache()
  const session = createFakeSessionStore(options.profile === false ? null : undefined)
  const useCase = createReportSightingUseCase({
    repository,
    session,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
    ethicsCacheKey: ETHICS_KEY,
    defaultPoint: CAMPUS_WGS84,
  })
  return { repository, cache, session, useCase }
}

/** 填到「只差点提交」的完整状态 */
async function fillValid(useCase: ReturnType<typeof setup>['useCase']): Promise<void> {
  useCase.hydrate()
  await useCase.loadSpecies()
  useCase.setSpecies('sp-1')
  useCase.setEthicsAcknowledged(true)
}

describe('wildlife · 上报用例 · 坐标系（规格 §3 / §11.1）', () => {
  it('地图点选（GCJ-02）→ 提交 body 必须是 WGS84，且不等于点选值', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)

    // 模拟用户在地图上点选：`<map>` 的 onTap 给的是 GCJ-02
    const picked = wgs84ToGcj02(CAMPUS_WGS84.lat, CAMPUS_WGS84.lng)
    useCase.setPoint({ lat: picked.lat, lng: picked.lng }, 'gcj02')

    const state = await useCase.submit()
    expect(state.status).toBe('submitted')

    const sent = repository.createdSightings[0]
    expect(sent).toBeDefined()
    const expected = gcj02ToWgs84(picked.lat, picked.lng)

    expect(sent?.body.latitude).toBeCloseTo(expected.lat, 12)
    expect(sent?.body.longitude).toBeCloseTo(expected.lng, 12)
    // 回到校园原点附近
    expect(sent?.body.latitude).toBeCloseTo(CAMPUS_WGS84.lat, 6)
    // **绝不**把 GCJ-02 原样上传（否则数据永久污染，且偏移约 470 米）
    expect(sent?.body.latitude).not.toBe(picked.lat)
    expect(sent?.body.longitude).not.toBe(picked.lng)
  })

  it('GPS 定位（WGS84）→ 原样上传，不做二次偏移', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)

    useCase.setPoint(CAMPUS_WGS84, 'wgs84')
    useCase.setAccuracy(12)

    await useCase.submit()
    const sent = repository.createdSightings[0]
    expect(sent?.body.latitude).toBe(CAMPUS_WGS84.lat)
    expect(sent?.body.longitude).toBe(CAMPUS_WGS84.lng)
    expect(sent?.body.geoAccuracyM).toBe(12)
  })

  it('未转换的 GCJ-02 点若被误判为校园外，会以 COORDINATE_OUT_OF_CAMPUS 拦下（不静默上传）', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)
    // 校园外（东京）
    useCase.setPoint({ lat: 35.68, lng: 139.76 }, 'wgs84')

    const state = await useCase.submit()
    expect(state.status).toBe('editing')
    expect(state.errors.map((e) => e.reason)).toContain('COORDINATE_OUT_OF_CAMPUS')
    expect(repository.createdSightings).toHaveLength(0)
  })
})

describe('wildlife · 上报用例 · 伦理与隐私（规格 §8 / §9）', () => {
  it('未勾选伦理确认 → 提交被拒，且**不会**发出任何请求', async () => {
    const { repository, useCase } = setup()
    useCase.hydrate()
    await useCase.loadSpecies()
    useCase.setSpecies('sp-1')
    useCase.setEthicsAcknowledged(false)

    const state = await useCase.submit()
    expect(state.status).toBe('editing')
    expect(state.errors.map((e) => e.reason)).toContain('ETHICS_NOT_ACKNOWLEDGED')
    expect(repository.createdSightings).toHaveLength(0)
  })

  it('伦理确认只是**表单校验**，不是同意门：hydrate 后仍可正常浏览与编辑', () => {
    const { useCase } = setup()
    const state = useCase.hydrate()
    // 没有任何 CONSENT_REQUIRED 之类的阻塞状态
    expect(state.status).toBe('idle')
    expect(state.draft.ethicsAcknowledged).toBe(false)
    expect(state.errors).toHaveLength(0)
  })

  it('提交成功后写入本地伦理确认标记 → 下次进入默认已勾选（「同一用户只提示一次」）', async () => {
    const { cache, useCase } = setup()
    await fillValid(useCase)
    await useCase.submit()

    const prefs = cache.read<unknown>(ETHICS_KEY)
    expect(isCachedWildlifeReportPrefs(prefs)).toBe(true)

    // 新用例实例 hydrate 后默认已勾选
    const { useCase: second } = setup()
    // 复用同一个 cache 才能读到标记
    const shared = createFakeCache({ [ETHICS_KEY]: prefs })
    const third = createReportSightingUseCase({
      repository: createFakeWildlifeRepository(),
      session: createFakeSessionStore(),
      cache: shared,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    expect(second.hydrate().draft.ethicsAcknowledged).toBe(false)
    const hydrated = third.hydrate()
    expect(hydrated.ethicsAcknowledgedBefore).toBe(true)
    expect(hydrated.draft.ethicsAcknowledged).toBe(true)
  })

  it('匿名开关与健康异常标记会进入请求体', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)
    useCase.setAnonymous(true)
    useCase.setHealthConcern(true)
    useCase.setNote('疑似受伤')

    await useCase.submit()
    const sent = repository.createdSightings[0]
    expect(sent?.body.isAnonymous).toBe(true)
    expect(sent?.body.healthConcern).toBe(true)
    expect(sent?.body.note).toBe('疑似受伤')
    expect(sent?.body.ethicsAcknowledged).toBe(true)
  })

  it('未登录 → 提交被拒（契约 §10.3 未登录 401 的前置拦截）', async () => {
    const { repository, useCase } = setup({ profile: false })
    await fillValid(useCase)

    const state = await useCase.submit()
    expect(state.status).toBe('editing')
    expect(state.error).toContain('登录')
    expect(repository.createdSightings).toHaveLength(0)
  })
})

describe('wildlife · 上报用例 · 自动分类降级（规格 §5.2）', () => {
  it('分类不可用（degraded）→ classifiedBy=manual，上报流程**完全不受影响**', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)

    // 上传一张照片才会触发分类
    await useCase.addPhotos([PHOTO])
    const state = useCase.getSnapshot()

    expect(state.classification.degraded).toBe(true)
    expect(state.classification.preselectedSpeciesId).toBeNull()
    expect(state.draft.classifiedBy).toBe('manual')
    expect(state.draft.speciesId).toBe('sp-1')

    // 降级不影响提交
    expect((await useCase.submit()).status).toBe('submitted')
    expect(repository.createdSightings[0]?.body.speciesId).toBe('sp-1')
  })

  it('分类请求失败 → classifiedBy=fallback，且**不抛错、不阻塞**', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1')])],
      individuals: [ok([])],
      classify: err(upstreamError('分类服务不可用')),
    })
    const useCase = createReportSightingUseCase({
      repository,
      session: createFakeSessionStore(),
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    await fillValid(useCase)
    await useCase.addPhotos([PHOTO])

    const state = useCase.getSnapshot()
    expect(state.draft.classifiedBy).toBe('fallback')
    expect(state.error).toBeNull()
    expect((await useCase.submit()).status).toBe('submitted')
  })

  it('分类给出高置信度建议 → 预选并记录 autoSpeciesId / autoConfidence', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1'), wildlifeSpecies('sp-2')])],
      individuals: [ok([])],
      classify: ok({
        suggestions: [{ speciesId: 'sp-2', confidence: 0.92, provider: 'onnx' }],
        degraded: false,
      }),
    })
    const useCase = createReportSightingUseCase({
      repository,
      session: createFakeSessionStore(),
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    useCase.hydrate()
    await useCase.loadSpecies()
    useCase.setEthicsAcknowledged(true)
    await useCase.addPhotos([PHOTO])

    const state = useCase.getSnapshot()
    expect(state.classification.preselectedSpeciesId).toBe('sp-2')
    // 预选即写入 draft（用户没手动选过）
    expect(state.draft.speciesId).toBe('sp-2')
    expect(state.draft.autoSpeciesId).toBe('sp-2')
    expect(state.draft.autoConfidence).toBeCloseTo(0.92, 6)
    expect(state.draft.classifiedBy).toBe('vision_api')

    // 用户改成 sp-1 → classifiedBy 保持 vision_api（规格 §5.5 第 1 条）
    useCase.setSpecies('sp-1')
    await useCase.submit()
    const sent = repository.createdSightings[0]
    expect(sent?.body.speciesId).toBe('sp-1')
    expect(sent?.body.autoSpeciesId).toBe('sp-2')
    expect(sent?.body.classifiedBy).toBe('vision_api')
  })

  it('用户已手动选物种时，自动预选不会覆盖它', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1'), wildlifeSpecies('sp-2')])],
      individuals: [ok([])],
      classify: ok({
        suggestions: [{ speciesId: 'sp-2', confidence: 0.95, provider: 'onnx' }],
        degraded: false,
      }),
    })
    const useCase = createReportSightingUseCase({
      repository,
      session: createFakeSessionStore(),
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    useCase.hydrate()
    await useCase.loadSpecies()
    useCase.setSpecies('sp-1')
    await useCase.addPhotos([PHOTO])

    expect(useCase.getSnapshot().draft.speciesId).toBe('sp-1')
  })
})

describe('wildlife · 上报用例 · 照片上传（规格 §4）', () => {
  it('addPhotos 会带上 clientPhotoId 与幂等键上传，并记录 thumbUrl', async () => {
    const { repository, useCase } = setup()
    useCase.hydrate()
    await useCase.loadSpecies()

    await useCase.addPhotos([PHOTO])
    const photo = useCase.getSnapshot().photos[0]

    expect(repository.uploadedPhotos).toHaveLength(1)
    expect(repository.uploadedPhotos[0]?.clientPhotoId).toBe(photo?.clientPhotoId)
    expect(repository.uploadedPhotos[0]?.idempotencyKey).toBe(photo?.clientPhotoId)
    expect(photo?.status).toBe('uploaded')
    expect(photo?.mediaId).toBe('wm-1')
    expect(photo?.thumbUrl).toContain('cdn.example')
  })

  it('重试失败的照片会**复用**同一个 clientPhotoId（服务端据此返回相同 mediaId）', async () => {
    const repository = createFakeWildlifeRepository({
      species: [ok([wildlifeSpecies('sp-1')])],
      individuals: [ok([])],
      upload: err(upstreamError('上传失败')),
    })
    const useCase = createReportSightingUseCase({
      repository,
      session: createFakeSessionStore(),
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    useCase.hydrate()
    await useCase.loadSpecies()

    await useCase.addPhotos([PHOTO])
    const failed = useCase.getSnapshot().photos[0]
    expect(failed?.status).toBe('failed')

    repository.uploadResult = ok({
      mediaId: 'wm-2',
      thumbUrl: 'https://cdn.example/thumb-2.webp',
      exifStripped: true,
      widthPx: 1200,
      heightPx: 900,
      byteSize: 300_000,
      mimeType: 'image/jpeg',
      sha256: 'sha2',
      clientPhotoId: failed?.clientPhotoId ?? '',
    })

    await useCase.retryPhoto(failed?.clientPhotoId ?? '')
    expect(repository.uploadedPhotos).toHaveLength(2)
    expect(repository.uploadedPhotos[1]?.clientPhotoId).toBe(failed?.clientPhotoId)
    expect(useCase.getSnapshot().photos[0]?.mediaId).toBe('wm-2')
  })

  it('最多 3 张：超出的照片被忽略（契约 photoUrls ≤3）', async () => {
    const { useCase, repository } = setup()
    useCase.hydrate()
    await useCase.loadSpecies()

    await useCase.addPhotos([PHOTO, PHOTO, PHOTO, PHOTO, PHOTO])
    expect(useCase.getSnapshot().photos).toHaveLength(3)
    expect(repository.uploadedPhotos).toHaveLength(3)
  })

  it('removePhoto 移除指定照片，不触碰其它照片', async () => {
    const { useCase } = setup()
    useCase.hydrate()
    await useCase.loadSpecies()
    await useCase.addPhotos([PHOTO, PHOTO])

    const first = useCase.getSnapshot().photos[0]
    useCase.removePhoto(first?.clientPhotoId ?? '')
    expect(useCase.getSnapshot().photos).toHaveLength(1)
    expect(useCase.getSnapshot().photos[0]?.clientPhotoId).not.toBe(first?.clientPhotoId)
  })
})

describe('wildlife · 上报用例 · 幂等与个体命名（规格 §5.6 / 契约 §11.3）', () => {
  it('提交失败后重试**复用同一个 Idempotency-Key**（避免重复创建）', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)

    repository.createSightingResult = err(upstreamError('服务端抖动'))
    expect((await useCase.submit()).status).toBe('error')

    repository.createSightingResult = ok({
      id: 'ws-ok',
      speciesId: 'sp-1',
      speciesSource: 'manual',
      observedAt: TEST_NOW_ISO,
      zoneId: null,
      fuzzLevel: 'grid',
      mediaIds: [],
      status: 'PENDING',
      isInferred: false,
      healthConcern: false,
      isAnonymous: false,
      createdAt: TEST_NOW_ISO,
    })
    expect((await useCase.submit()).status).toBe('submitted')

    expect(repository.createdSightings).toHaveLength(2)
    expect(repository.createdSightings[0]?.idempotencyKey).toBeDefined()
    expect(repository.createdSightings[1]?.idempotencyKey).toBe(
      repository.createdSightings[0]?.idempotencyKey,
    )
  })

  it('「手动给个名字」→ 先建个体，再把 individualId 放进上报（规格 §5.6 (b)）', async () => {
    const { repository, useCase } = setup()
    await fillValid(useCase)
    useCase.setNewIndividualName('大橘')

    const state = await useCase.submit()
    expect(state.status).toBe('submitted')
    expect(repository.createdIndividuals).toHaveLength(1)
    expect(repository.createdIndividuals[0]?.body.name).toBe('大橘')
    expect(repository.createdIndividuals[0]?.body.speciesId).toBe('sp-1')
    expect(repository.createdIndividuals[0]?.idempotencyKey).toBeDefined()
    expect(repository.createdSightings[0]?.body.individualId).toBe('wi-new')
  })

  it('个体创建失败**不阻塞**上报（个体只是增强）', async () => {
    const { repository, useCase } = setup()
    repository.createIndividualResult = err({ code: 'CONFLICT', message: '名字已被占用' })
    await fillValid(useCase)
    useCase.setNewIndividualName('大橘')

    expect((await useCase.submit()).status).toBe('submitted')
    expect(repository.createdSightings[0]?.body.individualId).toBeNull()
  })

  it('loadSpecies 失败 → error 态；空物种 → 空态数据（三态齐全）', async () => {
    const failing = createFakeWildlifeRepository({
      species: [err(upstreamError())],
      individuals: [ok([])],
    })
    const useCase = createReportSightingUseCase({
      repository: failing,
      session: createFakeSessionStore(),
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
      ethicsCacheKey: ETHICS_KEY,
    })
    const failed = await useCase.loadSpecies()
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('网络不可用')

    const empty = setup()
    empty.repository.speciesQueue.length = 0
    const emptyState = await empty.useCase.loadSpecies()
    expect(emptyState.status).toBe('ready')
    expect(emptyState.species).toHaveLength(0)
  })

  it('reset() 清空草稿与照片（再次上报不会带上上一次的数据）', async () => {
    const { useCase } = setup()
    await fillValid(useCase)
    await useCase.addPhotos([PHOTO])
    useCase.setNote('上一次的备注')

    useCase.reset()
    const state = useCase.getSnapshot()
    expect(state.photos).toHaveLength(0)
    expect(state.draft.note).toBe('')
    expect(state.draft.speciesId).toBeNull()
    expect(state.status).toBe('idle')
  })
})
