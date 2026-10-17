import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  WILDLIFE_STATUS_CONFIRMED,
  noteProblem,
  placeProblem,
  speciesProblem,
} from '../../domain/models/wildlife'
import type {
  CreateWildlifeSpotInput,
  WildlifeSpot,
  WildlifeSpotFilters,
} from '../../domain/models/wildlife'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListWildlifeSpotsQuery,
  WildlifeRepository,
} from '../../domain/ports/wildlifeRepository'
import { STORAGE_PREFIX } from '../storage/keys'

/**
 * Mock 校园动物观察点仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 它复刻后端 `WildlifeSpotService` + `WildlifeSpotPrismaRepository` 的真实行为，
 * 而不是"假列表"：
 *   · **排序**：`createdAt desc, id desc` —— 与 data 层的 `buildOrderBy` 逐字一致
 *     （只按 createdAt 排会在同一毫秒落库的两行之间翻页漏读）；
 *   · **筛选**：species 包含匹配 + 忽略大小写（后端是 `contains` + `insensitive`）；
 *   · **分页**：游标 = 记录 id，取 limit+1 判断有没有下一页（与基类同一套算法）；
 *   · **confirm**：把状态改成 `confirmed`，幂等、不校验登录 —— 因为它改的是
 *     全校共享的字段，不是某个人的标记；
 *   · **校验**：与后端 `createSchema` 同一套长度上限（500/500/500）。
 *
 * 数据落在 `CachePort`（默认 Taro Storage），所以**上报后刷新页面观察点还在**，
 * 真的可以当作"轻量本地后端"用。
 *
 * 没有 `viewerId`：本模块匿名，后端 `create` 忽略登录主体，mock 也就不该凭空
 * 造出一个归属关系（否则页面上会出现"我上报的"这种后端并不支持的概念）。
 */

export interface MockWildlifeRepositoryOptions {
  cache: CachePort
  latencyMs?: number
  now?: () => Date
}

export interface MockWildlifeRepository extends WildlifeRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(spots: readonly WildlifeSpot[]): void
}

/**
 * mock 自己的存储 key。
 *
 * 与列表缓存 key（容器里的 `cacheKey`）刻意分开：列表缓存存的是
 * `{ items, nextCursor, updatedAt }`（契约 §8 hydrate 用），若两者共用一个 key，
 * 一次 `list.load()` 就会把数据集覆盖成缓存载荷。
 * 也不往 `data/storage/keys.ts` 里加：那是共享文件（多个模块并行修改）。
 */
const MOCK_DB_KEY = `${STORAGE_PREFIX}mock:wildlife:spots`

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 演示种子：校园里真实感很强的观察点。
 *
 * 地点用校园里能叫得出名字的地方，坐标落在上科大校园一带
 * （与 `services/api/prisma/seed.ts`、拼单详情页的 `CAMPUS_POINT` 同一片区域）。
 * 坐标按 **gcj02** 理解 —— 微信 `openLocation` 与国内地图都用这个坐标系，
 * 而当前没有"获取当前位置"能力，坐标是手填 / 默认值，只求"能在地图上找到大概位置"。
 *
 * `status` 只用后端真实会写出的两个值：`active`（Prisma 默认）与
 * `confirmed`（`POST /items/:id/confirm`），其中留一条已确认的，
 * 好让详情页的「已确认」态在演示数据里就能看到，而不是必须自己点一次。
 */
function defaultSeed(now: Date): WildlifeSpot[] {
  const iso = (minutesAgo: number): string =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString()

  const spots: Array<Omit<WildlifeSpot, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'ws-demo-1',
      species: '橘猫',
      place: '生活区 5 号楼门口',
      lat: 31.178_902,
      lng: 121.591_764,
      note: '左耳有缺口，已绝育。很亲人，但请别喂人类的食物。',
      reportedBy: null,
      status: 'active',
    },
    {
      id: 'ws-demo-2',
      species: '三花猫',
      place: '图书馆后门',
      lat: 31.179_640,
      lng: 121.592_410,
      note: '怕人，请勿追赶。傍晚常在台阶下晒太阳。',
      reportedBy: null,
      status: 'active',
    },
    {
      id: 'ws-demo-3',
      species: '黑天鹅',
      place: '湖畔东侧',
      lat: 31.180_215,
      lng: 121.593_118,
      note: '一对，常在上午出现。不要投喂面包，会伤到它们。',
      reportedBy: null,
      status: WILDLIFE_STATUS_CONFIRMED,
    },
    {
      id: 'ws-demo-4',
      species: '白鹭',
      place: '人工湿地',
      lat: 31.181_033,
      lng: 121.594_020,
      note: '清晨觅食，观鸟请保持距离，不要为了拍照走近。',
      reportedBy: null,
      status: 'active',
    },
    {
      id: 'ws-demo-5',
      species: '喜鹊',
      place: '第一食堂后侧',
      lat: 31.178_566,
      lng: 121.592_233,
      note: null,
      reportedBy: null,
      status: 'active',
    },
    {
      id: 'ws-demo-6',
      species: '松鼠',
      place: '教学楼 A 座后草坪',
      lat: 31.179_188,
      lng: 121.593_502,
      note: '动作很快，会在树之间跑动。别用手喂。',
      reportedBy: null,
      status: 'active',
    },
    {
      id: 'ws-demo-7',
      species: '戴胜',
      place: '操场北侧草坪',
      lat: 31.179_345,
      lng: 121.593_011,
      note: '偶尔停留，在地面翻找虫子。',
      reportedBy: null,
      status: 'active',
    },
  ]

  return spots.map((spot, index) => ({
    ...spot,
    createdAt: iso(45 + index * 190),
    updatedAt: iso(45 + index * 190),
  }))
}

