import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  BUDDY_MAX_CAPACITY,
  BUDDY_MIN_CAPACITY,
  isBuddyActivity,
  isBuddySort,
} from '../../domain/models/buddy'
import type {
  BuddyGroup,
  BuddyGroupDetail,
  BuddyGroupFilters,
  BuddyMemberRow,
  BuddyMemberView,
  CreateBuddyGroupInput,
} from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { BuddyRepository, ListBuddyGroupsQuery } from '../../domain/ports/buddyRepository'
import { StorageKeys } from '../storage/keys'

/**
 * Mock 找搭子仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 复刻后端 `BuddyGroupService` + `BuddyGroupPrismaRepository` 的全部规则：
 *   · 创建时**同一步**写入组长成员关系（不可能出现「没有组长的搭子」）；
 *   · 容量：人数达到 capacity 自动 `recruiting → full`，有人退出回落到 `recruiting`；
 *   · 归属：只有组长能停止招募 / 取消；组长不能退出（必须走 cancel）；
 *   · 筛选与排序：活动 / 状态 / 关键词 / 我发起的 / 我加入的 / 只看未开始 + 两种排序。
 *
 * 数据落在 `CachePort` 里（key 与列表缓存 key 刻意分开，见 mockErrandRepository
 * 顶部说明），因此刷新页面后自己发起的搭子还在。
 */

export interface MockBuddyRepositoryOptions {
  cache: CachePort
  viewerId: () => string | null
  latencyMs?: number
  now?: () => Date
  seed?: MockBuddySeed
}

export interface MockBuddySeed {
  groups: readonly BuddyGroup[]
  members: readonly BuddyMemberRow[]
}

export interface MockBuddyRepository extends BuddyRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  clearAll(): void
}

interface BuddyStore {
  groups: BuddyGroup[]
  members: BuddyMemberRow[]
}

const STORAGE_KEY = `${StorageKeys.buddyListCache}:mock-store`

/** 演示用的展示名映射（真实实现里由 user 表 join 出来） */
const KNOWN_NAMES: Readonly<Record<string, string>> = {
  'u-me': '我',
  'mock-buddy-1': '李同学',
  'mock-buddy-2': '王同学',
  'mock-buddy-3': '陈同学',
  'mock-buddy-4': '赵同学',
  'mock-member-a': '刘同学',
  'mock-member-b': '周同学',
}

function displayNameFor(userId: string): string {
  return KNOWN_NAMES[userId] ?? `同学${userId.slice(-4)}`
}

