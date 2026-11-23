import { err, ok, type Result } from '@kedaya/shared'

import {
  clampEvidence,
  defaultReminderPlan,
  type ActivityItem,
  type ActivityReminderItem,
  type ActivityReminderWithActivity,
  type ManualActivityDraft,
} from '../../domain/models/activity'
import type { MailEventItem } from '../../domain/models/mailActivity'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ActivityPage,
  ActivityPatch,
  ActivityRepository,
  CreateActivityReminderInput,
  DispatchRemindersResult,
  ListActivitiesQuery,
} from '../../domain/ports/activityRepository'

/**
 * Mock 活动仓储 —— 离线开发 / 演示用。
 *
 * 它不是「返回固定 JSON」的假实现：确认、忽略、建提醒、删提醒、
 * 邮件提升都会**真的改内存状态**，于是页面能走完
 * 「候选 → 确认 → 看到提醒 → 删提醒」整条链路。
 *
 * 演示数据的时间都相对注入的 `now` 计算：今天 / 本周 / 下周各一条，
 * 保证四个 tab 打开都有内容，而不是把日期写死（过几天就全变成过期）。
 */

export interface MockActivityRepository extends ActivityRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 只读：当前内存快照（测试断言用，页面不要用） */
  snapshot(): { items: ActivityItem[]; reminders: ActivityReminderItem[] }
}

export interface MockActivityRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  /** 邮件事件来源（与 mock 邮箱共享，保证「提升」能真的找到事件） */
  mailEvents?: () => readonly MailEventItem[]
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function shanghaiParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const year = Number(pick('year'))
  const month = Number(pick('month'))
  const day = Number(pick('day'))
  const weekdayLabel = pick('weekday')
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayLabel)
  return { year, month, day, weekday: weekday < 0 ? 0 : weekday }
}

/** 上海本地某天 `hour:00` 的 UTC ISO */
function shanghaiAt(base: Date, dayOffset: number, hour: number): string {
  const parts = shanghaiParts(base)
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset))
  const y = local.getUTCFullYear()
  const m = pad2(local.getUTCMonth() + 1)
  const d = pad2(local.getUTCDate())
  return new Date(`${y}-${m}-${d}T${pad2(hour)}:00:00+08:00`).toISOString()
}

function seedItems(now: Date): ActivityItem[] {
  const parts = shanghaiParts(now)
  // 本周内再挑一天：周日=周五、周一=周二、其余=次日
  const withinWeekOffset = parts.weekday === 0 ? -2 : parts.weekday === 1 ? 1 : 1
  const base = {
    endsAt: null,
    location: null,
    organizer: null,
    registrationDeadlineAt: null,
    registrationDeadlineRaw: null,
    registrationUrl: null,
    sourceUrl: null,
    stale: false,
  } as const

  return [
    {
      ...base,
      id: 'mock-act-today',
      source: 'campus-mail',
      kind: 'lecture',
      title: '信息学院开放讲座：分布式系统',
      startsAt: shanghaiAt(now, 0, 19),
      endsAt: null,
      location: '信息学院 1A-200',
      organizer: '信息科学与技术学院',
      registrationDeadlineAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
      evidenceText: '今晚 19:00 在 1A-200 举办分布式系统开放讲座，欢迎参加。',
      confidence: 0.91,
      status: 'confirmed',
      sourceLabel: '校园邮箱',
      publishedAt: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
    },
    {
      ...base,
      id: 'mock-act-week',
      source: 'wechat-mp',
      kind: 'club',
      title: '社团招新市集',
      startsAt: shanghaiAt(now, withinWeekOffset, 15),
      endsAt: null,
      location: '图书馆前广场',
      organizer: '学生社团联合会',
      evidenceText: '本周社团招新市集在图书馆前广场，现场可报名。',
      confidence: 0.76,
      status: 'confirmed',
      sourceLabel: '公众号',
      sourceUrl: 'https://mp.weixin.qq.com/s/demo-club-fair',
      publishedAt: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
    },
    {
      ...base,
      id: 'mock-act-candidate',
      source: 'campus-mail',
      kind: 'info-session',
      title: '暑期科研实习宣讲会',
      startsAt: shanghaiAt(now, 1, 18),
      endsAt: null,
      location: '会议中心 302',
      organizer: '学生事务处',
      registrationDeadlineAt: shanghaiAt(now, 1, 17),
      evidenceText: '明天 18:00 会议中心 302 暑期科研实习宣讲，请提前报名。',
      confidence: 0.83,
      status: 'candidate',
      sourceLabel: '校园邮箱',
      publishedAt: new Date(now.getTime() - 4 * 3_600_000).toISOString(),
    },
    {
      ...base,
      id: 'mock-act-candidate-raw',
      source: 'wechat-mp',
      kind: 'other',
      title: '校园摄影展征稿',
      startsAt: null,
      location: '艺术中心',
      organizer: '摄影社',
      registrationDeadlineRaw: '11月30日 截稿',
      evidenceText: '校园摄影展开始征稿，11月30日截稿，详情见原文。',
      confidence: 0.52,
      status: 'candidate',
      sourceLabel: '公众号',
      sourceUrl: 'https://mp.weixin.qq.com/s/demo-photo',
      publishedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    },
    {
      ...base,
      id: 'mock-act-archived',
      source: 'manual',
      kind: 'meeting',
      title: '新生班会',
      startsAt: shanghaiAt(now, -3, 16),
      location: '教学楼 3-101',
      organizer: '班级委员会',
      evidenceText: '新生班会已于本周三下午召开。',
      confidence: 1,
      status: 'archived',
      sourceLabel: '手动添加',
      publishedAt: shanghaiAt(now, -5, 12),
    },
  ]
}

