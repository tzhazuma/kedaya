import { describe, expect, it } from 'vitest'

import { createMockTechpieRepository } from '../mockTechpieRepository'
import { createTechpieMemoryDatabase } from '../../mock/techpieMemoryDatabase'
import { createLogPort, createMemorySink } from '../../../platform/log'

/**
 * Mock TechPie 仓储 —— 契约 §11.18-D（Phase 0 只允许校园卡）+ §8.5 / §8.6 的语义。
 *
 * mock 不只是"返回假数据"：它把契约语义实现了一遍，
 * 因此这些测试实际上是在验证**契约本身**在客户端的理解是否正确。
 */

const NOW = (): Date => new Date('2026-10-17T03:00:00.000Z')

function setup() {
  const sink = createMemorySink()
  const log = createLogPort({ sink, now: NOW })
  const database = createTechpieMemoryDatabase({ now: NOW })
  const repository = createMockTechpieRepository({ latencyMs: 0, now: NOW, database, log })
  return { repository, database, sink, log }
}

const CREDENTIAL = { channel: 'wechat-openid' as const, wechatLoginCode: 'wx-code-1' }

describe('mock · techpie repository（绑定）', () => {
  it('默认种子是**未绑定**（Phase 0 新用户的真实状态）', async () => {
    const { repository } = setup()
    const result = await repository.listBindings()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toEqual([])
  })

  it('绑定校园卡成功 → ACTIVE，且幂等键去重（同一 key 不重复建）', async () => {
    const { repository } = setup()

    const first = await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'key-1')
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.value.status).toBe('ACTIVE')
      expect(first.value.provider).toBe('ecard')
      expect(first.value.phase).toBe('phase0')
    }

    const replay = await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'key-1')
    expect(replay.ok).toBe(true)
    if (replay.ok && first.ok) expect(replay.value.id).toBe(first.value.id)

    const list = await repository.listBindings()
    if (list.ok) expect(list.value.items).toHaveLength(1)
  })

  it('⚠️ Phase 1 平台被拒绝：FORBIDDEN / PHASE_NOT_AVAILABLE（契约 §11.18-D）', async () => {
    const { repository, database } = setup()

    for (const provider of ['egate', 'cpdaily', 'cas', 'techpie'] as const) {
      const result = await repository.createBinding({ provider, credential: CREDENTIAL })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
        expect((result.error.details as { reason?: string }).reason).toBe('PHASE_NOT_AVAILABLE')
        expect(result.error.message).toContain('信息办')
      }
    }

    // 一条都没有落库
    expect(database.snapshot.bindings).toEqual([])
  })

  it('缺 OPENID 通道凭证 → VALIDATION_FAILED / OPENID_CODE_REQUIRED', async () => {
    const { repository } = setup()
    const result = await repository.createBinding({ provider: 'ecard' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect((result.error.details as { reason?: string }).reason).toBe('OPENID_CODE_REQUIRED')
    }
  })

  it('重复绑定同一平台 → CONFLICT / ALREADY_LINKED', async () => {
    const { repository } = setup()
    await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'k1')
    const again = await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'k2')
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect((again.error.details as { reason?: string }).reason).toBe('ALREADY_LINKED')
    }
  })

  it('解绑是**硬删**：条目消失，而不是标记失效（规格 §5.3）', async () => {
    const { repository, database } = setup()
    const created = await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'k1')
    expect(created.ok).toBe(true)
    const id = created.ok ? created.value.id : ''

    const unbound = await repository.unbind(id)
    expect(unbound.ok).toBe(true)
    expect(database.snapshot.bindings).toEqual([])

    const missing = await repository.unbind(id)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('续期：校园卡可续；CASTGC 平台 → CONFLICT / RENEW_NOT_SUPPORTED（规格 R4，不谎称）', async () => {
    const { repository, database } = setup()
    const created = await repository.createBinding({ provider: 'ecard', credential: CREDENTIAL }, 'k1')
    const id = created.ok ? created.value.id : ''

    const renewed = await repository.renew(id)
    expect(renewed.ok).toBe(true)

    database.seedExpiredEgateBinding()
    const egateId = database.snapshot.bindings.find((item) => item.provider === 'egate')?.id ?? ''
    const failed = await repository.renew(egateId)
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.error.code).toBe('CONFLICT')
      expect((failed.error.details as { reason?: string }).reason).toBe('RENEW_NOT_SUPPORTED')
      expect(failed.error.message).toContain('不会假装')
    }
  })
})

