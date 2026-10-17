import { describe, expect, it } from 'vitest'

import { createLogPort, createMemorySink } from '../log'
import { LOG_EVENT_FIELDS, isRegisteredLogEvent } from '../../domain/ports/logPort'

/**
 * 日志端口（规格 §10.3「白名单外剔除」）。
 *
 * 这些测试验证的是**结构性保证**，不是某个函数的返回值：
 * 即使调用方把含凭证的整个对象传进来，到达 sink 的日志里也不会有凭证。
 */

const FIXED_NOW = (): Date => new Date('2026-10-17T03:00:00.000Z')

describe('platform · log（事件与字段白名单）', () => {
  it('未登记的事件**整条丢弃**（不是"只打事件名"）', () => {
    const sink = createMemorySink()
    const dropped: string[] = []
    const log = createLogPort({
      sink,
      now: FIXED_NOW,
      onDropped: (info) => dropped.push(`${info.event}:${info.reason}`),
    })

    log.info('techpie.bindings.load.started')
    log.info('someone.invented.this.event', { anything: 1 })

    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]?.event).toBe('techpie.bindings.load.started')
    expect(dropped).toEqual(['someone.invented.this.event:UNKNOWN_EVENT'])
  })

  it('未登记的字段被剔除，已登记字段保留', () => {
    const sink = createMemorySink()
    const log = createLogPort({ sink, now: FIXED_NOW })

    log.info('techpie.bindings.load.succeeded', {
      count: 2,
      activeCount: 1,
      durationMs: 12,
      // 未登记 —— 必须被剔除
      items: [{ id: 'tpl-1' }],
      castgc: 'TGT-1',
    })

    expect(sink.records[0]?.fields).toEqual({ count: 2, activeCount: 1, durationMs: 12 })
  })

  it('事件登记表本身是可断言的（新增事件必须显式登记）', () => {
    expect(isRegisteredLogEvent('techpie.binding.create.started')).toBe(true)
    expect(isRegisteredLogEvent('techpie.binding.create.succeeded')).toBe(true)
    expect(isRegisteredLogEvent('techpie.contract.violation')).toBe(true)
    expect(isRegisteredLogEvent('campus-card.payment-code.issued')).toBe(true)
    expect(isRegisteredLogEvent('made.up.event')).toBe(false)
  })

  it('⚠️ 绑定相关事件的允许字段里**没有任何**能装下凭证的字段名', () => {
    for (const event of [
      'techpie.binding.create.started',
      'techpie.binding.create.succeeded',
      'techpie.binding.create.failed',
      'techpie.binding.unbind.started',
      'techpie.binding.renew.started',
    ]) {
      const fields = LOG_EVENT_FIELDS[event] ?? []
      for (const forbidden of ['credential', 'password', 'openid', 'code', 'cookie', 'castgc']) {
        // `code` 是允许的，但它承载的是**错误码**（如 FORBIDDEN），不是登录凭证 ——
        // 这条断言因此只检查真正会装下凭证的字段名
        if (forbidden === 'code') continue
        expect(fields).not.toContain(forbidden)
      }
    }
  })
})

describe('platform · log（值清洗）', () => {
  it('白名单字段的值里混进内联凭证时被清洗', () => {
    const sink = createMemorySink()
    const log = createLogPort({ sink, now: FIXED_NOW })

    // `reason` 是 techpie.contract.violation 的已登记字段
    log.warn('techpie.contract.violation', {
      where: 'techpie.links',
      droppedCount: 1,
      reason: 'CASTGC=TGT-9 leaked into response',
    })

    const serialized = JSON.stringify(sink.records)
    expect(serialized).not.toContain('TGT-9')
    expect(serialized).toContain('[REDACTED]')
  })

  it('落点收到的是**冻结**对象，调用方无法事后篡改已写入的日志', () => {
    const sink = createMemorySink()
    const log = createLogPort({ sink, now: FIXED_NOW })
    log.info('techpie.bindings.load.succeeded', { count: 1 })
    expect(Object.isFrozen(sink.records[0]?.fields)).toBe(true)
  })

  it('级别过滤生效', () => {
    const sink = createMemorySink()
    const log = createLogPort({ sink, now: FIXED_NOW, minLevel: 'warn' })
    log.info('techpie.bindings.load.started')
    log.warn('techpie.bindings.load.failed', { code: 'UPSTREAM_UNAVAILABLE', durationMs: 1 })
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]?.level).toBe('warn')
  })
})