export function createMockWildlifeRepository(
  options: MockWildlifeRepositoryOptions,
): MockWildlifeRepository {
  const { cache } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): WildlifeSpot[] {
    const stored = cache.read<unknown>(MOCK_DB_KEY)
    // 空数组是**合法状态**（演示空态），必须与「从未初始化」区分开，
    // 否则 clearAll() 之后第一次读取就会把种子数据又塞回来。
    if (Array.isArray(stored)) return stored as WildlifeSpot[]
    const seeded = defaultSeed(now())
    cache.write(MOCK_DB_KEY, seeded)
    return seeded
  }

  function save(spots: WildlifeSpot[]): void {
    cache.write(MOCK_DB_KEY, spots)
  }

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  function find(spots: WildlifeSpot[], id: string): WildlifeSpot | null {
    return spots.find((spot) => spot.id === id) ?? null
  }

  /**
   * 与后端 `createSchema`（`z.string().min(1).max(500)` + `z.number()`）对齐。
   * 长度文案复用 domain 的纯函数，保证"客户端即时提示"与"mock 拒绝"一字不差。
   */
  function validateCreate(input: CreateWildlifeSpotInput): RepositoryError | null {
    const species = speciesProblem(input.species)
    if (species !== null) {
      return { code: 'VALIDATION_FAILED', message: species, details: { field: 'species' } }
    }

    const place = placeProblem(input.place)
    if (place !== null) {
      return { code: 'VALIDATION_FAILED', message: place, details: { field: 'place' } }
    }

    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      // 后端 `z.number()` 默认拒绝 NaN / Infinity；坐标是地图定位的唯一依据，
      // 宁可在上报时报错，也不要落一条点开就跑到海里的记录。
      return { code: 'VALIDATION_FAILED', message: '坐标不是有效数字', details: { field: 'latlng' } }
    }

    const note = noteProblem(input.note ?? '')
    if (note !== null) {
      return { code: 'VALIDATION_FAILED', message: note, details: { field: 'note' } }
    }

    return null
  }

  return {
    kind: 'mock',

    list(query: ListWildlifeSpotsQuery): Promise<Result<Page<WildlifeSpot>, RepositoryError>> {
      return guard(() => {
        const filters: WildlifeSpotFilters = query.filters
        let spots = load()

        if (filters.species !== undefined && filters.species.trim() !== '') {
          // 后端是 `contains` + `mode: 'insensitive'`：包含匹配且忽略大小写
          // （物种名中英混杂，「Little Egret」用小写也该搜得到）
          const needle = filters.species.trim().toLowerCase()
          spots = spots.filter((spot) => spot.species.toLowerCase().includes(needle))
        }

        // 与 data 层的 `buildOrderBy` 一致：createdAt desc + id desc 兜底
        spots = [...spots].sort((a, b) => {
          const diff = b.createdAt.localeCompare(a.createdAt)
          return diff !== 0 ? diff : b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, spots.findIndex((spot) => spot.id === query.cursor) + 1)
        const visible = spots.slice(start, start + limit)
        const hasMore = start + limit < spots.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<WildlifeSpot, RepositoryError>> {
      return guard(() => {
        const found = find(load(), id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条观察点不存在或已被删除' })
        return ok(found)
      })
    },

    create(input: CreateWildlifeSpotInput): Promise<Result<WildlifeSpot, RepositoryError>> {
      return guard(() => {
        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const spot: WildlifeSpot = {
          id: `ws-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          species: input.species.trim(),
          place: input.place.trim(),
          lat: input.lat,
          lng: input.lng,
          // 与后端 `normalizeText` 的语义一致：空串 / 未填都归一成 null
          note: normalizeOptionalText(input.note),
          // 本模块匿名：后端忽略登录主体，客户端也不发 reportedBy
          reportedBy: null,
          // Prisma 默认值；confirmed 只能由 `confirm` 领域动作写入
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([spot, ...load()])
        return ok(spot)
      })
    },

    confirm(id: string): Promise<Result<WildlifeSpot, RepositoryError>> {
      return guard(() => {
        const spots = load()
        const found = find(spots, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条观察点不存在或已被删除' })

        // 幂等：已经是 confirmed 再点一次**不报冲突**，只把 updatedAt 推进。
        // （后端就是一次 update，没有任何"重复确认"的判定。）
        const next: WildlifeSpot = {
          ...found,
          status: WILDLIFE_STATUS_CONFIRMED,
          updatedAt: now().toISOString(),
        }
        save(spots.map((spot) => (spot.id === id ? next : spot)))
        return ok(next)
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(MOCK_DB_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save([])
    },

    seed(spots: readonly WildlifeSpot[]): void {
      save([...spots])
    },
  }
}

/** 与后端 `normalizeText` 一致：空串 / 未填都归一成 null */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return text.length === 0 ? null : text
}
