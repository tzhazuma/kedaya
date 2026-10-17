import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  ERRAND_MAX_REWARD_FEN,
  isErrandSort,
} from '../../domain/models/errand'
import type {
  CreateErrandTaskInput,
  ErrandTask,
  ErrandTaskFilters,
  UpdateErrandTaskInput,
} from '../../domain/models/errand'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ErrandTaskRepository, ListErrandTasksQuery } from '../../domain/ports/errandRepository'
import { StorageKeys } from '../storage/keys'

/**
 * Mock 跑腿仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 它**复刻了后端从 controller 到 service 的全部规则**（不只是「看起来像」）：
 *   · 归属：只有发布者能改 / 删 / 取消 / 确认完成，只有接单者能确认送达；
 *   · 状态机：open → accepted → delivered → completed，cancelled 为终态，
 *     非法跃迁返回 CONFLICT 而不是静默改写；
 *   · 校验：标题 / 地点长度、悬赏区间（整数分，上限 1000 元）、截止时间必须晚于当前；
 *   · 筛选与排序：状态、关键词、出发地、目的地、发布者、接单者 + 三种排序，
 *     排序在**全量数据**上做（游标分页才正确）。
 *
 * 数据落在 `CachePort` 里，因此**刷新页面后自己发布的还在**。
 *
 * ⚠️ 存储 key 与列表缓存 key（`StorageKeys.errandListCache`）**刻意分开**：
 * 列表缓存写的是「一页 View 数据」，如果两者共用一个 key，
 * 每次列表刷新都会把本地发布的原始数据冲掉。这里用 `:mock-store` 后缀区分。
 *
 * 当前用户通过 `viewerId()` 注入 —— 用户从「我的」登录后切换，
 * mock 才能正确判定「这是我发的 / 我接的」。
 */

export interface MockErrandRepositoryOptions {
  cache: CachePort
  viewerId: () => string | null
  latencyMs?: number
  now?: () => Date
  seed?: readonly ErrandTask[]
}

export interface MockErrandTaskRepository extends ErrandTaskRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  clearAll(): void
}

const STORAGE_KEY = `${StorageKeys.errandListCache}:mock-store`

