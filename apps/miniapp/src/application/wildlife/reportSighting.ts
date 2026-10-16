import { CAMPUS_ORIGIN } from '@kedaya/shared'

import {
  EMPTY_SIGHTING_DRAFT,
  buildClassificationView,
  findSpecies,
  toCreateSightingBody,
  toIndividualCreateBody,
  validateSightingDraft,
  wasCorrected,
} from '../../domain/models/wildlife'
import type {
  ClassificationView,
  ClassifiedBy,
  CoordinateSystem,
  SightingDraft,
  SightingDraftError,
  WildlifeIndividual,
  WildlifeSpecies,
} from '../../domain/models/wildlife'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import type { WildlifeRepository } from '../../domain/ports/wildlifeRepository'
import { createIdempotencyKey } from '../idempotency'

/**
 * 上报观测用例（**核心流程**，规格 §4 / §5 / §8 / §9）。
 *
 * 流程：
 *
 * ```
 * 1. 选照片（页面调 platform/mediaPicker）→ 压缩 → 本用例 addPhotos()
 * 2. addPhotos()：生成 clientPhotoId（重试复用）→ POST /media → POST /classify
 * 3. 定位：getLocation（WGS84）或地图点选（GCJ-02）→ setPoint(point, from)
 * 4. 发现时间：默认现在，可改 → setObservedAt()
 * 5. 物种：手动选（默认）/ 接受或纠正自动建议 → setSpecies()
 * 6. 个体名（可选，规格 §5.6 (b)）→ setNewIndividualName() 或 setIndividual()
 * 7. 伦理勾选（**表单校验**，不是同意门，规格 §8.2）→ setEthicsAcknowledged(true)
 * 8. submit()：本地校验 → 建个体（如需）→ POST /items（带 Idempotency-Key）
 * ```
 *
 * ⚠️ **坐标系**：`setPoint` 的 `from` 参数**必填**。用例内部只保留原始点与它的来源，
 * 真正的转换发生在 `toCreateSightingBody()`（唯一出口）——
 * 这样「上传前忘记把 GCJ-02 转回 WGS84」在结构上不可能发生。
 *
 * ⚠️ **降级**：`POST /classify` 不可用时**必须**静默降级为纯手动，
 * 绝不能让分类失败阻塞上报（规格 §5.2 / §11.6 T43）。
 */

/** 页面从 `platform/mediaPicker` 拿到的照片（结构一致，因此可以直接传进来） */
export interface PhotoInput {
  tempFilePath: string
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
}

export type ReportPhotoStatus = 'uploading' | 'uploaded' | 'failed'

export interface ReportPhotoState {
  /** 幂等键：**重试时必须复用**（规格 §4.5） */
  clientPhotoId: string
  tempFilePath: string
  /** 压缩后的尺寸 / 大小（由 `platform/mediaPicker` 提供） */
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
  status: ReportPhotoStatus
  mediaId: string | null
  thumbUrl: string | null
  error: string | null
}

export type ReportStatus =
  | 'idle'
  /** 表单可编辑（默认态） */
  | 'editing'
  | 'loading'
  | 'ready'
  | 'uploading'
  | 'submitting'
  | 'submitted'
  | 'error'

export interface ReportSightingState {
  status: ReportStatus
  species: WildlifeSpecies[]
  individuals: WildlifeIndividual[]
  draft: SightingDraft
  photos: ReportPhotoState[]
  classification: ClassificationView
  classificationLoading: boolean
  /** 上一次校验的错误（空数组 = 通过） */
  errors: SightingDraftError[]
  error: string | null
  /** 提交成功后的记录 id */
  submittedId: string | null
  /** 本机是否曾经确认过伦理提示（规格 §8.2：同一用户只提示一次） */
  ethicsAcknowledgedBefore: boolean
}

export interface CachedWildlifeReportPrefs {
  ethicsAcknowledgedAt: string
}

export interface ReportSightingDeps {
  repository: WildlifeRepository
  session: SessionStorePort
  cache: CachePort
  clock: ClockPort
  /** 物种 / 个体列表缓存 key */
  cacheKey: string
  /** 伦理提示的本地标记 key（规格 §8.2「同一用户只提示一次」） */
  ethicsCacheKey: string
  /** 默认落点（校园原点，WGS84）。用户定位成功后会被替换 */
  defaultPoint?: { lat: number; lng: number }
}