export function createMockActivityRepository(
  options: MockActivityRepositoryOptions = {},
): MockActivityRepository {
  const now = options.now ?? (() => new Date())
  let latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0
  let items: ActivityItem[] = seedItems(now())
  let reminders: ActivityReminderItem[] = []
  const ownerByReminder = new Map<string, string>()
  let sequence = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）活动服务暂不可用' })
    }
    return work()
  }

  function find(id: string): ActivityItem | undefined {
    return items.find((item) => item.id === id)
  }

  function nextReminderId(): string {
    sequence += 1
    return `mock-rem-${sequence}`
  }

  function ensureDefaultReminders(item: ActivityItem): void {
    const existingKinds = new Set(
      reminders
        .filter((reminder) => ownerByReminder.get(reminder.id) === item.id)
        .filter((reminder) => reminder.status !== 'cancelled')
        .map((reminder) => reminder.kind),
    )
    const plan = defaultReminderPlan(item, now())
    for (const planned of plan.reminders) {
      if (existingKinds.has(planned.kind)) continue
      const reminder: ActivityReminderItem = {
        id: nextReminderId(),
        kind: planned.kind,
        remindAt: planned.remindAt,
        channel: 'inapp',
        status: 'pending',
      }
      reminders = [...reminders, reminder]
      ownerByReminder.set(reminder.id, item.id)
    }
  }

  return {
    kind: 'mock',

    list(_query: ListActivitiesQuery = {}): Promise<Result<ActivityPage, RepositoryError>> {
      return guard(() => ok({ items: [...items], nextCursor: null, total: items.length }))
    },

    detail(id: string): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const item = find(id)
        return item === undefined
          ? err({ code: 'NOT_FOUND', message: '这条活动不存在或已被删除' })
          : ok(item)
      })
    },

    create(input: ManualActivityDraft): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const item: ActivityItem = {
          id: `mock-act-manual-${items.length + 1}`,
          source: 'manual',
          kind: input.kind,
          title: input.title.trim(),
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          location: input.location?.trim() || null,
          organizer: input.organizer?.trim() || null,
          registrationDeadlineAt: input.registrationDeadlineAt ?? null,
          registrationDeadlineRaw: input.registrationDeadlineRaw?.trim() || null,
          registrationUrl: input.registrationUrl ?? null,
          evidenceText: clampEvidence(input.evidenceText ?? ''),
          confidence: 1,
          status: 'candidate',
          sourceUrl: null,
          sourceLabel: '手动添加',
          publishedAt: now().toISOString(),
          stale: false,
        }
        items = [item, ...items]
        return ok(item)
      })
    },

    update(id: string, patch: ActivityPatch): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const index = items.findIndex((item) => item.id === id)
        if (index < 0) return err({ code: 'NOT_FOUND', message: '这条活动不存在或已被删除' })
        const next: ActivityItem = { ...items[index]!, ...patch }
        items = [...items.slice(0, index), next, ...items.slice(index + 1)]
        return ok(next)
      })
    },

    confirm(id: string): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const item = find(id)
        if (item === undefined) return err({ code: 'NOT_FOUND', message: '这条活动不存在或已被删除' })
        if (item.status !== 'candidate' && item.status !== 'confirmed') {
          return err({ code: 'CONFLICT', message: '只有待确认的活动才能加入日程' })
        }
        const next: ActivityItem = { ...item, status: 'confirmed' }
        items = items.map((entry) => (entry.id === id ? next : entry))
        ensureDefaultReminders(next)
        return ok(next)
      })
    },

    dismiss(id: string): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const item = find(id)
        if (item === undefined) return err({ code: 'NOT_FOUND', message: '这条活动不存在或已被删除' })
        if (item.status !== 'candidate' && item.status !== 'confirmed') {
          return err({ code: 'CONFLICT', message: '只有待确认或已确认的活动才能忽略' })
        }
        const next: ActivityItem = { ...item, status: 'dismissed' }
        items = items.map((entry) => (entry.id === id ? next : entry))
        reminders = reminders.filter(
          (reminder) => !(ownerByReminder.get(reminder.id) === id && reminder.status === 'pending'),
        )
        return ok(next)
      })
    },

    importWechat(input): Promise<Result<ActivityItem, RepositoryError>> {
      return guard(() => {
        const link = input.link?.trim() ?? ''
        const text = input.text?.trim() ?? ''
        const item: ActivityItem = {
          id: `mock-act-wechat-${items.length + 1}`,
          source: 'wechat-mp',
          kind: 'other',
          title: text === '' ? '公众号文章（待确认）' : Array.from(text).slice(0, 24).join(''),
          startsAt: null,
          endsAt: null,
          location: null,
          organizer: null,
          registrationDeadlineAt: null,
          registrationDeadlineRaw: null,
          registrationUrl: null,
          evidenceText: clampEvidence(text === '' ? link : text),
          confidence: 0.4,
          status: 'candidate',
          sourceUrl: link === '' ? null : link,
          sourceLabel: '公众号',
          publishedAt: now().toISOString(),
          stale: false,
        }
        items = [item, ...items]
        return ok(item)
      })
    },

    importMail(eventId: string): Promise<Result<ActivityItem[], RepositoryError>> {
      return guard(() => {
        const event = options.mailEvents?.().find((entry) => entry.id === eventId)
        if (event === undefined) {
          return err({ code: 'NOT_FOUND', message: '这封邮件事件不存在或已被清理' })
        }
        const item: ActivityItem = {
          id: `mock-act-mail-${items.length + 1}`,
          source: 'campus-mail',
          kind: 'lecture',
          title: event.title,
          startsAt: event.startsAt,
          endsAt: null,
          location: event.location,
          organizer: event.organizer,
          registrationDeadlineAt: null,
          registrationDeadlineRaw: null,
          registrationUrl: null,
          evidenceText: clampEvidence(event.matchedText),
          confidence: event.confidence,
          status: 'candidate',
          sourceUrl: null,
          sourceLabel: '校园邮箱',
          publishedAt: event.receivedAt,
          stale: event.stale,
        }
        items = [item, ...items]
        return ok([item])
      })
    },

    listRemindersFor(activityId: string): Promise<Result<ActivityReminderItem[], RepositoryError>> {
      return guard(() =>
        ok(reminders.filter((entry) => ownerByReminder.get(entry.id) === activityId)),
      )
    },

    listReminders(): Promise<Result<ActivityReminderWithActivity[], RepositoryError>> {
      return guard(() =>
        ok(
          reminders.map((reminder) => {
            const owner = reminderOwner(reminder.id)
            const item = owner === null ? undefined : find(owner)
            return {
              ...reminder,
              activityId: owner ?? '',
              activityTitle: item?.title ?? '已删除的活动',
            }
          }),
        ),
      )
    },

    createReminder(
      activityId: string,
      input: CreateActivityReminderInput,
    ): Promise<Result<ActivityReminderItem, RepositoryError>> {
      return guard(() => {
        const activity = find(activityId)
        if (activity === undefined) {
          return err({ code: 'NOT_FOUND', message: '这条活动不存在或已被删除' })
        }
        if (activity.status !== 'confirmed') {
          return err({ code: 'CONFLICT', message: '请先确认活动，再添加提醒' })
        }
        if (input.channel !== 'inapp') {
          return err({ code: 'VALIDATION_FAILED', message: '微信订阅消息尚未接通，提醒目前只发站内信' })
        }
        const reminder: ActivityReminderItem = {
          id: nextReminderId(),
          kind: input.kind,
          remindAt: input.remindAt,
          channel: input.channel,
          status: 'pending',
        }
        reminders = [...reminders, reminder]
        ownerByReminder.set(reminder.id, activityId)
        return ok(reminder)
      })
    },

    deleteReminder(id: string): Promise<Result<true, RepositoryError>> {
      return guard(() => {
        reminders = reminders.filter((entry) => entry.id !== id)
        ownerByReminder.delete(id)
        return ok(true)
      })
    },

    dispatchReminders(): Promise<Result<DispatchRemindersResult, RepositoryError>> {
      return guard(() => {
        let dispatched = 0
        reminders = reminders.map((reminder) => {
          if (reminder.status !== 'pending') return reminder
          dispatched += 1
          return { ...reminder, status: 'sent' }
        })
        return ok({ dispatched })
      })
    },

    reset(): void {
      items = seedItems(now())
      reminders = []
      ownerByReminder.clear()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, times)
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    snapshot() {
      return { items: [...items], reminders: [...reminders] }
    },
  }

  function reminderOwner(id: string): string | null {
    return ownerByReminder.get(id) ?? null
  }
}
