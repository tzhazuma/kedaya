import { err, ok, type Result } from '@kedaya/shared'

import type {
  CampusBasemap,
  WildlifeClassifyResult,
  WildlifeIndividual,
  WildlifeIndividualCreateBody,
  WildlifeMedia,
  WildlifeSighting,
  WildlifeSightingCreateBody,
  WildlifeSpecies,
  WildlifeSpot,
  WildlifeTrack,
  WildlifeZone,
} from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWildlifeQuery,
  UploadMediaInput,
  WildlifePage,
  WildlifeRepository,
} from '../../domain/ports/wildlifeRepository'
import { mockNow } from '../mock/fixtures'
import {
  createWildlifeMemoryDatabase,
  type MockClassifierMode,
  type WildlifeMemoryDatabase,
} from '../mock/wildlifeMemoryDatabase'

/**
 * Mock 野生动物仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 除实现端口外，额外暴露一组**演示控制**（reset / failNextRequests / setLatency / clearAll），
 * 让页面能真实演示「加载中 / 空 / 错误」三态，而不是靠硬编码假状态。
 * 形状与 `mockForumRepository` / `mockFaqRepository` 保持一致，页面代码可以照抄。
 *
 * 另外暴露 `setClassifierMode`：用于演示「无 API key 时自动降级为纯手动」
 * （默认就是 `manual`，与服务端 `WILDLIFE_CLASSIFIER` 的默认值一致，规格 §5.4）。
 */

export interface MockWildlifeRepository extends WildlifeRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
  classifierMode(): MockClassifierMode
  setClassifierMode(mode: MockClassifierMode): void
}

export interface MockWildlifeRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  database?: WildlifeMemoryDatabase
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockWildlifeRepository(
  options: MockWildlifeRepositoryOptions = {},
): MockWildlifeRepository {
  const db: WildlifeMemoryDatabase = options.database ?? createWildlifeMemoryDatabase()
  const now = options.now ?? mockNow
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0

  async function guard<T>(
    work: () => Result<T, RepositoryError>,
  ): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  return {
    kind: 'mock',

    basemap(): Promise<Result<CampusBasemap, RepositoryError>> {
      return guard(() => ok(db.basemap()))
    },

    listSpecies(): Promise<Result<WildlifeSpecies[], RepositoryError>> {
      return guard(() => ok(db.listSpecies()))
    },

    listZones(): Promise<Result<WildlifeZone[], RepositoryError>> {
      return guard(() => ok(db.listZones()))
    },

    zoneDetail(id: string): Promise<Result<WildlifeZone, RepositoryError>> {
      return guard(() => {
        const found = db.findZone(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '区域不存在' })
        return ok(found)
      })
    },

    listSpots(query: ListWildlifeQuery = {}): Promise<Result<WildlifePage<WildlifeSpot>, RepositoryError>> {
      return guard(() => ok(db.listSpots(query, now())))
    },

    listTracks(query: ListWildlifeQuery = {}): Promise<Result<WildlifePage<WildlifeTrack>, RepositoryError>> {
      return guard(() => ok(db.listTracks(query)))
    },

    trackDetail(id: string): Promise<Result<WildlifeTrack, RepositoryError>> {
      return guard(() => {
        const found = db.findTrack(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '轨迹不存在或尚未生成' })
        return ok(found)
      })
    },

    listIndividuals(speciesId?: string | null): Promise<Result<WildlifeIndividual[], RepositoryError>> {
      return guard(() => ok(db.listIndividuals(speciesId)))
    },

    listSightings(
      query: ListWildlifeQuery = {},
    ): Promise<Result<WildlifePage<WildlifeSighting>, RepositoryError>> {
      return guard(() => ok(db.listSightings(query)))
    },

    sightingDetail(id: string): Promise<Result<WildlifeSighting, RepositoryError>> {
      return guard(() => {
        const found = db.findSighting(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '观测记录不存在' })
        return ok(found)
      })
    },

    uploadMedia(input: UploadMediaInput): Promise<Result<WildlifeMedia, RepositoryError>> {
      return guard(() => ok(db.uploadMedia(input, now())))
    },

    createSighting(
      body: WildlifeSightingCreateBody,
      _idempotencyKey?: string,
    ): Promise<Result<WildlifeSighting, RepositoryError>> {
      return guard(() => db.createSighting(body, now()))
    },

    createIndividual(
      body: WildlifeIndividualCreateBody,
      _idempotencyKey?: string,
    ): Promise<Result<WildlifeIndividual, RepositoryError>> {
      return guard(() => db.createIndividual(body, now()))
    },

    classify(mediaId: string): Promise<Result<WildlifeClassifyResult, RepositoryError>> {
      return guard(() => ok(db.classify(mediaId)))
    },

    reset(): void {
      db.reset()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    clearAll(): void {
      db.clear()
    },

    classifierMode: () => db.classifierMode(),

    setClassifierMode(mode: MockClassifierMode): void {
      db.setClassifierMode(mode)
    },
  }
}