function iso(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

function defaultSeed(now: Date): ErrandTask[] {
  const base = now.getTime()
  const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString()

  const rows: Array<Omit<ErrandTask, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'errand-demo-1',
      requesterId: 'mock-neighbor-1',
      runnerId: null,
      title: '帮忙取一下菜鸟驿站的快递',
      detail: '两个小箱子，取件码我会私聊发给你，送到 3 号楼楼下即可。',
      rewardFen: 500,
      fromPlace: '菜鸟驿站',
      toPlace: '3 号楼楼下',
      deadline: at(240),
      status: 'open',
      acceptedAt: null,
      deliveredAt: null,
      settledAt: null,
    },
    {
      id: 'errand-demo-2',
      requesterId: 'u-me',
      runnerId: null,
      title: '二食堂带一份番茄鸡蛋面',
      detail: '不要香菜，微辣。放到 5 号楼 412 门口就行。',
      rewardFen: 800,
      fromPlace: '二食堂',
      toPlace: '5 号楼 412',
      deadline: at(90),
      status: 'open',
      acceptedAt: null,
      deliveredAt: null,
      settledAt: null,
    },
    {
      id: 'errand-demo-3',
      requesterId: 'mock-neighbor-2',
      runnerId: 'u-me',
      title: '图书馆还书（3 本）',
      detail: '书在 6 号楼 208，还到图书馆一楼自助机。',
      rewardFen: 600,
      fromPlace: '6 号楼 208',
      toPlace: '图书馆一楼',
      deadline: at(300),
      status: 'accepted',
      acceptedAt: at(-30),
      deliveredAt: null,
      settledAt: null,
    },
    {
      id: 'errand-demo-4',
      requesterId: 'mock-neighbor-1',
      runnerId: 'mock-runner-a',
      title: '雨伞落在教学楼，帮忙送一下',
      detail: null,
      rewardFen: 300,
      fromPlace: '教学楼 A 座 305',
      toPlace: '2 号楼门口',
      deadline: at(120),
      status: 'delivered',
      acceptedAt: at(-45),
      deliveredAt: at(-5),
      settledAt: null,
    },
    {
      id: 'errand-demo-5',
      requesterId: 'u-me',
      runnerId: 'mock-runner-b',
      title: '帮忙打印一份 20 页的资料',
      detail: '黑白双面即可，A4。',
      rewardFen: 1_000,
      fromPlace: '文印中心',
      toPlace: '实验楼 4 层',
      deadline: at(60),
      status: 'delivered',
      acceptedAt: at(-40),
      deliveredAt: at(-10),
      settledAt: null,
    },
    {
      id: 'errand-demo-6',
      requesterId: 'u-me',
      runnerId: 'mock-runner-c',
      title: '代买一杯冰美式',
      detail: '大杯，去冰。',
      rewardFen: 1_200,
      fromPlace: '瑞幸（校门口）',
      toPlace: '4 号楼 315',
      deadline: at(-1_440),
      status: 'completed',
      acceptedAt: at(-120),
      deliveredAt: at(-60),
      settledAt: at(-50),
    },
    {
      id: 'errand-demo-7',
      requesterId: 'mock-neighbor-3',
      runnerId: null,
      title: '帮忙占一个自习座位',
      detail: '有事去不了，位置已经取消了。',
      rewardFen: 200,
      fromPlace: '图书馆 4 楼',
      toPlace: '图书馆 4 楼',
      deadline: at(-120),
      status: 'cancelled',
      acceptedAt: null,
      deliveredAt: null,
      settledAt: null,
    },
  ]

  return rows.map((row, index) => ({
    ...row,
    createdAt: iso(now, -(180 - index * 15)),
    updatedAt: iso(now, -(120 - index * 15)),
  }))
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockErrandRepository(
  options: MockErrandRepositoryOptions,
): MockErrandTaskRepository {
  const { cache, viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): ErrandTask[] {
    const stored = cache.read<unknown>(STORAGE_KEY)
    // 空数组是**合法状态**（用户把演示数据清空了），必须与「从未初始化」区分开，
    // 否则 clearAll() 之后第一次读取就会把种子数据又塞回来。
    if (Array.isArray(stored)) return stored as ErrandTask[]
    const seeded = options.seed !== undefined ? [...options.seed] : defaultSeed(now())
    if (seeded.length > 0) cache.write(STORAGE_KEY, seeded)
    return seeded
  }

  function save(tasks: ErrandTask[]): void {
    cache.write(STORAGE_KEY, tasks)
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

  function find(tasks: ErrandTask[], id: string): ErrandTask | null {
    return tasks.find((task) => task.id === id) ?? null
  }

  /** 取任务：不存在时统一 NOT_FOUND（与服务端 `detail()` 一致） */
  function require(tasks: ErrandTask[], id: string): Result<ErrandTask, RepositoryError> {
    const found = find(tasks, id)
    if (found === null) return err({ code: 'NOT_FOUND', message: '跑腿任务不存在或已被删除' })
    return ok(found)
  }

  function replace(tasks: ErrandTask[], next: ErrandTask): void {
    save(tasks.map((task) => (task.id === next.id ? next : task)))
  }

  return {
    kind: 'mock',

    list(query: ListErrandTasksQuery): Promise<Result<Page<ErrandTask>, RepositoryError>> {
      return guard(() => {
        const filters: ErrandTaskFilters = query.filters
        const viewer = viewerId()

        // `mine=1` / `role=runner` 需要登录（后端 controller 会抛 401）
        if (filters.scope === 'requester' || filters.scope === 'runner') {
          if (viewer === null) {
            return err({ code: 'UNAUTHENTICATED', message: '查看「我的跑腿」需要先登录' })
          }
        }

        let tasks = load()
        if (filters.status !== undefined) {
          tasks = tasks.filter((task) => task.status === filters.status)
        }
        if (filters.scope === 'requester' && viewer !== null) {
          tasks = tasks.filter((task) => task.requesterId === viewer)
        }
        if (filters.scope === 'runner' && viewer !== null) {
          tasks = tasks.filter((task) => task.runnerId === viewer)
        }
        if (filters.fromPlace !== undefined) {
          tasks = tasks.filter((task) => task.fromPlace === filters.fromPlace)
        }
        if (filters.toPlace !== undefined) {
          tasks = tasks.filter((task) => task.toPlace === filters.toPlace)
        }
        if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
          const keyword = filters.keyword.trim().toLowerCase()
          tasks = tasks.filter(
            (task) =>
              task.title.toLowerCase().includes(keyword) ||
              (task.detail ?? '').toLowerCase().includes(keyword),
          )
        }

        const sort = isErrandSort(filters.sort) ? filters.sort : 'latest'
        const sorted = [...tasks].sort((a, b) => {
          if (sort === 'reward-desc') {
            return b.rewardFen - a.rewardFen || b.id.localeCompare(a.id)
          }
          if (sort === 'deadline') {
            return a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id)
          }
          return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, sorted.findIndex((task) => task.id === query.cursor) + 1)
        const visible = sorted.slice(start, start + limit)
        const hasMore = start + limit < sorted.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
          total: sorted.length,
        })
      })
    },

    detail(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => require(load(), id))
    },

    create(input: CreateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布跑腿任务' })
        }

        const checked = validateDraft(input, now())
        if (!checked.ok) return checked

        const timestamp = now().toISOString()
        const task: ErrandTask = {
          id: `errand-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          requesterId: viewer,
          runnerId: null,
          title: checked.value.title,
          detail: checked.value.detail,
          rewardFen: checked.value.rewardFen,
          fromPlace: checked.value.fromPlace,
          toPlace: checked.value.toPlace,
          deadline: checked.value.deadline,
          status: 'open',
          acceptedAt: null,
          deliveredAt: null,
          settledAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([task, ...load()])
        return ok(task)
      })
    },

    update(id: string, input: UpdateErrandTaskInput): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found

        const actorId = viewerId()
        if (actorId === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        }
        if (found.value.requesterId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只能修改自己发布的跑腿任务' })
        }
        if (found.value.status === 'completed' || found.value.status === 'cancelled') {
          return err({ code: 'CONFLICT', message: '已完成的跑腿任务不能再修改' })
        }

        const next: ErrandTask = { ...found.value }
        if (input.title !== undefined) {
          const title = normalizeTitle(input.title)
          if (!title.ok) return title
          next.title = title.value
        }
        if (input.detail !== undefined) {
          const detail = normalizeText(input.detail, 2000, '任务明细')
          if (!detail.ok) return detail
          next.detail = detail.value
        }
        if (input.rewardFen !== undefined) {
          const reward = normalizeReward(input.rewardFen)
          if (!reward.ok) return reward
          next.rewardFen = reward.value
        }
        if (input.fromPlace !== undefined) {
          const fromPlace = normalizePlace(input.fromPlace, '出发地')
          if (!fromPlace.ok) return fromPlace
          next.fromPlace = fromPlace.value
        }
        if (input.toPlace !== undefined) {
          const toPlace = normalizePlace(input.toPlace, '目的地')
          if (!toPlace.ok) return toPlace
          next.toPlace = toPlace.value
        }
        if (input.deadline !== undefined) {
          const deadline = normalizeDeadline(input.deadline, now())
          if (!deadline.ok) return deadline
          next.deadline = deadline.value
        }
        next.updatedAt = now().toISOString()

        replace(tasks, next)
        return ok(next)
      })
    },

    remove(id: string): Promise<Result<{ id: string }, RepositoryError>> {
      return guard(() => {
        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found

        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        if (found.value.requesterId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只能删除自己发布的跑腿任务' })
        }
        if (found.value.status === 'completed' || found.value.status === 'cancelled') {
          return err({ code: 'CONFLICT', message: '已完成的跑腿任务不能再修改' })
        }

        save(tasks.filter((task) => task.id !== id))
        return ok({ id })
      })
    },

    accept(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const actorId = viewerId()
        if (actorId === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再接单' })
        }

        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found
        const task = found.value

        if (task.requesterId === actorId) {
          return err({ code: 'VALIDATION_FAILED', message: '不能接自己发布的跑腿任务' })
        }
        if (task.status !== 'open') {
          if (task.runnerId === actorId) {
            return err({ code: 'CONFLICT', message: '你已经接过这一单了' })
          }
          return err({ code: 'CONFLICT', message: '该任务已被接单或已结束' })
        }

        const next: ErrandTask = {
          ...task,
          status: 'accepted',
          runnerId: actorId,
          acceptedAt: now().toISOString(),
          updatedAt: now().toISOString(),
        }
        replace(tasks, next)
        return ok(next)
      })
    },

    deliver(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })

        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found
        const task = found.value

        if (task.runnerId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只有接单者可以确认送达' })
        }
        if (task.status !== 'accepted') {
          return err({ code: 'CONFLICT', message: '只有「已接单」的任务可以确认送达' })
        }

        const next: ErrandTask = {
          ...task,
          status: 'delivered',
          deliveredAt: now().toISOString(),
          updatedAt: now().toISOString(),
        }
        replace(tasks, next)
        return ok(next)
      })
    },

    complete(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found
        const task = found.value

        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        if (task.requesterId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只有发布者可以确认完成' })
        }
        if (task.status !== 'delivered') {
          return err({ code: 'CONFLICT', message: '只有「已送达」的任务可以确认完成' })
        }

        const next: ErrandTask = {
          ...task,
          status: 'completed',
          settledAt: now().toISOString(),
          updatedAt: now().toISOString(),
        }
        replace(tasks, next)
        return ok(next)
      })
    },

    cancel(id: string): Promise<Result<ErrandTask, RepositoryError>> {
      return guard(() => {
        const tasks = load()
        const found = require(tasks, id)
        if (!found.ok) return found
        const task = found.value

        const actorId = viewerId()
        if (actorId === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
        if (task.requesterId !== actorId) {
          return err({ code: 'FORBIDDEN', message: '只有发布者可以取消任务' })
        }
        if (task.status !== 'open' && task.status !== 'accepted') {
          return err({ code: 'CONFLICT', message: '该任务当前状态不可取消' })
        }

        const next: ErrandTask = {
          ...task,
          status: 'cancelled',
          updatedAt: now().toISOString(),
        }
        replace(tasks, next)
        return ok(next)
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
      save([])
    },
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验 —— 与服务端 errand.service.ts 的纯函数一一对应
 * ------------------------------------------------------------------ */

interface NormalizedDraft {
  title: string
  detail: string | null
  rewardFen: number
  fromPlace: string
  toPlace: string
  deadline: string
}

function validateDraft(
  input: CreateErrandTaskInput,
  now: Date,
): Result<NormalizedDraft, RepositoryError> {
  const title = normalizeTitle(input.title)
  if (!title.ok) return title
  const detail = normalizeText(input.detail, 2000, '任务明细')
  if (!detail.ok) return detail
  const reward = normalizeReward(input.rewardFen)
  if (!reward.ok) return reward
  const fromPlace = normalizePlace(input.fromPlace, '出发地')
  if (!fromPlace.ok) return fromPlace
  const toPlace = normalizePlace(input.toPlace, '目的地')
  if (!toPlace.ok) return toPlace
  const deadline = normalizeDeadline(input.deadline, now)
  if (!deadline.ok) return deadline

  return ok({
    title: title.value,
    detail: detail.value,
    rewardFen: reward.value,
    fromPlace: fromPlace.value,
    toPlace: toPlace.value,
    deadline: deadline.value,
  })
}

function validationError(message: string): RepositoryError {
  return { code: 'VALIDATION_FAILED', message }
}

function normalizeTitle(value: unknown): Result<string, RepositoryError> {
  const title = typeof value === 'string' ? value.trim() : ''
  if (title.length === 0) return err(validationError('请填写任务标题'))
  if ([...title].length > 60) return err(validationError('标题最多 60 个字'))
  return ok(title)
}

function normalizePlace(value: unknown, label: string): Result<string, RepositoryError> {
  const place = typeof value === 'string' ? value.trim() : ''
  if (place.length === 0) return err(validationError(`请填写${label}`))
  if ([...place].length > 60) return err(validationError(`${label}最多 60 个字`))
  return ok(place)
}

function normalizeReward(value: unknown): Result<number, RepositoryError> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return err(validationError('悬赏必须是以「分」为单位的整数'))
  }
  if (value < 0) return err(validationError('悬赏不能为负数'))
  if (value > ERRAND_MAX_REWARD_FEN) return err(validationError('悬赏超出上限（1000 元）'))
  return ok(value)
}

function normalizeDeadline(value: unknown, now: Date): Result<string, RepositoryError> {
  const deadline = value instanceof Date ? value : new Date(value as string)
  if (Number.isNaN(deadline.getTime())) return err(validationError('截止时间格式不正确'))
  if (deadline.getTime() <= now.getTime()) {
    return err(validationError('截止时间必须晚于当前时间'))
  }
  return ok(deadline.toISOString())
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
