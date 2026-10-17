import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  TECHPIE_STATUS_ACTIVE,
  TECHPIE_STATUS_SYNCED,
  categoryProblem,
  linkKeyProblem,
  nameProblem,
  urlProblem,
} from '../../domain/models/techpie'
import type { CreateTechpieLinkInput, TechpieLink } from '../../domain/models/techpie'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ListTechpieLinksQuery, TechpieRepository } from '../../domain/ports/techpieRepository'
import { STORAGE_PREFIX } from '../storage/keys'

/**
 * Mock 校园技术服务目录仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与"假列表"不同，它**复刻后端 `TechpieLinkService` + `TechpieLinkPrismaRepository` 的行为**：
 *   · **排序**：`createdAt desc, id desc` —— 与 data 层的 `buildOrderBy` 逐字一致
 *     （只按 createdAt 排会在同一毫秒落库的两行之间翻页漏读）；
 *   · **筛选**：`category` 精确匹配 + `q` 在 `name` / `url` 上包含匹配（忽略大小写，
 *     与后端 `contains` + `insensitive` 一致）；
 *   · **分页**：游标 = 记录 id，取 limit+1 判断有没有下一页（与基类同一套算法）；
 *   · **sync**：把状态改成 `synced` 并推进 `updatedAt`，幂等、不校验登录
 *     —— 因为它改的是**人工核对状态**，不是某个人的标记，也不碰任何外部系统；
 *   · **校验**：与后端同一套边界（名称 / 分类 / 地址 / key）。
 *
 * 数据落在 `CachePort`（默认 Taro Storage），所以**新增后刷新页面条目还在**。
 *
 * 没有 `viewerId`：本模块匿名共建，后端 `create` 忽略登录主体，
 * mock 也就不该凭空造出一个归属关系（否则页面上会出现后端并不支持的"我添加的"）。
 */

export interface MockTechpieRepositoryOptions {
  cache: CachePort
  latencyMs?: number
  now?: () => Date
}

export interface MockTechpieRepository extends TechpieRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(links: readonly TechpieLink[]): void
}

/**
 * mock 自己的存储 key。
 *
 * 与列表缓存 key（容器里的 `cacheKey`）刻意分开：列表缓存存的是
 * `{ items, nextCursor, updatedAt }`（契约 §8 hydrate 用），若两者共用一个 key，
 * 一次 `list.load()` 就会把数据集覆盖成缓存载荷。
 * 也不往 `data/storage/keys.ts` 里加：那是共享文件（多个模块并行修改）。
 */
const MOCK_DB_KEY = `${STORAGE_PREFIX}mock:techpie:links`

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 演示种子：上科大同学真的会用到的技术服务。
 *
 * 地址都是 `https://` + 学校域名下的合理路径（**演示数据**，不代表学校官方，
 * 也不保证能打开 —— 原样呼应页面上那句"状态为人工核对结果"）。
 * 状态刻意覆盖三种展示：`synced`（已核对）/ `active`（可用）/ `pending`（待核对），
 * 好让三种标签在离线演示里就能看到，而不是必须自己点一次 sync。
 *
 * ⚠️ 与后端 `prisma/seed.ts` 的 6 条 TechPie 种子**不同**：那边是对方站点的
 * 内部路径（本轮不动它，改动会牵动其它模块的初始化脚本）。真实库里那 6 条
 * 的分类都在本端白名单内，展示与筛选都不会出问题。
 */
