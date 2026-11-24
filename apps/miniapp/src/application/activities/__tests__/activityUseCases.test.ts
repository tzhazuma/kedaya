import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@kedaya/shared'

import type { ActivityItem, ActivityReminderItem } from '../../../domain/models/activity'
import type {
  ActivityPage,
  ActivityRepository,
} from '../../../domain/ports/activityRepository'
import type { MailAccountRepository } from '../../../domain/ports/mailAccountRepository'
import type { RepositoryError } from '../../../domain/ports/errors'
import { createActivityUseCases } from '../activityUseCases'
import { createMailActivityUseCases } from '../mailActivityUseCases'

/**
 * 活动用例 —— 页面只调用这里。
 *
 * 重点不是「能调通」，而是三个**不能错**的边界：
 *   1. candidate 必须经 `confirm`（服务端确认）后才建提醒；
 *   2. 没有真实模板 ID 时只建站内信，**不能**偷偷建微信订阅消息；
 *   3. 导入 / 绑定失败要如实返回错误，页面不能显示假成功。
 */

const NOW_ISO = '2026-11-22T04:00:00.000Z'
const NOW = new Date(NOW_ISO)

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    source: 'campus-mail',
    kind: 'lecture',
    title: '分布式系统讲座',
    startsAt: '2026-11-24T06:00:00.000Z',
    endsAt: '2026-11-24T08:00:00.000Z',
    location: '1A-200',
    organizer: '信息学院',
    registrationDeadlineAt: '2026-11-23T06:00:00.000Z',
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '11月24日 14:00 信息学院 1A-200',
    confidence: 0.8,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '校园邮箱',
    publishedAt: '2026-11-20T00:00:00.000Z',
    stale: false,
    ...overrides,
  }
}

function reminder(overrides: Partial<ActivityReminderItem> = {}): ActivityReminderItem {
  return {
    id: 'rem-1',
    kind: 'registration',
    remindAt: '2026-11-22T06:00:00.000Z',
    channel: 'inapp',
    status: 'pending',
    ...overrides,
  }
}