describe('mock · techpie repository（能力清单）', () => {
  it('能力清单里 Phase 0 的 WebView 能力**不需要绑定**（W4：用户自登录）', async () => {
    const { repository } = setup()
    const result = await repository.capabilities()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const byKey = new Map(result.value.map((item) => [item.key, item]))
    for (const key of ['ecourse', 'student_leave', 'student_activity', 'elrc_recordings']) {
      expect(byKey.get(key)?.requiredProvider).toBeNull()
      expect(byKey.get(key)?.available).toBe(true)
    }
    expect(byKey.get('campus_card')?.requiredProvider).toBe('ecard')
  })

  it('Phase 1+ 能力的 blockedReason **必须诚实**（提到信息办 / 未决问题）', async () => {
    const { repository } = setup()
    const result = await repository.capabilities()
    if (!result.ok) return

    for (const key of ['schedule', 'exam', 'ddl', 'facility']) {
      const item = result.value.find((entry) => entry.key === key)
      expect(item?.available).toBe(false)
      expect(item?.phase).not.toBe('phase0')
      expect(item?.blockedReason ?? '').toMatch(/信息办|未确认|未获批/)
    }
  })
})

describe('mock · techpie repository（校园卡）', () => {
  it('流水按时间倒序分页，游标对客户端不透明（契约 §11.10-E）', async () => {
    const { repository } = setup()
    const first = await repository.cardTransactions({ limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(first.value.items).toHaveLength(2)
    expect(first.value.items[0]?.id).toBe('txn-0005')
    expect(first.value.nextCursor).not.toBeNull()

    const second = await repository.cardTransactions({ cursor: first.value.nextCursor, limit: 2 })
    if (!second.ok) return
    expect(second.value.items[0]?.id).toBe('txn-0003')
  })

  it('付款码带 TTL（一次性、短时效）', async () => {
    const { repository } = setup()
    const result = await repository.paymentCode('k1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Date(result.value.expiresAt).getTime()).toBeGreaterThan(
      new Date(result.value.issuedAt).getTime(),
    )
    expect(result.value.code).toContain('MOCK')
  })

  it('演示控制：clearAll → 空态；reset → 回到种子', async () => {
    const { repository } = setup()
    repository.clearAll()
    const cleared = await repository.cardTransactions()
    if (cleared.ok) expect(cleared.value.items).toEqual([])

    repository.reset()
    const restored = await repository.cardTransactions()
    if (restored.ok) expect(restored.value.items.length).toBeGreaterThan(0)
  })

  it('演示控制：failNextRequests 让下一次请求失败（错误态）', async () => {
    const { repository } = setup()
    repository.failNextRequests(1)
    const failed = await repository.listBindings()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const ok2 = await repository.listBindings()
    expect(ok2.ok).toBe(true)
  })
})

describe('mock · techpie repository（契约违规：响应夹带凭证）', () => {
  it('⚠️ 响应里带 castgc 的条目被**拒绝**，并记一次契约违规', async () => {
    const { repository, sink, database } = setup()
    database.seedEcardBinding()
    repository.injectForbiddenKeysOnce()

    const result = await repository.listBindings()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toEqual([])

    const violation = sink.records.find((record) => record.event === 'techpie.contract.violation')
    expect(violation).toBeDefined()
    expect(violation?.fields.where).toBe('techpie.links')
    // ⚠️ 违规日志里**不含**凭证内容本身
    expect(JSON.stringify(sink.records)).not.toContain('TGT-DEMO-VIOLATION')
  })

  it('注入只生效一次（下一次请求恢复正常）', async () => {
    const { repository, database } = setup()
    database.seedEcardBinding()
    repository.injectForbiddenKeysOnce()

    await repository.listBindings()
    const second = await repository.listBindings()
    if (second.ok) expect(second.value.items).toHaveLength(1)
  })
})