const SEED_LINKS: ReadonlyArray<Pick<TechpieLink, 'key' | 'name' | 'category' | 'url' | 'status'>> = [
  { key: 'techpie-jwc', name: '教务系统', category: 'academic', url: 'https://jwc.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-library', name: '图书馆', category: 'library', url: 'https://library.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-software', name: '正版软件中心', category: 'software', url: 'https://software.shanghaitech.edu.cn/', status: TECHPIE_STATUS_SYNCED },
  { key: 'techpie-vpn', name: '校园 VPN（校外访问）', category: 'network', url: 'https://vpn.shanghaitech.edu.cn/', status: TECHPIE_STATUS_SYNCED },
  { key: 'techpie-ecard', name: '校园卡与一卡通', category: 'campus-card', url: 'https://ecard.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-finance', name: '财务报销系统', category: 'finance', url: 'https://finance.shanghaitech.edu.cn/', status: 'pending' },
  { key: 'techpie-mail', name: '学生邮箱', category: 'email', url: 'https://mail.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-print', name: '自助打印服务', category: 'service', url: 'https://print.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-it', name: '网络信息中心', category: 'network', url: 'https://it.shanghaitech.edu.cn/', status: 'pending' },
  { key: 'techpie-portal', name: '校园服务门户', category: 'portal', url: 'https://portal.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
  { key: 'techpie-club', name: '社团与活动平台', category: 'community', url: 'https://club.shanghaitech.edu.cn/', status: TECHPIE_STATUS_ACTIVE },
]

function defaultSeed(now: Date): TechpieLink[] {
  return SEED_LINKS.map((link, index) => {
    // 间隔 7 分钟、最新的排最前：列表按 createdAt desc 排序后顺序与数组一致，便于阅读
    const iso = new Date(now.getTime() - index * 7 * 60_000).toISOString()
    return {
      id: `tp-demo-${String(index + 1).padStart(2, '0')}`,
      ...link,
      createdAt: iso,
      updatedAt: iso,
    }
  })
}

export function createMockTechpieRepository(
  options: MockTechpieRepositoryOptions,
): MockTechpieRepository {
  const { cache } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): TechpieLink[] {
    const stored = cache.read<unknown>(MOCK_DB_KEY)
    // 空数组是**合法状态**（用户清空了演示数据），必须与「从未初始化」区分开
    if (Array.isArray(stored)) return stored as TechpieLink[]
    const seeded = defaultSeed(now())
    cache.write(MOCK_DB_KEY, seeded)
    return seeded
  }

  function save(links: TechpieLink[]): void {
    cache.write(MOCK_DB_KEY, links)
  }

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /**
   * 创建校验：key → 名称 → 分类 → 地址（顺序与后端一致）。
   * 用 domain 的纯函数而不是各写一遍，保证"页面即时提示"与"mock 拒绝"一字不差。
   */
  function validateCreate(input: CreateTechpieLinkInput): RepositoryError | null {
    const checks: ReadonlyArray<readonly [string, string | null]> = [
      ['key', linkKeyProblem(input.key)],
      ['name', nameProblem(input.name)],
      ['category', categoryProblem(input.category)],
      ['url', urlProblem(input.url)],
    ]
    for (const [field, message] of checks) {
      if (message !== null) return { code: 'VALIDATION_FAILED', message, details: { field } }
    }
    return null
  }

  return {
    kind: 'mock',

    list(query: ListTechpieLinksQuery): Promise<Result<Page<TechpieLink>, RepositoryError>> {
      return guard(() => {
        let links = load()
        const category = query.filters.category
        const q = query.filters.q

        if (category !== undefined && category.trim() !== '') {
          // 分类是**精确**匹配（与后端 `where.category = value` 一致），未知分类返回空列表
          links = links.filter((link) => link.category === category.trim())
        }
        if (q !== undefined && q.trim() !== '') {
          // 后端是 `OR: [name contains, url contains]` + `mode: 'insensitive'`：
          // 名称与地址都要能搜到（`VPN` 这种词常出现在域名里）
          const needle = q.trim().toLowerCase()
          links = links.filter(
            (link) =>
              link.name.toLowerCase().includes(needle) ||
              link.url.toLowerCase().includes(needle),
          )
        }

        // 与 data 层的 `buildOrderBy` 一致：createdAt desc + id desc 兜底
        links = [...links].sort((a, b) => {
          const diff = b.createdAt.localeCompare(a.createdAt)
          return diff !== 0 ? diff : b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, links.findIndex((link) => link.id === query.cursor) + 1)
        const visible = links.slice(start, start + limit)
        const hasMore = start + limit < links.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<TechpieLink, RepositoryError>> {
      return guard(() => {
        const found = load().find((link) => link.id === id) ?? null
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条服务记录不存在或已下架' })
        return ok(found)
      })
    },

    create(input: CreateTechpieLinkInput): Promise<Result<TechpieLink, RepositoryError>> {
      return guard(() => {
        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const link: TechpieLink = {
          id: `tp-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          key: input.key.trim(),
          name: input.name.trim(),
          category: input.category,
          url: input.url.trim(),
          // 后端 Prisma 默认值；`synced` 只能由 `sync` 领域动作写入
          status: input.status ?? TECHPIE_STATUS_ACTIVE,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([link, ...load()])
        return ok(link)
      })
    },

    sync(id: string): Promise<Result<TechpieLink, RepositoryError>> {
      return guard(() => {
        const links = load()
        const found = links.find((link) => link.id === id) ?? null
        if (found === null) return err({ code: 'NOT_FOUND', message: '这条服务记录不存在或已下架' })

        // 幂等：已经是 synced 再点一次**不报冲突**，只把 updatedAt 推进
        // （后端就是一次 update，没有任何"重复核对"的判定）。
        const next: TechpieLink = {
          ...found,
          status: TECHPIE_STATUS_SYNCED,
          updatedAt: now().toISOString(),
        }
        save(links.map((link) => (link.id === id ? next : link)))
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

    seed(links: readonly TechpieLink[]): void {
      save([...links])
    },
  }
}