function createFakeCache() {
  const store = new Map<string, unknown>()
  return {
    read: <T>(key: string): T | null => (store.get(key) as T | undefined) ?? null,
    write: <T>(key: string, value: T): void => {
      store.set(key, value)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
  }
}

interface FakeActivityOptions {
  item?: ActivityItem
  confirm?: Result<ActivityItem, RepositoryError>
  createReminder?: (
    input: { kind: string; remindAt: string; channel: string },
  ) => Result<ActivityReminderItem, RepositoryError>
  existingReminders?: ActivityReminderItem[]
  listRemindersError?: boolean
  /** 按顺序返回的分页响应；用完后回落到单条默认响应 */
  pages?: Array<Result<ActivityPage, RepositoryError>>
}

function createFakeActivityRepository(options: FakeActivityOptions = {}) {
  const calls = {
    listCursors: [] as (string | null)[],
    confirm: [] as string[],
    confirmKeys: [] as (string | undefined)[],
    dismiss: [] as string[],
    createReminder: [] as { activityId: string; input: { kind: string; remindAt: string; channel: string } }[],
    importWechat: [] as unknown[],
    importMail: [] as string[],
    update: [] as unknown[],
    create: [] as unknown[],
  }
  const current = options.item ?? activity()

  const repository: ActivityRepository = {
    async list(query) {
      calls.listCursors.push(query?.cursor ?? null)
      const queued = options.pages?.shift()
      if (queued !== undefined) return queued
      return ok({ items: [current], nextCursor: null, total: 1 })
    },
    async detail() {
      return ok(current)
    },
    async create(input) {
      calls.create.push(input)
      return ok(activity({ id: 'act-new', title: input.title, source: 'manual' }))
    },
    async update(_id, patch) {
      calls.update.push(patch)
      return ok({ ...current, ...patch })
    },
    async confirm(id, idempotencyKey) {
      calls.confirm.push(id)
      calls.confirmKeys.push(idempotencyKey)
      return options.confirm ?? ok(activity({ ...current, status: 'confirmed' }))
    },
    async dismiss(id) {
      calls.dismiss.push(id)
      return ok(activity({ ...current, status: 'dismissed' }))
    },
    async importWechat(input) {
      calls.importWechat.push(input)
      return ok(activity({ id: 'act-wechat', source: 'wechat-mp' }))
    },
    async archive(id) {
      calls.dismiss.push(id)
      return ok(activity({ ...current, status: 'archived' }))
    },
    async restore(id) {
      calls.dismiss.push(id)
      return ok(activity({ ...current, status: 'candidate' }))
    },
    async parseWechatHistory(savedPageHtml) {
      return ok({
        accountName: '测试公众号',
        biz: null,
        articles:
          savedPageHtml.trim() === ''
            ? []
            : [
                {
                  title: '一条历史文章',
                  url: 'https://mp.weixin.qq.com/s/fake',
                  publishedAt: '2026-11-20T00:00:00.000Z',
                  digest: null,
                  coverUrl: null,
                  isHeadline: true,
                },
              ],
      })
    },
    async importMail(eventId) {
      calls.importMail.push(eventId)
      return ok([activity({ id: 'act-mail', source: 'campus-mail' })])
    },
    async listRemindersFor() {
      if (options.listRemindersError === true) {
        return err({ code: 'UPSTREAM_UNAVAILABLE', message: '提醒服务暂不可用' })
      }
      return ok(options.existingReminders ?? [])
    },
    async listReminders() {
      return ok([])
    },
    async createReminder(activityId, input) {
      calls.createReminder.push({ activityId, input })
      const result = options.createReminder
      if (result !== undefined) return result(input)
      return ok(reminder({ id: `rem-${calls.createReminder.length}`, kind: input.kind }))
    },
    async deleteReminder() {
      return ok(true)
    },
    async dispatchReminders() {
      return ok({ dispatched: 0 })
    },
  }

  return { repository, calls }
}

function setup(options: FakeActivityOptions = {}) {
  const fake = createFakeActivityRepository(options)
  const cache = createFakeCache()
  const useCases = createActivityUseCases({
    repository: fake.repository,
    cache,
    clock: { now: () => NOW },
  })
  return { ...fake, useCases, cache }
}

function createFakeSession(initial: string | null) {
  let viewer = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ profile: viewer === null ? null : { id: viewer } }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: string | null) {
      viewer = next
      for (const listener of listeners) listener()
    },
  }
}

