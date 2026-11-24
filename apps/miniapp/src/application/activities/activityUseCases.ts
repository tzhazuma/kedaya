import { err, ok, type Result } from '@kedaya/shared'

import {
  ACTIVITY_KINDS,
  ACTIVITY_TITLE_MAX,
  REMINDER_KINDS,
  clampEvidence,
  defaultReminderPlan,
  manualActivityProblem,
  normalizeActivityInstant,
  normalizeActivityItem,
  normalizeActivityUrl,
  summarizeActivity,
  wechatImportProblem,
  type ActivityItem,
  type ActivityReminderChannel,
  type ActivityReminderItem,
  type ActivityReminderKind,
  type ActivityReminderWithActivity,
  type ActivityView,
  type ManualActivityDraft,
} from '../../domain/models/activity'
import type { WechatHistoryPage } from '../../domain/models/wechatHistory'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ActivityPage,
  ActivityPatch,
  ActivityRepository,
  DispatchRemindersResult,
} from '../../domain/ports/activityRepository'
import { createIdempotencyKey } from '../idempotency'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'

/**
 * 活动用例（`/activities`）。
 *
 * 列表机制（缓存 → 后台刷新 → 失败静默降级 → 游标续页）复用
 * `application/common/listUseCase`；本文件只负责活动特有的规则：
 *
 *   1. **候选必须确认**：`confirm()` 先等服务端返回 `confirmed`。默认提醒
 *      由**服务端**在 confirm 时创建（报名前 24h / 开始前 1h），客户端只读取，
 *      不重复创建 —— 否则同一条活动会有两条一模一样的提醒。
 *   2. **只建站内信**：没有真实模板 ID 时拒绝 `wechat-subscribe`，
 *      不调用任何虚假的订阅推送。
 *   3. **提醒读取失败不推翻确认**：活动已经进日程，提示「提醒读取失败」即可。
 */

/**
 * 首屏一次取全：契约的 `limit` 上限是 100，最多翻 10 页。
 *
 * tab / 来源筛选在客户端完成（计数也要跨 tab），只拿第一页会让第二页的
 * 匹配项变成「假空态」。这里把游标一次走完，并把 `nextCursor` 归零 ——
 * 切 tab / 换来源不需要重新分页，也不会漏掉任何一页。
 */
const PAGE_SIZE = 100
const MAX_PAGES = 10
const CACHE_KEY = 'kdy.activities.list'

export interface ActivityListQuery extends Record<string, unknown> {
  /** 预留：当前列表一次取全部，tab / 来源在客户端即时筛选 */
  readonly scope: 'all'
}

/**
 * 活动列表只依赖会话里的 `profile.id`。
 *
 * 用最小结构而不是整个 `SessionStorePort`：application 不关心 token / 资料字段，
 * 只需要「当前是谁」与「登录态变了通知我」。
 */
export interface ActivityViewerSession {
  getSnapshot(): { profile: { id: string } | null }
  subscribe(listener: () => void): () => void
}

export interface ConfirmActivityResult {
  item: ActivityItem
  reminders: ActivityReminderItem[]
  /** 提醒读取失败时的可读提示；全部成功为 null */
  reminderWarning: string | null
}

export interface CreateActivityReminderOptions {
  kind: ActivityReminderKind
  /** 不传时按 kind 从活动时间推算（custom 必须传） */
  remindAt?: string | null
  /** 默认站内信；微信订阅消息尚未接通 */
  channel?: ActivityReminderChannel
}

export interface ActivityUseCases {
  readonly list: ListUseCase<ActivityListQuery, ActivityView>
  readonly detail: DetailUseCase<ActivityItem>
  confirm(id: string): Promise<Result<ConfirmActivityResult, RepositoryError>>
  dismiss(id: string): Promise<Result<ActivityItem, RepositoryError>>
  createManual(draft: ManualActivityDraft): Promise<Result<ActivityItem, RepositoryError>>
  update(id: string, patch: ActivityPatch): Promise<Result<ActivityItem, RepositoryError>>
  importWechat(input: { link?: string; text?: string }): Promise<Result<ActivityItem, RepositoryError>>
  /**
   * 解析用户保存的公众号历史消息页，返回候选文章列表。
   *
   * **不写入任何活动**：用户还要在页面上勾选，再逐篇 `importWechat`。
   */
  parseWechatHistory(savedPageHtml: string): Promise<Result<WechatHistoryPage, RepositoryError>>
  importMail(eventId: string): Promise<Result<ActivityItem[], RepositoryError>>
  reminders(): Promise<Result<ActivityReminderWithActivity[], RepositoryError>>
  remindersFor(activityId: string): Promise<Result<ActivityReminderItem[], RepositoryError>>
  createReminder(
    activityId: string,
    options: CreateActivityReminderOptions,
  ): Promise<Result<ActivityReminderItem, RepositoryError>>
  deleteReminder(id: string): Promise<Result<true, RepositoryError>>
  dispatchReminders(): Promise<Result<DispatchRemindersResult, RepositoryError>>
}

