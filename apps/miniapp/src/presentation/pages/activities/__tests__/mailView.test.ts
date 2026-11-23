import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import type { ActivityItem } from '../../../../domain/models/activity'
import type { MailEventItem } from '../../../../domain/models/mailActivity'
import {
  buildMailRestore,
  buildPromoteOutcome,
} from '../mail/mailView'

/**
 * 邮箱页进入时恢复状态 + 多候选展示。
 *
 * 服务端 `POST /activities/imports/mail` 的响应是 `{items, created, skipped}`；
 * 一封邮件可能归一出多条候选，页面必须全部展示，不能只跳第一条。
 */

function event(id: string): MailEventItem {
  return {
    id,
    title: `邮件 ${id}`,
    startsAt: '2026-11-24T06:00:00.000Z',
    location: null,
    organizer: null,
    confidence: 0.8,
    matchedText: '证据',
    receivedAt: '2026-11-20T00:00:00.000Z',
    stale: false,
  }
}

function activity(id: string): ActivityItem {
  return {
    id,
    source: 'campus-mail',
    kind: 'lecture',
    title: `候选 ${id}`,
    startsAt: '2026-11-24T06:00:00.000Z',
    endsAt: null,
    location: null,
    organizer: null,
    registrationDeadlineAt: null,
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '证据',
    confidence: 0.8,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '校园邮箱',
    publishedAt: null,
    stale: false,
  }
}

describe('邮箱页进入时恢复', () => {
  it('已有事件 → 恢复已连接、事件列表与 stale 状态', () => {
    const restored = buildMailRestore(ok({ items: [event('ev-1'), event('ev-2')], stale: true }))

    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.connected).toBe(true)
    expect(restored.events.map((item) => item.id)).toEqual(['ev-1', 'ev-2'])
    expect(restored.stale).toBe(true)
    expect(restored.error).toBeNull()
  })

  it('读取失败 → 显示错误，不假装已连接', () => {
    const restored = buildMailRestore(
      err({ code: 'UPSTREAM_UNAVAILABLE', message: '邮箱事件读取失败' }),
    )

    expect(restored.ok).toBe(false)
    if (restored.ok) return
    expect(restored.error).toContain('邮箱事件读取失败')
    expect(restored.connected).toBe(false)
  })

  it('没有事件但上次同步失败（stale）→ 仍算已连接，方便用户重试同步', () => {
    const restored = buildMailRestore(ok({ items: [], stale: true }))

    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.connected).toBe(true)
    expect(restored.events).toEqual([])
  })
})

describe('邮件提升的多候选结果', () => {
  it('服务端返回两条候选 → 全部展示，并提示数量', () => {
    const outcome = buildPromoteOutcome(ok([activity('a'), activity('b')]))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(outcome.notice).toContain('2')
    expect(outcome.notice).toContain('候选')
  })

  it('提升失败 → 返回错误，不展示假候选', () => {
    const outcome = buildPromoteOutcome(
      err({ code: 'CONFLICT', message: '这封邮件已经被提升过了' }),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('已经被提升')
  })
})