export interface ReportSightingUseCase {
  getSnapshot(): ReportSightingState
  subscribe(listener: () => void): () => void
  hydrate(): ReportSightingState
  loadSpecies(): Promise<ReportSightingState>
  setPoint(point: { lat: number; lng: number }, from: CoordinateSystem): ReportSightingState
  setObservedAt(iso: string): ReportSightingState
  addPhotos(photos: readonly PhotoInput[]): Promise<ReportSightingState>
  retryPhoto(clientPhotoId: string): Promise<ReportSightingState>
  removePhoto(clientPhotoId: string): ReportSightingState
  setSpecies(speciesId: string | null): ReportSightingState
  setIndividual(individualId: string | null): ReportSightingState
  setNewIndividualName(name: string): ReportSightingState
  setNote(note: string): ReportSightingState
  setHealthConcern(value: boolean): ReportSightingState
  setAnonymous(value: boolean): ReportSightingState
  setEthicsAcknowledged(value: boolean): ReportSightingState
  setZoneId(zoneId: string | null): ReportSightingState
  setAccuracy(accuracyM: number): ReportSightingState
  /** 手动（重新）请求分类建议；失败静默降级 */
  requestClassification(): Promise<ReportSightingState>
  validate(): SightingDraftError[]
  submit(): Promise<ReportSightingState>
  reset(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedWildlifeReportPrefs(
  value: unknown,
): value is CachedWildlifeReportPrefs {
  if (!isRecord(value)) return false
  return typeof value.ethicsAcknowledgedAt === 'string'
}

const EMPTY_CLASSIFICATION: ClassificationView = {
  mode: 'manual',
  degraded: true,
  suggestions: [],
  preselectedSpeciesId: null,
  disclaimer: '识别结果仅供参考，请确认后再提交。',
}

export function createReportSightingUseCase(deps: ReportSightingDeps): ReportSightingUseCase {
  const { repository, session, cache, clock, cacheKey, ethicsCacheKey } = deps
  const defaultPoint = deps.defaultPoint ?? { lat: CAMPUS_ORIGIN.lat, lng: CAMPUS_ORIGIN.lng }

  function initialState(): ReportSightingState {
    return {
      status: 'idle',
      species: [],
      individuals: [],
      draft: {
        ...EMPTY_SIGHTING_DRAFT,
        observedAt: clock.now().toISOString(),
        point: { lat: defaultPoint.lat, lng: defaultPoint.lng },
      },
      photos: [],
      classification: EMPTY_CLASSIFICATION,
      classificationLoading: false,
      errors: [],
      error: null,
      submittedId: null,
      ethicsAcknowledgedBefore: false,
    }
  }

  let state: ReportSightingState = initialState()
  let hydrated = false
  /** 提交幂等键：**同一次提交的重试复用同一个 key**（契约 §11.3） */
  let submitIdempotencyKey: string | null = null
  const listeners = new Set<() => void>()

  function patch(next: Partial<ReportSightingState>): ReportSightingState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function patchDraft(next: Partial<SightingDraft>): ReportSightingState {
    return patch({ draft: { ...state.draft, ...next } })
  }

  function hydrate(): ReportSightingState {
    if (hydrated) return state
    hydrated = true

    const prefs = cache.read<unknown>(ethicsCacheKey)
    const ethicsAcknowledgedBefore = isCachedWildlifeReportPrefs(prefs)

    const cached = cache.read<unknown>(cacheKey)
    if (isRecord(cached) && Array.isArray(cached.species)) {
      return patch({
        species: cached.species as WildlifeSpecies[],
        individuals: Array.isArray(cached.individuals)
          ? (cached.individuals as WildlifeIndividual[])
          : [],
        ethicsAcknowledgedBefore,
        // 曾经确认过 → 默认已勾选（但**浏览不受影响**，这不是同意门）
        draft: { ...state.draft, ethicsAcknowledged: ethicsAcknowledgedBefore },
      })
    }

    return patch({
      ethicsAcknowledgedBefore,
      draft: { ...state.draft, ethicsAcknowledged: ethicsAcknowledgedBefore },
    })
  }

  async function loadSpecies(): Promise<ReportSightingState> {
    patch({ status: state.species.length > 0 ? 'ready' : 'loading', error: null })

    const [speciesResult, individualsResult] = await Promise.all([
      repository.listSpecies(),
      repository.listIndividuals(),
    ])

    if (!speciesResult.ok) {
      return patch({
        status: state.species.length > 0 ? 'ready' : 'error',
        error: speciesResult.error.message,
      })
    }

    const species = speciesResult.value
    const individuals = individualsResult.ok ? individualsResult.value : []
    cache.write(cacheKey, { species, individuals, updatedAt: clock.now().toISOString() })

    return patch({
      status: 'ready',
      species,
      individuals,
      error: null,
    })
  }

  async function uploadPhoto(photo: ReportPhotoState): Promise<ReportPhotoState> {
    const result = await repository.uploadMedia({
      tempFilePath: photo.tempFilePath,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      byteSize: photo.byteSize,
      mimeType: photo.mimeType,
      clientPhotoId: photo.clientPhotoId,
      // 重试复用同一个 clientPhotoId + Idempotency-Key → 服务端返回相同 mediaId（§11.5 T37）
      idempotencyKey: photo.clientPhotoId,
    })

    if (!result.ok) {
      return { ...photo, status: 'failed', error: result.error.message }
    }
    return {
      ...photo,
      status: 'uploaded',
      mediaId: result.value.mediaId,
      thumbUrl: result.value.thumbUrl,
      error: null,
    }
  }

  /**
   * 请求分类建议。
   *
   * 三种结局（规格 §5.2 的降级链）：
   * - 成功且有建议 → `mode: 'server'`，预选 top-1（置信度 ≥0.60 时），`classifiedBy = 'vision_api'`
   * - 成功但 `degraded` / 空数组 → **纯手动**，`classifiedBy = 'manual'`（服务端未配置分类能力）
   * - 请求本身失败 → **静默降级**，`classifiedBy = 'fallback'`，**不报错、不阻塞**
   */
  async function classifyFirstUploaded(): Promise<ReportSightingState> {
    const uploaded = state.photos.find((photo) => photo.status === 'uploaded')
    if (uploaded === undefined || uploaded.mediaId === null) return state

    patch({ classificationLoading: true })
    const result = await repository.classify(uploaded.mediaId)

    if (!result.ok) {
      return patch({
        classificationLoading: false,
        classification: EMPTY_CLASSIFICATION,
        draft: { ...state.draft, classifiedBy: 'fallback' as ClassifiedBy },
      })
    }

    const view = buildClassificationView(result.value, state.species)
    const classifiedBy: ClassifiedBy =
      view.degraded || view.suggestions.length === 0
        ? 'manual'
        : 'vision_api'

    return patch({
      classificationLoading: false,
      classification: view,
      draft: {
        ...state.draft,
        classifiedBy,
        autoSpeciesId: view.preselectedSpeciesId,
        autoConfidence:
          view.suggestions[0] === undefined ? null : view.suggestions[0].confidence,
        // 预选只在用户还没选物种时生效（不覆盖用户的手动选择）
        speciesId: state.draft.speciesId ?? view.preselectedSpeciesId,
      },
    })
  }

  async function addPhotos(photos: readonly PhotoInput[]): Promise<ReportSightingState> {
    const room = 3 - state.photos.length
    const accepted = photos.slice(0, Math.max(0, room))
    if (accepted.length === 0) return state

    const now = clock.now()
    const pending: ReportPhotoState[] = accepted.map((photo) => ({
      clientPhotoId: createIdempotencyKey('wildlife.photo', now),
      tempFilePath: photo.tempFilePath,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      byteSize: photo.byteSize,
      mimeType: photo.mimeType,
      status: 'uploading',
      mediaId: null,
      thumbUrl: null,
      error: null,
    }))

    patch({ photos: [...state.photos, ...pending], status: 'uploading' })

    for (const photo of pending) {
      const uploaded = await uploadPhoto(photo)
      patch({
        photos: state.photos.map((item) =>
          item.clientPhotoId === photo.clientPhotoId ? uploaded : item,
        ),
      })
    }

    patch({ status: 'ready' })
    // 有照片上传成功才请求分类建议
    return classifyFirstUploaded()
  }

  async function retryPhoto(clientPhotoId: string): Promise<ReportSightingState> {
    const target = state.photos.find((photo) => photo.clientPhotoId === clientPhotoId)
    if (target === undefined) return state

    patch({
      photos: state.photos.map((item) =>
        item.clientPhotoId === clientPhotoId
          ? { ...item, status: 'uploading', error: null }
          : item,
      ),
    })

    const uploaded = await uploadPhoto({ ...target, status: 'uploading', error: null })
    patch({
      photos: state.photos.map((item) =>
        item.clientPhotoId === clientPhotoId ? uploaded : item,
      ),
    })
    return state
  }

  function validate(): SightingDraftError[] {
    const errors = validateSightingDraft(state.draft, state.species, clock.now())
    patch({ errors })
    return errors
  }

  async function submit(): Promise<ReportSightingState> {
    if (state.status === 'submitting') return state

    const errors = validate()
    if (errors.length > 0) {
      return patch({ status: 'editing', error: errors[0]?.message ?? '表单校验未通过' })
    }

    // 登录门：上报需要登录（契约 §10.3「未登录 → 401」）
    const profile = session.read().profile
    if (profile === null) {
      return patch({ status: 'editing', error: '请先登录后再上报观测' })
    }

    patch({ status: 'submitting', error: null })

    // 幂等键只生成一次，重试复用（契约 §11.3）
    submitIdempotencyKey ??= createIdempotencyKey('wildlife.sighting', clock.now())

    const now = clock.now()

    // 「手动给个名字」→ 先建个体（规格 §5.6 (b)），失败**不阻塞**上报
    let individualId = state.draft.individualId
    const newName = state.draft.newIndividualName?.trim() ?? ''
    if (newName !== '' && state.draft.speciesId !== null) {
      const created = await repository.createIndividual(
        toIndividualCreateBody(newName, state.draft.speciesId),
        createIdempotencyKey('wildlife.individual', now),
      )
      if (created.ok) {
        individualId = created.value.id
        patch({ individuals: [...state.individuals, created.value] })
      }
    }

    const body = toCreateSightingBody({ ...state.draft, individualId })
    const result = await repository.createSighting(body, submitIdempotencyKey)

    if (!result.ok) {
      return patch({ status: 'error', error: result.error.message })
    }

    // 伦理提示的本地标记（规格 §8.2：同一用户只提示一次）
    cache.write(ethicsCacheKey, {
      ethicsAcknowledgedAt: now.toISOString(),
    } satisfies CachedWildlifeReportPrefs)

    // 纠正闭环：用户改了自动结果 → 服务端据此生成标注样本（规格 §5.5）
    const corrected = wasCorrected(state.draft.speciesId, state.draft.autoSpeciesId)
    void corrected

    submitIdempotencyKey = null
    return patch({
      status: 'submitted',
      submittedId: result.value.id,
      error: null,
      errors: [],
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    loadSpecies,

    setPoint(point: { lat: number; lng: number }, from: CoordinateSystem): ReportSightingState {
      // ⚠️ `from` 必须由调用方声明：地图点选 = gcj02，getLocation = wgs84。
      // 真正转换发生在 toCreateSightingBody()（唯一出口）。
      return patchDraft({ point: { lat: point.lat, lng: point.lng }, coordinateSystem: from })
    },

    setObservedAt(iso: string): ReportSightingState {
      return patchDraft({ observedAt: iso })
    },

    addPhotos,
    retryPhoto,

    removePhoto(clientPhotoId: string): ReportSightingState {
      return patch({
        photos: state.photos.filter((item) => item.clientPhotoId !== clientPhotoId),
      })
    },

    setSpecies(speciesId: string | null): ReportSightingState {
      // 注意：`classifiedBy` **保持原值**（规格 §5.5 第 1 条），
      // 「用户纠正了自动结果」由 `speciesSource: 'corrected'` 在服务端体现。
      return patchDraft({ speciesId })
    },

    setIndividual(individualId: string | null): ReportSightingState {
      return patchDraft({ individualId })
    },

    setNewIndividualName(name: string): ReportSightingState {
      return patchDraft({ newIndividualName: name })
    },

    setNote(note: string): ReportSightingState {
      return patchDraft({ note })
    },

    setHealthConcern(value: boolean): ReportSightingState {
      return patchDraft({ healthConcern: value })
    },

    setAnonymous(value: boolean): ReportSightingState {
      return patchDraft({ anonymous: value })
    },

    setEthicsAcknowledged(value: boolean): ReportSightingState {
      return patchDraft({ ethicsAcknowledged: value })
    },

    setZoneId(zoneId: string | null): ReportSightingState {
      return patchDraft({ zoneId })
    },

    setAccuracy(accuracyM: number): ReportSightingState {
      return patchDraft({ accuracyM })
    },

    requestClassification: classifyFirstUploaded,
    validate,
    submit,

    reset(): void {
      hydrated = false
      submitIdempotencyKey = null
      state = initialState()
      for (const listener of listeners) listener()
    },
  }
}

/** 供 UI 判断「自动分类是否给出了可确认的建议」 */
export function hasClassificationSuggestions(state: ReportSightingState): boolean {
  return !state.classification.degraded && state.classification.suggestions.length > 0
}

/** 供 UI 判断某个物种是否被自动预选 */
export function isPreselectedSpecies(state: ReportSightingState, speciesId: string): boolean {
  return state.classification.preselectedSpeciesId === speciesId
}

/** 物种是否存在于当前列表（用于 UI 显示未识别） */
export function speciesOf(
  state: ReportSightingState,
  speciesId: string | null,
): WildlifeSpecies | undefined {
  return findSpecies(state.species, speciesId)
}