export interface ActivityUseCaseDeps {
  readonly repository: ActivityRepository
  readonly cache: CachePort
  readonly clock: ClockPort
  /** 缓存 key（装配层注入；测试可省略） */
  readonly cacheKey?: string
  /**
   * 按登录用户分片的缓存 key。
   *
   * 活动列表是**用户私有**的（校园邮箱 / 公众号导入都带归属）；同一台手机
   * 换号是真实场景，绝不能把上一个账号的活动留给下一个人。
   */
  readonly cacheKeyFor?: (viewerId: string | null) => string
  /** 当前登录用户；不传时从 `session` 推导 */
  readonly viewerId?: () => string | null
  /** 会话订阅：登出 / 换号时立刻清理上一个账号的缓存并重置列表 */
  readonly session?: ActivityViewerSession
}

function validation(message: string): RepositoryError {
  return { code: 'VALIDATION_FAILED', message }
}

function sanitizeManualDraft(draft: ManualActivityDraft): ManualActivityDraft {
  return {
    title: draft.title.trim(),
    kind: draft.kind,
    startsAt: normalizeActivityInstant(draft.startsAt),
    endsAt: normalizeActivityInstant(draft.endsAt),
    location: draft.location?.trim() ?? null,
    organizer: draft.organizer?.trim() ?? null,
    registrationDeadlineAt: normalizeActivityInstant(draft.registrationDeadlineAt),
    registrationDeadlineRaw: draft.registrationDeadlineRaw?.trim() ?? null,
    registrationUrl: normalizeActivityUrl(draft.registrationUrl),
    evidenceText: clampEvidence(draft.evidenceText ?? ''),
  }
}

function sanitizePatch(patch: ActivityPatch): Result<ActivityPatch, RepositoryError> {
  const next: ActivityPatch = {}

  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (title === '' || Array.from(title).length > ACTIVITY_TITLE_MAX) {
      return err(validation(`标题 1–${ACTIVITY_TITLE_MAX} 字`))
    }
    next.title = title
  }
  if (patch.kind !== undefined) {
    if (!ACTIVITY_KINDS.includes(patch.kind)) return err(validation('活动类型不合法'))
    next.kind = patch.kind
  }
  for (const key of ['startsAt', 'endsAt', 'registrationDeadlineAt'] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) {
      next[key] = null
      continue
    }
    const normalized = normalizeActivityInstant(value)
    if (normalized === null) return err(validation('时间格式不正确'))
    next[key] = normalized
  }
  if (patch.registrationDeadlineRaw !== undefined) {
    next.registrationDeadlineRaw =
      patch.registrationDeadlineRaw === null
        ? null
        : Array.from(patch.registrationDeadlineRaw.trim()).slice(0, 200).join('') || null
  }
  if (patch.registrationUrl !== undefined) {
    if (patch.registrationUrl === null || patch.registrationUrl.trim() === '') {
      next.registrationUrl = null
    } else {
      const normalized = normalizeActivityUrl(patch.registrationUrl)
      if (normalized === null) return err(validation('报名链接必须是 http(s) 地址'))
      next.registrationUrl = normalized
    }
  }
  if (patch.evidenceText !== undefined) next.evidenceText = clampEvidence(patch.evidenceText)
  if (patch.location !== undefined) next.location = patch.location?.trim() || null
  if (patch.organizer !== undefined) next.organizer = patch.organizer?.trim() || null

  return ok(next)
}