function iso(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

function defaultSeed(now: Date): BuddyStore {
  const at = (minutes: number): string => iso(now, minutes)
  const group = (
    id: string,
    ownerId: string,
    activity: string,
    title: string,
    description: string | null,
    campusSpot: string,
    startsInMinutes: number,
    capacity: number,
    status: string,
    createdMinutesAgo: number,
  ): BuddyGroup => ({
    id,
    ownerId,
    activity,
    title,
    description,
    campusSpot,
    startsAt: at(startsInMinutes),
    capacity,
    status,
    createdAt: at(-createdMinutesAgo),
    updatedAt: at(-createdMinutesAgo + 10),
  })

  const groups: BuddyGroup[] = [
    group(
      'buddy-demo-1',
      'mock-buddy-1',
      'study',
      '今晚上自习，一起卷到闭馆',
      '图书馆 4 楼安静区，互相监督不摸鱼。',
      '图书馆一楼闸机',
      360,
      4,
      'recruiting',
      120,
    ),
    group(
      'buddy-demo-2',
      'u-me',
      'sport',
      '羽毛球 2v2，缺个搭子',
      '水平不限，主要想运动一下，场地已订好。',
      '体育馆羽毛球场',
      1_440,
      6,
      'recruiting',
      90,
    ),
    group(
      'buddy-demo-3',
      'mock-buddy-2',
      'meal',
      '一食堂探店小分队',
      '想试试新开的窗口，凑 3 个人。',
      '一食堂门口',
      600,
      3,
      'full',
      300,
    ),
    group(
      'buddy-demo-4',
      'mock-buddy-3',
      'game',
      '周末桌游局（剧本杀）',
      '新手友好，缺 2 个人就成局。',
      '学生活动中心 3F',
      2_880,
      5,
      'recruiting',
      60,
    ),
    group(
      'buddy-demo-5',
      'mock-buddy-4',
      'movie',
      '周五晚的电影搭子',
      '已经凑满人数，停止招募。',
      '学校东门影院',
      4_320,
      4,
      'closed',
      480,
    ),
    group(
      'buddy-demo-6',
      'u-me',
      'travel',
      '拼车去虹桥高铁站',
      '行程变动，已取消。',
      '学校北门',
      720,
      2,
      'cancelled',
      240,
    ),
  ]

  const member = (groupId: string, userId: string, role: string, joinedMinutesAgo: number) => ({
    id: `bm-${groupId}-${userId}`,
    groupId,
    userId,
    role,
    joinedAt: at(-joinedMinutesAgo),
  })

  const members: BuddyMemberRow[] = [
    member('buddy-demo-1', 'mock-buddy-1', 'owner', 120),
    member('buddy-demo-2', 'u-me', 'owner', 90),
    member('buddy-demo-3', 'mock-buddy-2', 'owner', 300),
    member('buddy-demo-3', 'mock-member-a', 'member', 240),
    member('buddy-demo-3', 'mock-member-b', 'member', 180),
    member('buddy-demo-4', 'mock-buddy-3', 'owner', 60),
    member('buddy-demo-4', 'u-me', 'member', 30),
    member('buddy-demo-5', 'mock-buddy-4', 'owner', 480),
    member('buddy-demo-6', 'u-me', 'owner', 240),
  ]

  return { groups, members }
}

function emptyStore(): BuddyStore {
  return { groups: [], members: [] }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockBuddyRepository(options: MockBuddyRepositoryOptions): MockBuddyRepository {
  const { cache, viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): BuddyStore {
    const stored = cache.read<unknown>(STORAGE_KEY)
    if (isStore(stored)) return stored
    const seeded =
      options.seed !== undefined
        ? { groups: [...options.seed.groups], members: [...options.seed.members] }
        : defaultSeed(now())
    if (seeded.groups.length > 0 || seeded.members.length > 0) cache.write(STORAGE_KEY, seeded)
    return seeded
  }

  function save(store: BuddyStore): void {
    cache.write(STORAGE_KEY, store)
  }

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

  function findGroup(store: BuddyStore, id: string): BuddyGroup | null {
    return store.groups.find((group) => group.id === id) ?? null
  }

  function requireGroup(store: BuddyStore, id: string): Result<BuddyGroup, RepositoryError> {
    const found = findGroup(store, id)
    if (found === null) return err({ code: 'NOT_FOUND', message: '搭子不存在或已被解散' })
    return ok(found)
  }

  function findMembership(
    store: BuddyStore,
    groupId: string,
    userId: string,
  ): BuddyMemberRow | null {
    return (
      store.members.find((row) => row.groupId === groupId && row.userId === userId) ?? null
    )
  }

  function memberRows(store: BuddyStore, groupId: string): BuddyMemberRow[] {
    return store.members
      .filter((row) => row.groupId === groupId)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id))
  }

  function toMemberView(row: BuddyMemberRow): BuddyMemberView {
    return {
      userId: row.userId,
      role: row.role,
      joinedAt: row.joinedAt,
      displayName: displayNameFor(row.userId),
      avatarUrl: null,
    }
  }

  function replaceGroup(store: BuddyStore, next: BuddyGroup): void {
    store.groups = store.groups.map((group) => (group.id === next.id ? next : group))
    save(store)
  }

  function applyState(store: BuddyStore, group: BuddyGroup, status: string): BuddyGroup {
    const next: BuddyGroup = { ...group, status, updatedAt: now().toISOString() }
    replaceGroup(store, next)
    return next
  }

  return {
    kind: 'mock',

    list(query: ListBuddyGroupsQuery): Promise<Result<Page<BuddyGroup>, RepositoryError>> {
      return guard(() => {
        const filters: BuddyGroupFilters = query.filters
        const viewer = viewerId()

        // `mine=1` / `joined=1` 需要登录（后端 controller 会抛 401）
        if (filters.scope === 'mine' || filters.scope === 'joined') {
          if (viewer === null) {
            return err({ code: 'UNAUTHENTICATED', message: '查看「我的搭子」需要先登录' })
          }
        }

        const store = load()
        let groups = store.groups
        if (filters.activity !== undefined) {
          groups = groups.filter((group) => group.activity === filters.activity)
        }
        if (filters.status !== undefined) {
          groups = groups.filter((group) => group.status === filters.status)
        }
        if (filters.scope === 'mine' && viewer !== null) {
          groups = groups.filter((group) => group.ownerId === viewer)
        }
        if (filters.scope === 'joined' && viewer !== null) {
          groups = groups.filter((group) =>
            store.members.some((row) => row.groupId === group.id && row.userId === viewer),
          )
        }
        if (filters.onlyUpcoming === true) {
          const current = now().getTime()
          groups = groups.filter((group) => new Date(group.startsAt).getTime() >= current)
        }
        if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
          const keyword = filters.keyword.trim().toLowerCase()
          groups = groups.filter(
            (group) =>
              group.title.toLowerCase().includes(keyword) ||
              (group.description ?? '').toLowerCase().includes(keyword),
          )
        }

        const sort = isBuddySort(filters.sort) ? filters.sort : 'latest'
        const sorted = [...groups].sort((a, b) => {
          if (sort === 'soon') {
            return a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)
          }
          return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, sorted.findIndex((group) => group.id === query.cursor) + 1)
        const visible = sorted.slice(start, start + limit)
        const hasMore = start + limit < sorted.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
          total: sorted.length,
        })
      })
    },

    detail(id: string): Promise<Result<BuddyGroupDetail, RepositoryError>> {
      return guard(() => {
        const store = load()
        const found = requireGroup(store, id)
        if (!found.ok) return found
        return ok({
          ...found.value,
          members: memberRows(store, id).map(toMemberView),
        })
      })
    },

    create(input: CreateBuddyGroupInput): Promise<Result<BuddyGroup, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发起搭子招募' })
        }

        const checked = validateDraft(input, now())
        if (!checked.ok) return checked

        const timestamp = now().toISOString()
        const group: BuddyGroup = {
          id: `buddy-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          ownerId: viewer,
          activity: checked.value.activity,
          title: checked.value.title,
          description: checked.value.description,
          campusSpot: checked.value.campusSpot,
          startsAt: checked.value.startsAt,
          capacity: checked.value.capacity,
          status: 'recruiting',
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        const store = load()
        // 组长同时是成员：一次写入，避免出现「没有组长的搭子」
        store.groups = [group, ...store.groups]
        store.members = [
          ...store.members,
          {
            id: `bm-${group.id}-${viewer}`,
            groupId: group.id,
            userId: viewer,
            role: 'owner',
            joinedAt: timestamp,
          },
        ]
        save(store)
        return ok(group)
      })
    },

    join(id: string): Promise<Result<BuddyGroup, RepositoryError>> {
      return guard(() => {
        const actorId = viewerId()
        if (actorId === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再加入搭子' })
        }

        const store = load()
        const found = requireGroup(store, id)
        if (!found.ok) return found
        const group = found.value

        if (group.ownerId === actorId) {
          return err({ code: 'VALIDATION_FAILED', message: '不能加入自己创建的搭子' })
        }
        if (findMembership(store, id, actorId) !== null) {
          return err({ code: 'CONFLICT', message: '你已经加入这个搭子了' })
        }
        if (group.status !== 'recruiting') {
          return err({
            code: 'CONFLICT',
            message: group.status === 'full' ? '这个搭子已经满员了' : '这个搭子已经停止招募了',
          })
        }

        const count = memberRows(store, id).length
        if (count >= group.capacity) {
          return err({ code: 'CONFLICT', message: '这个搭子已经满员了' })
        }

        store.members = [
          ...store.members,
          {
            id: `bm-${id}-${actorId}`,
            groupId: id,
            userId: actorId,
            role: 'member',
            joinedAt: now().toISOString(),
          },
        ]
        save(store)

        // 人数刚好达到容量时把状态推进为 full（同一步完成）
        if (count + 1 >= group.capacity) {
          return ok(applyState(store, group, 'full'))
        }
        return ok(group)
      })
    },

    leave(id: string): Promise<Result<BuddyGroup, RepositoryError>> {
      return guard(() => {
        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })

        const store = load()
        const found = requireGroup(store, id)
        if (!found.ok) return found
        const group = found.value

        const membership = findMembership(store, id, actorId)
        if (membership === null) {
          return err({ code: 'VALIDATION_FAILED', message: '你还没有加入这个搭子' })
        }
        if (membership.role === 'owner') {
          return err({
            code: 'CONFLICT',
            message: '组长不能退出，请使用「取消招募」来结束这个搭子',
          })
        }

        store.members = store.members.filter(
          (row) => !(row.groupId === id && row.userId === actorId),
        )
        save(store)

        // 满员的人退出后腾出名额，重新开放招募
        const remaining = memberRows(store, id).length
        if (group.status === 'full' && remaining < group.capacity) {
          return ok(applyState(store, group, 'recruiting'))
        }
        return ok(group)
      })
    },

    close(id: string): Promise<Result<BuddyGroup, RepositoryError>> {
      return guard(() => {
        const store = load()
        const found = requireGroup(store, id)
        if (!found.ok) return found
        const group = found.value

        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        if (group.ownerId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只有组长可以停止招募' })
        }
        if (group.status !== 'recruiting') {
          return err({ code: 'CONFLICT', message: '只有招募中的搭子可以停止招募' })
        }

        return ok(applyState(store, group, 'closed'))
      })
    },

    cancel(id: string): Promise<Result<BuddyGroup, RepositoryError>> {
      return guard(() => {
        const store = load()
        const found = requireGroup(store, id)
        if (!found.ok) return found
        const group = found.value

        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        if (group.ownerId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只有组长可以取消搭子' })
        }
        if (group.status === 'closed' || group.status === 'cancelled') {
          return err({ code: 'CONFLICT', message: '这个搭子已经结束了' })
        }

        return ok(applyState(store, group, 'cancelled'))
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(STORAGE_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save(emptyStore())
    },
  }
}

function isStore(value: unknown): value is BuddyStore {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { groups?: unknown; members?: unknown }
  return Array.isArray(candidate.groups) && Array.isArray(candidate.members)
}

/* ------------------------------------------------------------------ *
 * 归一化与校验 —— 与服务端 buddy.service.ts 的纯函数一一对应
 * ------------------------------------------------------------------ */

interface NormalizedDraft {
  activity: string
  title: string
  description: string | null
  campusSpot: string
  startsAt: string
  capacity: number
}

function validateDraft(
  input: CreateBuddyGroupInput,
  now: Date,
): Result<NormalizedDraft, RepositoryError> {
  const activity = normalizeActivity(input.activity)
  if (!activity.ok) return activity
  const title = normalizeTitle(input.title)
  if (!title.ok) return title
  const description = normalizeText(input.description, 2000, '搭子简介')
  if (!description.ok) return description
  const campusSpot = normalizeSpot(input.campusSpot)
  if (!campusSpot.ok) return campusSpot
  const startsAt = normalizeStartsAt(input.startsAt, now)
  if (!startsAt.ok) return startsAt
  const capacity = normalizeCapacity(input.capacity)
  if (!capacity.ok) return capacity

  return ok({
    activity: activity.value,
    title: title.value,
    description: description.value,
    campusSpot: campusSpot.value,
    startsAt: startsAt.value,
    capacity: capacity.value,
  })
}

function validationError(message: string): RepositoryError {
  return { code: 'VALIDATION_FAILED', message }
}

function normalizeActivity(value: unknown): Result<string, RepositoryError> {
  if (!isBuddyActivity(value)) {
    return err(validationError('活动类型不在支持范围内'))
  }
  return ok(value)
}

function normalizeTitle(value: unknown): Result<string, RepositoryError> {
  const title = typeof value === 'string' ? value.trim() : ''
  if (title.length === 0) return err(validationError('请填写搭子标题'))
  if ([...title].length > 60) return err(validationError('标题最多 60 个字'))
  return ok(title)
}

function normalizeSpot(value: unknown): Result<string, RepositoryError> {
  const spot = typeof value === 'string' ? value.trim() : ''
  if (spot.length === 0) return err(validationError('请填写集合地点'))
  if ([...spot].length > 60) return err(validationError('集合地点最多 60 个字'))
  return ok(spot)
}

function normalizeCapacity(value: unknown): Result<number, RepositoryError> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return err(validationError('人数上限必须是整数'))
  }
  if (value < BUDDY_MIN_CAPACITY || value > BUDDY_MAX_CAPACITY) {
    return err(
      validationError(`人数上限需在 ${BUDDY_MIN_CAPACITY}~${BUDDY_MAX_CAPACITY} 之间`),
    )
  }
  return ok(value)
}

function normalizeStartsAt(value: unknown, now: Date): Result<string, RepositoryError> {
  const startsAt = value instanceof Date ? value : new Date(value as string)
  if (Number.isNaN(startsAt.getTime())) return err(validationError('开始时间格式不正确'))
  if (startsAt.getTime() <= now.getTime()) {
    return err(validationError('开始时间必须晚于当前时间'))
  }
  return ok(startsAt.toISOString())
}

function normalizeText(
  value: unknown,
  max: number,
  label: string,
): Result<string | null, RepositoryError> {
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== 'string') return err(validationError(`${label}格式不正确`))
  const text = value.trim()
  if (text.length === 0) return ok(null)
  if ([...text].length > max) return err(validationError(`${label}最多 ${max} 个字`))
  return ok(text)
}