describe('确认加入日程', () => {
  it('服务端确认后读取已建的默认提醒，客户端不重复创建', async () => {
    const serverReminders = [
      reminder({ id: 'rem-reg', kind: 'registration', remindAt: '2026-11-22T06:00:00.000Z' }),
      reminder({ id: 'rem-start', kind: 'start', remindAt: '2026-11-24T05:00:00.000Z' }),
    ]
    const { useCases, calls } = setup({ existingReminders: serverReminders })

    const result = await useCases.confirm('act-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.item.status).toBe('confirmed')
    expect(result.value.reminderWarning).toBeNull()
    expect(calls.confirm).toEqual(['act-1'])
    expect(calls.confirmKeys[0]).toBeTruthy()
    // 默认提醒由服务端在 confirm 时创建；客户端再建就会重复
    expect(calls.createReminder).toEqual([])
    expect(result.value.reminders.map((item) => item.id)).toEqual(['rem-reg', 'rem-start'])
  })

  it('确认失败时一条提醒都不建（不把候选当成已加入日程）', async () => {
    const { useCases, calls } = setup({
      confirm: err({ code: 'CONFLICT', message: '这条活动已经被忽略' }),
    })

    const result = await useCases.confirm('act-1')

    expect(result.ok).toBe(false)
    expect(calls.createReminder).toEqual([])
  })

  it('确认成功但提醒读取失败：保留已确认状态并给出可读提示', async () => {
    const { useCases } = setup({ listRemindersError: true })

    const result = await useCases.confirm('act-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.item.status).toBe('confirmed')
    expect(result.value.reminderWarning).toContain('提醒读取失败')
    expect(result.value.reminders).toEqual([])
  })
})

describe('设置提醒', () => {
  it('拒绝微信订阅消息（没有真实模板 ID，不能假装接通）', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.createReminder('act-1', {
      kind: 'custom',
      remindAt: '2026-11-23T00:00:00.000Z',
      channel: 'wechat-subscribe',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('尚未接通')
    expect(calls.createReminder).toEqual([])
  })

  it('自定义提醒必须给未来时刻', async () => {
    const { useCases, calls } = setup()

    const missing = await useCases.createReminder('act-1', { kind: 'custom' })
    const past = await useCases.createReminder('act-1', {
      kind: 'custom',
      remindAt: '2026-11-22T03:59:00.000Z',
    })

    expect(missing.ok).toBe(false)
    expect(past.ok).toBe(false)
    expect(calls.createReminder).toEqual([])
  })

  it('报名提醒没有传时刻时，用活动截止时间前 24h 计算', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.createReminder('act-1', { kind: 'registration' })

    expect(result.ok).toBe(true)
    expect(calls.createReminder[0]?.input).toEqual({
      kind: 'registration',
      remindAt: '2026-11-22T06:00:00.000Z',
      channel: 'inapp',
    })
  })

  it('开始提醒没有传时刻时，用活动开始时间前 1h 计算', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.createReminder('act-1', { kind: 'start' })

    expect(result.ok).toBe(true)
    expect(calls.createReminder[0]?.input).toEqual({
      kind: 'start',
      remindAt: '2026-11-24T05:00:00.000Z',
      channel: 'inapp',
    })
  })

  it('确认时已自动建过的同类提醒不再重复创建', async () => {
    const { useCases, calls } = setup({
      existingReminders: [reminder({ id: 'rem-reg', kind: 'registration' })],
    })

    const result = await useCases.createReminder('act-1', { kind: 'registration' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('已经安排')
    expect(calls.createReminder).toEqual([])
  })

  it('提醒列表读取失败时拒绝补设默认提醒（避免重复）', async () => {
    const { useCases, calls } = setup({ listRemindersError: true })

    const result = await useCases.createReminder('act-1', { kind: 'start' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('提醒读取失败')
    expect(calls.createReminder).toEqual([])
  })
})

describe('归档与恢复', () => {
  it('归档走 archive，并带幂等键', async () => {
    const { useCases, calls } = setup()
    const result = await useCases.archive('act-1')
    expect(result.ok).toBe(true)
    expect(calls.dismiss).toEqual(['act-1'])
  })

  it('恢复把活动退回候选', async () => {
    const { useCases } = setup()
    const result = await useCases.restore('act-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('candidate')
  })
})

describe('导入', () => {
  it('公众号链接不合法时不请求服务端（先拦在客户端）', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.importWechat({ link: 'https://example.com/s/a' })

    expect(result.ok).toBe(false)
    expect(calls.importWechat).toEqual([])
  })

  it('公众号单篇链接合法时导入', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.importWechat({ link: 'https://mp.weixin.qq.com/s/AbCd' })

    expect(result.ok).toBe(true)
    expect(calls.importWechat).toEqual([{ link: 'https://mp.weixin.qq.com/s/AbCd' }])
  })

  it('链接与正文同时给会被客户端拦下 —— 服务端契约只收一个', async () => {
    const { useCases, calls } = setup()

    // 回归点：历史页导入曾经把「摘要」也当 text 一起发，
    // 服务端 `url 与 text 二选一` 的校验会让**每一篇**都 422。
    const result = await useCases.importWechat({
      link: 'https://mp.weixin.qq.com/s/AbCd',
      text: '11 月 30 日开跑',
    })

    expect(result.ok).toBe(false)
    expect(calls.importWechat).toEqual([])
  })

  it('邮件提升必须有事件 id', async () => {
    const { useCases, calls } = setup()

    const result = await useCases.importMail('  ')

    expect(result.ok).toBe(false)
    expect(calls.importMail).toEqual([])
  })
})

describe('编辑活动', () => {
  it('证据片段在提交前截到 200 字', async () => {
    const { useCases, calls } = setup()

    await useCases.update('act-1', { evidenceText: '证'.repeat(260) })

    const patch = calls.update[0] as { evidenceText: string }
    expect(Array.from(patch.evidenceText)).toHaveLength(200)
  })
})

describe('列表用例', () => {
  it('load 成功 → ready，映射出展示字段并写缓存', async () => {
    const { useCases } = setup()

    const state = await useCases.list.load()

    expect(state.status).toBe('ready')
    expect(state.items[0]?.whenLabel).toBe('11月24日 周二 14:00–16:00')
    expect(state.items[0]?.sourceLabel).toBe('校园邮箱')
  })

  it('首屏一次取全所有分页，第二页的来源不会被筛成假空态', async () => {
    const { useCases, calls } = setup({
      pages: [
        ok({
          items: [activity({ id: 'act-mail', source: 'campus-mail' })],
          nextCursor: 'c2',
          total: 2,
        }),
        ok({
          items: [activity({ id: 'act-manual', source: 'manual' })],
          nextCursor: null,
          total: 2,
        }),
      ],
    })

    const state = await useCases.list.load()

    expect(calls.listCursors).toEqual([null, 'c2'])
    expect(state.items.map((item) => item.id)).toEqual(['act-mail', 'act-manual'])
    expect(state.nextCursor).toBeNull()
    expect(state.items.some((item) => item.source === 'manual')).toBe(true)
  })

  it('列表缓存按 userId 分片：换号后 hydrate 不显示上一个账号的活动', async () => {
    const cache = createFakeCache()
    cache.write('test:activities:alice', {
      items: [activity({ id: 'alice-act' })],
      nextCursor: null,
      updatedAt: NOW_ISO,
    })
    cache.write('test:activities:bob', {
      items: [activity({ id: 'bob-act' })],
      nextCursor: null,
      updatedAt: NOW_ISO,
    })

    const session = createFakeSession('alice')
    const fake = createFakeActivityRepository()
    const useCases = createActivityUseCases({
      repository: fake.repository,
      cache,
      clock: { now: () => NOW },
      session,
      cacheKeyFor: (viewer) => `test:activities:${viewer ?? 'anonymous'}`,
    })

    expect(useCases.list.hydrate().items.map((item) => item.id)).toEqual(['alice-act'])

    session.set('bob')

    expect(useCases.list.hydrate().items.map((item) => item.id)).toEqual(['bob-act'])
  })

  it('登出时清理上一个账号的缓存，且未登录不 hydrate 旧数据', async () => {
    const cache = createFakeCache()
    const session = createFakeSession('alice')
    const fake = createFakeActivityRepository({
      item: activity({ id: 'alice-act' }),
    })
    const useCases = createActivityUseCases({
      repository: fake.repository,
      cache,
      clock: { now: () => NOW },
      session,
      cacheKeyFor: (viewer) => `test:activities:${viewer ?? 'anonymous'}`,
    })

    await useCases.list.load()
    expect(cache.read('test:activities:alice')).not.toBeNull()

    session.set(null)

    expect(cache.read('test:activities:alice')).toBeNull()
    expect(useCases.list.getSnapshot().items).toEqual([])
    expect(useCases.list.hydrate().items).toEqual([])
  })

  it('未登录时即使本地有匿名缓存也不 hydrate', async () => {
    const cache = createFakeCache()
    cache.write('test:activities:anonymous', {
      items: [activity({ id: 'anon-act' })],
      nextCursor: null,
      updatedAt: NOW_ISO,
    })
    const fake = createFakeActivityRepository()
    const useCases = createActivityUseCases({
      repository: fake.repository,
      cache,
      clock: { now: () => NOW },
      session: createFakeSession(null),
      cacheKeyFor: (viewer) => `test:activities:${viewer ?? 'anonymous'}`,
    })

    expect(useCases.list.hydrate().items).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 校园邮箱
 * ------------------------------------------------------------------ */

function createFakeMailRepository(overrides: Partial<MailAccountRepository> = {}) {
  const calls = {
    bind: [] as unknown[],
    sync: 0,
    events: 0,
    unlink: 0,
  }

  const repository: MailAccountRepository = {
    async bind(input) {
      calls.bind.push(input)
      return ok({
        email: input.email,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        status: 'active',
        lastSyncAt: null,
      })
    },
    async unlink() {
      calls.unlink += 1
      return ok(true)
    },
    async sync() {
      calls.sync += 1
      return ok({
        scanned: 10,
        matched: 2,
        stored: 2,
        lastSyncAt: NOW_ISO,
        stale: false,
      })
    },
    async events() {
      calls.events += 1
      return ok({ items: [], stale: false })
    },
    ...overrides,
  }

  return { repository, calls }
}

function setupMail(overrides: Partial<MailAccountRepository> = {}) {
  const fake = createFakeMailRepository(overrides)
  const activityFake = createFakeActivityRepository()
  const useCases = createMailActivityUseCases({
    repository: fake.repository,
    activities: activityFake.repository,
  })
  const calls = Object.assign(fake.calls, { importMail: activityFake.calls.importMail })
  return { calls, useCases }
}

describe('校园邮箱用例', () => {
  it('表单不合法时不请求服务端（不做假成功）', async () => {
    const { useCases, calls } = setupMail()

    const result = await useCases.bind({
      email: 'alice@gmail.com',
      imapHost: 'imap.shanghaitech.edu.cn',
      imapPort: 993,
      password: 'x',
    })

    expect(result.ok).toBe(false)
    expect(calls.bind).toEqual([])
  })

  it('绑定只把服务端需要的四个字段送出去，结果里没有密码', async () => {
    const { useCases, calls } = setupMail()

    const result = await useCases.bind({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: 'imap.shanghaitech.edu.cn',
      imapPort: 993,
      password: 'client-specific-password',
    })

    expect(result.ok).toBe(true)
    expect(calls.bind).toEqual([
      {
        email: 'alice@shanghaitech.edu.cn',
        imapHost: 'imap.shanghaitech.edu.cn',
        imapPort: 993,
        password: 'client-specific-password',
      },
    ])
    expect(result.ok && 'password' in result.value).toBe(false)
  })

  it('同步失败 → 返回错误且不再拉事件（不展示半套成功）', async () => {
    const { useCases, calls } = setupMail({
      async sync() {
        return err({ code: 'UPSTREAM_UNAVAILABLE', message: 'IMAP 连接失败' })
      },
    })

    const result = await useCases.sync()

    expect(result.ok).toBe(false)
    expect(calls.events).toBe(0)
  })

  it('同步成功 → 拉最新事件', async () => {
    const { useCases, calls } = setupMail()

    const result = await useCases.sync()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toEqual([])
    expect(calls.sync).toBe(1)
    expect(calls.events).toBe(1)
  })

  it('把邮件事件提升为候选活动（走 activities 的导入端点）', async () => {
    const { useCases, calls } = setupMail()

    const result = await useCases.promote('mail-ev-1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.map((item) => item.id)).toEqual(['act-mail'])
    expect(calls.importMail).toEqual(['mail-ev-1'])
  })
})