export function createActivityUseCases(deps: ActivityUseCaseDeps): ActivityUseCases {
  const { repository, cache, clock } = deps

  const tracksViewer =
    deps.viewerId !== undefined || deps.session !== undefined || deps.cacheKeyFor !== undefined
  const baseCacheKey = deps.cacheKey ?? CACHE_KEY
  const readViewer = deps.viewerId ?? (() => deps.session?.getSnapshot().profile?.id ?? null)
  const cacheKeyFor =
    deps.cacheKeyFor ??
    ((viewerId: string | null) =>
      tracksViewer ? `${baseCacheKey}:${viewerId ?? 'anonymous'}` : baseCacheKey)

  async function fetchAllPages(): Promise<Result<ActivityPage, RepositoryError>> {
    const collected: ActivityItem[] = []
    const seen = new Set<string>()
    let cursor: string | null = null
    let total: number | undefined

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await repository.list({ cursor, limit: PAGE_SIZE })
      if (!result.ok) return result

      for (const item of result.value.items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        collected.push(item)
      }
      total = result.value.total ?? total
      cursor = result.value.nextCursor
      if (cursor === null) break
    }

    return ok({
      items: collected,
      nextCursor: null,
      ...(total === undefined ? {} : { total }),
    })
  }

  function buildList(viewerId: string | null): ListUseCase<ActivityListQuery, ActivityView> {
    return createListUseCase<ActivityListQuery, ActivityItem, ActivityView>({
      cache,
      clock,
      cacheKey: cacheKeyFor(viewerId),
      defaultQuery: { scope: 'all' },
      async fetchPage(_query, cursor) {
        // 首屏取全；`loadMore` 只在旧缓存带游标时才会走到单页分支。
        if (cursor !== null) {
          const result = await repository.list({ cursor, limit: PAGE_SIZE })
          if (!result.ok) return result
          return {
            ok: true,
            value: {
              items: result.value.items,
              nextCursor: result.value.nextCursor,
              ...(result.value.total === undefined ? {} : { total: result.value.total }),
            },
          }
        }
        return fetchAllPages()
      },
      mapItem: summarizeActivity,
      isCachedPage: createCachedPageGuard<ActivityItem>(
        (value): value is ActivityItem => normalizeActivityItem(value) !== null,
      ),
    })
  }

  let activeViewer = tracksViewer ? readViewer() : null
  let inner = buildList(activeViewer)
  const listListeners = new Set<() => void>()

  function notifyListListeners(): void {
    for (const listener of listListeners) listener()
  }

  let detachInner = inner.subscribe(notifyListListeners)

  function rebuild(viewerId: string | null): void {
    detachInner()
    inner = buildList(viewerId)
    detachInner = inner.subscribe(notifyListListeners)
  }

  /** 登录态变化：先删上一个账号的缓存，再换一份全新的列表实例 */
  function syncViewer(): boolean {
    if (!tracksViewer) return false
    const next = readViewer()
    if (next === activeViewer) return false

    const previous = activeViewer
    activeViewer = next
    if (previous !== null) cache.remove(cacheKeyFor(previous))
    rebuild(next)
    notifyListListeners()
    return true
  }

  if (tracksViewer && deps.session !== undefined) {
    deps.session.subscribe(() => {
      syncViewer()
    })
  }

  const list: ListUseCase<ActivityListQuery, ActivityView> = {
    getSnapshot: () => inner.getSnapshot(),
    subscribe(listener: () => void): () => void {
      listListeners.add(listener)
      return () => {
        listListeners.delete(listener)
      }
    },
    hydrate() {
      syncViewer()
      // 未登录不 hydrate：本地匿名缓存可能来自上一个会话，读出来就是泄露。
      if (tracksViewer && activeViewer === null) return inner.getSnapshot()
      return inner.hydrate()
    },
    load(partial?: Partial<ActivityListQuery>) {
      syncViewer()
      if (tracksViewer && activeViewer === null) return Promise.resolve(inner.getSnapshot())
      return inner.load(partial)
    },
    loadMore(partial?: Partial<ActivityListQuery>) {
      syncViewer()
      if (tracksViewer && activeViewer === null) return Promise.resolve(inner.getSnapshot())
      return inner.loadMore(partial)
    },
    setQuery: (patch) => inner.setQuery(patch),
    reset: () => inner.reset(),
  }

  const detail = createDetailUseCase<ActivityItem>((id) => repository.detail(id))

  async function confirm(id: string): Promise<Result<ConfirmActivityResult, RepositoryError>> {
    const confirmed = await repository.confirm(
      id,
      createIdempotencyKey(`activities:confirm:${id}`, clock.now()),
    )
    if (!confirmed.ok) return confirmed

    const item = confirmed.value
    // 服务端没真的确认（例如状态已被并发改掉）时不展示提醒：
    // "候选" 不能因为一次请求就变成有提醒的日程。
    if (item.status !== 'confirmed') {
      return ok({ item, reminders: [], reminderWarning: null })
    }

    // 默认提醒由服务端在 confirm 时创建（报名前 24h / 开始前 1h）。
    // 客户端只读取，**不重复创建** —— 否则同一条活动会有两条一模一样的提醒。
    const reminders = await repository.listRemindersFor(item.id)
    if (!reminders.ok) {
      return ok({
        item,
        reminders: [],
        reminderWarning: `活动已确认，但提醒读取失败：${reminders.error.message}`,
      })
    }

    return ok({ item, reminders: reminders.value, reminderWarning: null })
  }

  async function createReminder(
    activityId: string,
    options: CreateActivityReminderOptions,
  ): Promise<Result<ActivityReminderItem, RepositoryError>> {
    if (!REMINDER_KINDS.includes(options.kind)) return err(validation('提醒类型不合法'))

    const channel: ActivityReminderChannel = options.channel ?? 'inapp'
    if (channel === 'wechat-subscribe') {
      return err(
        validation('微信订阅消息尚未接通（没有真实模板 ID），当前只能使用站内信提醒'),
      )
    }
    if (channel !== 'inapp') return err(validation('不支持的提醒渠道'))

    // 默认提醒在 confirm 时由服务端创建；补设前先读一次，避免生成重复提醒。
    // 读取失败时宁可拒绝，也不要在不知道现状的情况下再建一条。
    if (options.kind !== 'custom') {
      const existing = await repository.listRemindersFor(activityId)
      if (!existing.ok) {
        return err(
          validation(`提醒读取失败，请稍后重试：${existing.error.message}`),
        )
      }
      const duplicated = existing.value.some(
        (item) => item.kind === options.kind && item.status !== 'cancelled',
      )
      if (duplicated) {
        return err(
          validation(
            options.kind === 'registration'
              ? '报名提醒已经安排过了'
              : '开始提醒已经安排过了',
          ),
        )
      }
    }

    let remindAt = normalizeActivityInstant(options.remindAt)
    if (options.remindAt != null && remindAt === null) {
      return err(validation('提醒时间格式不正确'))
    }

    if (remindAt === null) {
      if (options.kind === 'custom') return err(validation('请选择提醒时间'))

      const activity = await repository.detail(activityId)
      if (!activity.ok) return activity
      const plan = defaultReminderPlan(activity.value, clock.now())
      const planned = plan.reminders.find((item) => item.kind === options.kind)
      if (planned === undefined) {
        const skipped = plan.skipped.find((item) => item.kind === options.kind)
        if (skipped?.reason === 'target-passed') {
          return err(validation('这个时间已经过了，不需要再提醒'))
        }
        return err(
          validation(
            options.kind === 'registration'
              ? '这个活动没有确定的报名截止时间，无法设置提醒'
              : '这个活动没有确定的开始时间，无法设置提醒',
          ),
        )
      }
      remindAt = planned.remindAt
    }

    if (Date.parse(remindAt) <= clock.now().getTime()) {
      return err(validation('提醒时间必须晚于现在'))
    }

    return repository.createReminder(
      activityId,
      {
        kind: options.kind,
        remindAt,
        channel: 'inapp',
      },
      createIdempotencyKey(
        `activities:reminder:${activityId}:${options.kind}:${remindAt}`,
        clock.now(),
      ),
    )
  }

  return {
    list,
    detail,

    confirm,
    dismiss: (id) =>
      repository.dismiss(id, createIdempotencyKey(`activities:dismiss:${id}`, clock.now())),

    async createManual(draft) {
      const problem = manualActivityProblem(draft)
      if (problem !== null) return err(validation(problem))
      return repository.create(
        sanitizeManualDraft(draft),
        createIdempotencyKey('activities:create', clock.now()),
      )
    },

    async update(id, patch) {
      const sanitized = sanitizePatch(patch)
      if (!sanitized.ok) return sanitized
      return repository.update(id, sanitized.value)
    },

    async importWechat(input) {
      const problem = wechatImportProblem(input)
      if (problem !== null) return err(validation(problem))
      const link = input.link?.trim()
      const text = input.text?.trim()
      return repository.importWechat(
        {
          ...(link === undefined || link === '' ? {} : { link }),
          ...(text === undefined || text === '' ? {} : { text }),
        },
        createIdempotencyKey('activities:import:wechat', clock.now()),
      )
    },

    async parseWechatHistory(savedPageHtml) {
      const html = savedPageHtml.trim()
      if (html === '') {
        return err(validation('先把公众号「查看历史消息」页的内容粘贴进来'))
      }
      return repository.parseWechatHistory(html)
    },

    async importMail(eventId) {      const trimmed = eventId.trim()
      if (trimmed === '') return err(validation('缺少邮件事件 id'))
      return repository.importMail(
        trimmed,
        createIdempotencyKey(`activities:import:mail:${trimmed}`, clock.now()),
      )
    },

    reminders: () => repository.listReminders(),
    remindersFor: (activityId) => repository.listRemindersFor(activityId),
    createReminder,
    deleteReminder: (id) =>
      repository.deleteReminder(id, createIdempotencyKey(`activities:reminder:delete:${id}`, clock.now())),
    dispatchReminders: () => repository.dispatchReminders(),
  }
}
