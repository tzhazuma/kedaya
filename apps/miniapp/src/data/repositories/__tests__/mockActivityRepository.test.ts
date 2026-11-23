import { describe, expect, it } from 'vitest'

import { createMockActivityRepository } from '../mockActivityRepository'
import { createMockMailAccountRepository } from '../mockMailAccountRepository'

/**
 * Mock 活动仓储的**状态迁移**测试。
 *
 * 它不是"返回固定 JSON"的假实现：确认要像真服务端一样自动建默认提醒，
 * 忽略要清掉待发提醒，邮件提升要能找到同一份 mock 邮箱里的事件。
 * 否则离线演示会走一条与线上不同的路径，问题留到真机才暴露。
 */

const NOW = new Date('2026-11-22T04:00:00.000Z')

function setup() {
  const mail = createMockMailAccountRepository({ latencyMs: 0, now: () => NOW })
  const activities = createMockActivityRepository({
    latencyMs: 0,
    now: () => NOW,
    mailEvents: () => (mail.isBound() ? mail.eventsForPromotion() : []),
  })
  return { mail, activities }
}

describe('mock activities repository', () => {
  it('确认候选活动时自动建默认站内信提醒（与真服务端一致）', async () => {
    const { activities } = setup()
    const listed = await activities.list()
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    const candidate = listed.value.items.find(
      (item) => item.status === 'candidate' && item.startsAt !== null,
    )
    expect(candidate).toBeDefined()
    if (candidate === undefined) return

    const confirmed = await activities.confirm(candidate.id)
    expect(confirmed.ok).toBe(true)

    const reminders = await activities.listRemindersFor(candidate.id)
    expect(reminders.ok).toBe(true)
    if (!reminders.ok) return
    expect(reminders.value.length).toBeGreaterThan(0)
    expect(reminders.value.every((item) => item.channel === 'inapp')).toBe(true)
  })

  it('忽略活动会清掉待发提醒', async () => {
    const { activities } = setup()
    const listed = await activities.list()
    if (!listed.ok) return
    const candidate = listed.value.items.find((item) => item.status === 'candidate')
    if (candidate === undefined) return

    await activities.confirm(candidate.id)
    const dismissed = await activities.dismiss(candidate.id)
    expect(dismissed.ok).toBe(true)

    const reminders = await activities.listRemindersFor(candidate.id)
    expect(reminders.ok && reminders.value).toEqual([])
  })

  it('邮件提升只认已绑定邮箱里的事件（不凭 id 编标题）', async () => {
    const { mail, activities } = setup()

    const before = await activities.importMail('mock-mail-ev-1')
    expect(before.ok).toBe(false)

    const bound = await mail.bind({
      email: 'alice@shanghaitech.edu.cn',
      imapHost: 'imap.shanghaitech.edu.cn',
      imapPort: 993,
      password: 'client-specific-password',
    })
    expect(bound.ok).toBe(true)

    const after = await activities.importMail('mock-mail-ev-1')
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.value[0]?.title).toBe('通识大讲堂：人工智能与校园')
  })
})
