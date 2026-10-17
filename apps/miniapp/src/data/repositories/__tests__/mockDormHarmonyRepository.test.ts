import { describe, expect, it } from 'vitest'

import {
  DORM_HARMONY_CONSENT_CACHE_KEY,
  DORM_HARMONY_CONSENT_VERSION,
  DORM_HARMONY_TRACK_CODES_CACHE_KEY,
  createDormHarmonyUseCases,
  isDormHarmonyTrackRecord,
} from '../../../application/dormHarmony/dormHarmonyUseCases'
import {
  DORM_HARMONY_BUILDING_MAX,
  DORM_HARMONY_CLOSED_MESSAGE_ERROR,
  DORM_HARMONY_NOT_LOCAL_MESSAGE,
  DORM_HARMONY_TRACK_CODE_ERROR,
  expectationLabel,
  isTrackCodeShaped,
  normalizeTrackCode,
  statusLabel,
  summarizeCase,
  validateSubmitDraft,
} from '../../../domain/models/dormHarmony'
import type { DormHarmonyCaseDetail } from '../../../domain/models/dormHarmony'
import { createMemoryStorage } from '../../storage/memoryStorage'
import type { MemoryStorage } from '../../storage/memoryStorage'
import { StorageKeys } from '../../storage/keys'
import {
  createMockDormHarmonyRepository,
  mockAnonymousHandle,
  mockGenerateTrackCode,
  mockSha256Hex,
} from '../mockDormHarmonyRepository'
import type { MockDormHarmonyRepository } from '../mockDormHarmonyRepository'

/**
 * 宿舍矛盾「领域规则 + Mock 仓储 + 用例层凭据保管」的可执行规格。
 *
 * 三块拼在一起测，是因为它们必须**同时**成立才算这个模块能用：
 *   1. mock 仓储复刻后端的匿名 / 防枚举 / 状态机规则（不是"看起来像"）；
 *   2. 追踪码明文只在提交响应里出现一次 —— 缓存里连明文的影子都不能有；
 *   3. 用例层把追踪码 + 案件编号落本地，所以「提交 → 刷新 → 凭追踪码再看」是真的。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

const DRAFT = {
  building: '1 号楼',
  topic: '作息不一致',
  detail: '有人凌晨打游戏外放',
  expectation: 'talk' as const,
}

interface Harness {
  cache: MemoryStorage
  repository: MockDormHarmonyRepository
  useCases: ReturnType<typeof createDormHarmonyUseCases>
}

/** 只挂仓储的沙盒（用来断言"服务端"侧到底存了什么） */
function repoOnly(): { cache: MemoryStorage; repository: MockDormHarmonyRepository } {
  const cache = createMemoryStorage()
  return { cache, repository: createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW }) }
}

function full(): Harness {
  const cache = createMemoryStorage()
  const repository = createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW })
  const useCases = createDormHarmonyUseCases({
    repository,
    cache,
    clock: { now: () => NOW },
  })
  return { cache, repository, useCases }
}

async function submitCase(
  repository: MockDormHarmonyRepository,
  overrides: Partial<typeof DRAFT> = {},
): Promise<{ detail: DormHarmonyCaseDetail; trackCode: string; caseId: string }> {
  const submitted = await repository.submit({ ...DRAFT, ...overrides })
  if (!submitted.ok) throw new Error(`submit 失败：${submitted.error.code}`)
  const detail = await repository.track({
    caseId: submitted.value.case.id,
    trackCode: submitted.value.trackCode,
  })
  if (!detail.ok) throw new Error(`track 失败：${detail.error.code}`)
  return { detail: detail.value, trackCode: submitted.value.trackCode, caseId: submitted.value.case.id }
}

describe('mock 哈希与生成器（必须与后端同算法）', () => {
  it('mockSha256Hex 等于标准 SHA-256（含多分组与 UTF-8）', () => {
    expect(mockSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(mockSha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    // 中文（多字节）+ 超过 55 字节（触发第二个分组）
    expect(mockSha256Hex('鸭友手写')).toBe(
      '8c757a5e67ed4221e9e76f319da38843c00fa645c7f14108e173fcae509cb501',
    )
    expect(mockSha256Hex('a'.repeat(64))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    )
  })

  it('追踪码是 XXXX-XXXX-XXXX 且只含不会混淆的字符', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = mockGenerateTrackCode()
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(code).not.toMatch(/[IO01]/)
    }
  })

  it('匿名 handle 形如「鸭友 + 6 位十六进制」，同种子稳定、异种子不同', () => {
    expect(mockAnonymousHandle('case-1:abcd')).toMatch(/^鸭友[0-9A-F]{6}$/)
    expect(mockAnonymousHandle('case-1:abcd')).toBe(mockAnonymousHandle('case-1:abcd'))
    expect(mockAnonymousHandle('case-1:abcd')).not.toBe(mockAnonymousHandle('case-2:abcd'))
  })
})

describe('mock 仓储：提交（匿名、追踪码只返回一次）', () => {
  it('返回 { case, trackCode }，case 不含 trackCodeHash', async () => {
    const { repository } = repoOnly()
    const result = await repository.submit(DRAFT)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.trackCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(result.value.case).not.toHaveProperty('trackCodeHash')
    expect(result.value.case.status).toBe('submitted')
    expect(result.value.case.mediatorId).toBeNull()
    expect(result.value.case.anonHandle).toMatch(/^鸭友[0-9A-F]{6}$/)
  })

  it('缓存里只有 sha256(trackCode)：明文绝不落盘', async () => {
    const { cache, repository } = repoOnly()
    const result = await repository.submit(DRAFT)
    if (!result.ok) throw new Error('submit 失败')

    const stored = JSON.stringify(cache.snapshot())
    expect(stored).toContain(mockSha256Hex(result.value.trackCode))
    // 这是本模块最硬的一条：库中无明文
    expect(stored).not.toContain(result.value.trackCode)
    expect(stored).not.toContain(JSON.stringify(result.value.trackCode).slice(1, -1))
  })

  it('两个案子拿到不同的匿名 handle（种子含案子 id + 随机数）', async () => {
    const { repository } = repoOnly()
    const first = await repository.submit(DRAFT)
    const second = await repository.submit(DRAFT)
    if (!first.ok || !second.ok) throw new Error('submit 失败')
    expect(second.value.case.anonHandle).not.toBe(first.value.case.anonHandle)
    expect(second.value.case.id).not.toBe(first.value.case.id)
  })

  it('空 / 超长的字段一律 VALIDATION_FAILED，且不落库', async () => {
    const { cache, repository } = repoOnly()
    const bad = [
      { building: '   ' },
      { topic: '' },
      { topic: 'x'.repeat(41) },
      { building: 'x'.repeat(DORM_HARMONY_BUILDING_MAX + 1) },
      { detail: 'x'.repeat(2001) },
      { expectation: 'sue' as never },
    ]
    for (const overrides of bad) {
      const result = await repository.submit({ ...DRAFT, ...overrides })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
    expect(cache.read(DORM_HARMONY_TRACK_CODES_CACHE_KEY)).toBeNull()
    const listed = JSON.stringify(cache.snapshot())
    expect(listed).not.toContain('"submitted"')
  })

  it('空白的补充说明与空字符串期望值归一化成 null', async () => {
    const { repository } = repoOnly()
    const result = await repository.submit({ ...DRAFT, detail: '   ', expectation: '' })
    if (!result.ok) throw new Error('submit 失败')
    expect(result.value.case.detail).toBeNull()
    expect(result.value.case.expectation).toBeNull()
  })
})

describe('mock 仓储：凭追踪码读取（防枚举）', () => {
  it('追踪码正确 → 返回详情与留言，且不含 trackCodeHash', async () => {
    const { repository } = repoOnly()
    const { detail } = await submitCase(repository)
    expect(detail.id).not.toBe('')
    expect(detail.messages).toEqual([])
    expect(detail).not.toHaveProperty('trackCodeHash')
  })

  it('追踪码错误 / 缺失 / 案子不存在 / 跨案子 → 同一句文案（防枚举）', async () => {
    const { repository } = repoOnly()
    const a = await submitCase(repository, { topic: '作息' })
    const b = await submitCase(repository, { topic: '卫生' })

    const cases = await Promise.all([
      repository.track({ caseId: a.caseId, trackCode: 'WRONG-CODE-0000' }),
      repository.track({ caseId: a.caseId, trackCode: '' }),
      repository.track({ caseId: 'ghost-case', trackCode: a.trackCode }),
      // 用 b 的追踪码去开 a 的案子
      repository.track({ caseId: a.caseId, trackCode: b.trackCode }),
      repository.track({ caseId: a.caseId, trackCode: normalizeTrackCode(a.trackCode).toLowerCase() }),
    ])

    for (const result of cases) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
        expect(result.error.message).toBe(DORM_HARMONY_TRACK_CODE_ERROR)
      }
    }
  })

  it('大小写 / 空格差异在客户端归一化后仍能打开（便利，不改变凭据强度）', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)
    const messy = ` ${trackCode.toLowerCase().replace('-', ' - ')} `
    const result = await repository.track({ caseId, trackCode: normalizeTrackCode(messy) })
    expect(result.ok).toBe(true)
  })
})

describe('mock 仓储：留言与状态机', () => {
  it('submitted 留言后自动推进为 in-progress，留言带案子的匿名 handle', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode, detail } = await submitCase(repository)

    const result = await repository.postMessage({ caseId, trackCode, body: '  补充一下  ' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.caseStatus).toBe('in-progress')
    expect(result.value.message.fromRole).toBe('student')
    expect(result.value.message.anonHandle).toBe(detail.anonHandle)
    expect(result.value.message.body).toBe('补充一下')

    const after = await repository.track({ caseId, trackCode })
    if (!after.ok) throw new Error('track 失败')
    expect(after.value.status).toBe('in-progress')
    expect(after.value.messages).toHaveLength(1)
  })

  it('已是 in-progress 时留言不重复推进状态，留言持续累积', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)

    await repository.postMessage({ caseId, trackCode, body: '第一条' })
    const second = await repository.postMessage({ caseId, trackCode, body: '第二条' })
    if (!second.ok) throw new Error('postMessage 失败')
    expect(second.value.caseStatus).toBe('in-progress')

    const after = await repository.track({ caseId, trackCode })
    if (!after.ok) throw new Error('track 失败')
    expect(after.value.messages.map((message) => message.body)).toEqual(['第一条', '第二条'])
  })

  it('空留言 / 超长留言 → VALIDATION_FAILED，不追加', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)
    for (const body of ['   ', 'x'.repeat(2001)]) {
      const result = await repository.postMessage({ caseId, trackCode, body })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
    const after = await repository.track({ caseId, trackCode })
    if (!after.ok) throw new Error('track 失败')
    expect(after.value.messages).toHaveLength(0)
  })

  it('已结案后留言 → CONFLICT，结案重复 → CONFLICT', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)

    const closed = await repository.close({ caseId, trackCode })
    expect(closed.ok).toBe(true)
    if (closed.ok) expect(closed.value.status).toBe('closed')

    const message = await repository.postMessage({ caseId, trackCode, body: '还在吗' })
    expect(message.ok).toBe(false)
    if (!message.ok) {
      expect(message.error.code).toBe('CONFLICT')
      expect(message.error.message).toBe(DORM_HARMONY_CLOSED_MESSAGE_ERROR)
    }

    const again = await repository.close({ caseId, trackCode })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')

    // 结案后仍能查看（凭追踪码）
    const after = await repository.track({ caseId, trackCode })
    if (!after.ok) throw new Error('track 失败')
    expect(after.value.status).toBe('closed')
  })

  it('追踪码错误时既不能留言也不能结案', async () => {
    const { repository } = repoOnly()
    const { caseId } = await submitCase(repository)
    const wrong = { caseId, trackCode: 'WRONG-CODE-0000' }

    const message = await repository.postMessage({ ...wrong, body: '在吗' })
    const closed = await repository.close(wrong)
    for (const result of [message, closed]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    }
  })
})

describe('mock 仓储：调解员入口（唯一需要登录的写操作）', () => {
  it('设 mediatorId 并追加 mediator 留言（不带 handle），案子转 in-progress', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)

    const result = await repository.mediatorReply(caseId, '我们已联系宿管')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.caseStatus).toBe('in-progress')
    expect(result.value.message.fromRole).toBe('mediator')
    expect(result.value.message.anonHandle).toBeNull()

    const after = await repository.track({ caseId, trackCode })
    if (!after.ok) throw new Error('track 失败')
    expect(after.value.mediatorId).toBe('mock-mediator')
  })

  it('案子不存在 → NOT_FOUND；已结案 → CONFLICT；空内容 → VALIDATION_FAILED', async () => {
    const { repository } = repoOnly()
    const missing = await repository.mediatorReply('ghost-case', '在吗')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')

    const { caseId, trackCode } = await submitCase(repository)
    const empty = await repository.mediatorReply(caseId, '  ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error.code).toBe('VALIDATION_FAILED')

    await repository.close({ caseId, trackCode })
    const closed = await repository.mediatorReply(caseId, '在吗')
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error.code).toBe('CONFLICT')
  })
})

describe('mock 仓储：演示开关', () => {
  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const { repository } = repoOnly()
    repository.failNextRequests(1)
    const failed = await repository.submit(DRAFT)
    expect(failed.ok).toBe(false)
    const ok2 = await repository.submit(DRAFT)
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 之后案子是真的不存在（reset 后仍是空的）', async () => {
    const { repository } = repoOnly()
    const { caseId, trackCode } = await submitCase(repository)
    repository.clearAll()
    const gone = await repository.track({ caseId, trackCode })
    expect(gone.ok).toBe(false)
    repository.reset()
    const stillGone = await repository.track({ caseId, trackCode })
    expect(stillGone.ok).toBe(false)
  })
})

describe('用例层：本地追踪码保管（匿名案唯一能"续上"的方式）', () => {
  it('本地 key 字面量与 data/storage/keys.ts 保持一致（防漂移）', () => {
    expect(DORM_HARMONY_TRACK_CODES_CACHE_KEY).toBe(StorageKeys.dormHarmonyTrackCodes)
    expect(DORM_HARMONY_CONSENT_CACHE_KEY).toBe(StorageKeys.consent)
  })

  it('提交成功后自动记住追踪码 + 案件编号，摘要能通过形状守卫', async () => {
    const { useCases } = full()
    const result = await useCases.submit(DRAFT)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const saved = useCases.savedCases()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.trackCode).toBe(result.value.trackCode)
    // 案件编号必须一起存：服务端不提供「凭追踪码反查案件」
    expect(saved[0]?.summary.id).toBe(result.value.case.id)
    expect(saved[0]?.summary.status).toBe('submitted')
    expect(isDormHarmonyTrackRecord(saved[0])).toBe(true)
  })

  it('提交前先做客户端校验，不合格就不发请求', async () => {
    const { cache, useCases } = full()
    const result = await useCases.submit({ building: '  ', topic: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.message).toBe('请填写宿舍楼')
    }
    expect(useCases.savedCases()).toHaveLength(0)
    expect(cache.read(DORM_HARMONY_TRACK_CODES_CACHE_KEY)).toBeNull()
  })

  it('「换个会话」仍能凭本机记录打开案子（提交 → 重启 → 再看）', async () => {
    const cache = createMemoryStorage()
    const first = createDormHarmonyUseCases({
      repository: createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW }),
      cache,
      clock: { now: () => NOW },
    })
    const submitted = await first.submit(DRAFT)
    if (!submitted.ok) throw new Error('submit 失败')

    // 新的仓储实例 + 新的用例实例，只共享同一份本地缓存（等价于重新打开小程序）
    const second = createDormHarmonyUseCases({
      repository: createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW }),
      cache,
      clock: { now: () => NOW },
    })
    const saved = second.savedCases()
    expect(saved).toHaveLength(1)

    const reopened = await second.track(saved[0]?.trackCode ?? '')
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.id).toBe(submitted.value.case.id)
  })

  it('只有追踪码、没有案件编号时明确失败（而不是发一个注定 403 的请求）', async () => {
    const { useCases } = full()
    const result = await useCases.track('ABCD-EFGH-JKLM')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toBe(DORM_HARMONY_NOT_LOCAL_MESSAGE)
    }
  })

  it('手动提供案件编号 + 追踪码可以直接打开（换设备的合法路径）', async () => {
    const { repository, useCases } = full()
    const submitted = await repository.submit(DRAFT)
    if (!submitted.ok) throw new Error('submit 失败')

    const result = await useCases.track(submitted.value.trackCode, submitted.value.case.id)
    expect(result.ok).toBe(true)
    // 打开成功后也会记到本地
    expect(useCases.savedCases().map((record) => record.summary.id)).toContain(
      submitted.value.case.id,
    )
  })

  it('留言 / 结案后本机摘要的状态标签跟着服务端走', async () => {
    const { useCases } = full()
    const submitted = await useCases.submit(DRAFT)
    if (!submitted.ok) throw new Error('submit 失败')
    const caseId = submitted.value.case.id
    const trackCode = submitted.value.trackCode

    await useCases.postMessage(caseId, trackCode, '再补充一句')
    expect(useCases.savedCases()[0]?.summary.status).toBe('in-progress')
    expect(useCases.savedCases()[0]?.summary.statusLabel).toBe('调解中')

    await useCases.close(caseId, trackCode)
    expect(useCases.savedCases()[0]?.summary.status).toBe('closed')
  })

  it('forget 之后本机不再有这条记录，且不影响服务端（仍能凭完整凭据打开）', async () => {
    const { useCases } = full()
    const submitted = await useCases.submit(DRAFT)
    if (!submitted.ok) throw new Error('submit 失败')

    useCases.forget(submitted.value.trackCode)
    expect(useCases.savedCases()).toHaveLength(0)

    const reopened = await useCases.track(submitted.value.trackCode, submitted.value.case.id)
    expect(reopened.ok).toBe(true)
  })

  it('remember 幂等：同一追踪码只保留一条，且保留首次保存时间', async () => {
    const { useCases } = full()
    const submitted = await useCases.submit(DRAFT)
    if (!submitted.ok) throw new Error('submit 失败')

    const first = useCases.savedCases()[0]
    if (first === undefined) throw new Error('没有本地记录')

    useCases.remember(first.trackCode, { ...first.summary, status: 'in-progress' })
    const saved = useCases.savedCases()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.createdAt).toBe(first.createdAt)
    expect(saved[0]?.summary.status).toBe('in-progress')
  })

  it('坏缓存被逐条丢弃，绝不会喂给 UI', async () => {
    const cache = createMemoryStorage({
      [DORM_HARMONY_TRACK_CODES_CACHE_KEY]: [
        '不是对象',
        { trackCode: 'AAAA-BBBB-CCCC' },
        { trackCode: 'AAAA-BBBB-CCCC', summary: {}, createdAt: 'x' },
        { trackCode: '', summary: null, createdAt: 'x' },
        {
          // 合法的一条
          trackCode: 'GOOD-CODE-2345',
          createdAt: NOW.toISOString(),
          summary: {
            id: 'case-1',
            anonHandle: '鸭友0A1B2C',
            building: '1 号楼',
            topic: '作息不一致',
            status: 'submitted',
            statusLabel: '已提交',
            expectationLabel: null,
            mediatorLabel: '尚未有调解员介入',
            timeLabel: '刚刚',
            createdAt: NOW.toISOString(),
          },
        },
        {
          // 重复的合法条目：只留第一条
          trackCode: 'GOOD-CODE-2345',
          createdAt: NOW.toISOString(),
          summary: {
            id: 'case-2',
            anonHandle: '鸭友0A1B2C',
            building: '2 号楼',
            topic: '卫生分工',
            status: 'closed',
            statusLabel: '已结案',
            expectationLabel: null,
            mediatorLabel: '尚未有调解员介入',
            timeLabel: '刚刚',
            createdAt: NOW.toISOString(),
          },
        },
      ],
    })

    const useCases = createDormHarmonyUseCases({
      repository: createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW }),
      cache,
      clock: { now: () => NOW },
    })

    const saved = useCases.savedCases()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.trackCode).toBe('GOOD-CODE-2345')
    expect(saved[0]?.summary.id).toBe('case-1')

    const notArray = createMemoryStorage({ [DORM_HARMONY_TRACK_CODES_CACHE_KEY]: '坏掉了' })
    const fallback = createDormHarmonyUseCases({
      repository: createMockDormHarmonyRepository({ cache: notArray, latencyMs: 0, now: () => NOW }),
      cache: notArray,
      clock: { now: () => NOW },
    })
    expect(fallback.savedCases()).toEqual([])
  })
})

describe('用例层：二次同意（契约 §9）', () => {
  it('默认未同意；同意后写入 { acceptedAt, version } 并能读回', () => {
    const { cache, useCases } = full()
    expect(useCases.hasConsented()).toBe(false)

    const record = useCases.acceptConsent()
    expect(useCases.hasConsented()).toBe(true)
    expect(record).toEqual({ acceptedAt: NOW.toISOString(), version: DORM_HARMONY_CONSENT_VERSION })
    expect(cache.read(DORM_HARMONY_CONSENT_CACHE_KEY)).toEqual({
      'dorm-harmony': { acceptedAt: NOW.toISOString(), version: DORM_HARMONY_CONSENT_VERSION },
    })
  })

  it('写在共享 consent key 里也不会覆盖其它敏感模块的条目', () => {
    const cache = createMemoryStorage({
      [DORM_HARMONY_CONSENT_CACHE_KEY]: {
        wellbeing: { acceptedAt: '2026-01-01T00:00:00.000Z', version: 'v9' },
      },
    })
    const useCases = createDormHarmonyUseCases({
      repository: createMockDormHarmonyRepository({ cache, latencyMs: 0, now: () => NOW }),
      cache,
      clock: { now: () => NOW },
    })

    useCases.acceptConsent()
    const stored = cache.read<Record<string, unknown>>(DORM_HARMONY_CONSENT_CACHE_KEY)
    expect(stored?.wellbeing).toEqual({ acceptedAt: '2026-01-01T00:00:00.000Z', version: 'v9' })
    expect(stored?.['dorm-harmony']).toBeDefined()

    useCases.revokeConsent()
    const afterRevoke = cache.read<Record<string, unknown>>(DORM_HARMONY_CONSENT_CACHE_KEY)
    expect(afterRevoke?.['dorm-harmony']).toBeUndefined()
    expect(afterRevoke?.wellbeing).toBeDefined()
  })

  it('同意版本不匹配（或缓存损坏）视为未同意', () => {
    const stale = createMemoryStorage({
      [DORM_HARMONY_CONSENT_CACHE_KEY]: {
        'dorm-harmony': { acceptedAt: NOW.toISOString(), version: 'v0' },
      },
    })
    expect(
      createDormHarmonyUseCases({
        repository: createMockDormHarmonyRepository({ cache: stale, latencyMs: 0, now: () => NOW }),
        cache: stale,
        clock: { now: () => NOW },
      }).hasConsented(),
    ).toBe(false)

    const broken = createMemoryStorage({ [DORM_HARMONY_CONSENT_CACHE_KEY]: 'not-an-object' })
    expect(
      createDormHarmonyUseCases({
        repository: createMockDormHarmonyRepository({ cache: broken, latencyMs: 0, now: () => NOW }),
        cache: broken,
        clock: { now: () => NOW },
      }).hasConsented(),
    ).toBe(false)
  })

  it('撤回同意只删自己那一条，键整体清空时连 key 一起移除', () => {
    const { cache, useCases } = full()
    useCases.acceptConsent()
    useCases.revokeConsent()
    expect(useCases.hasConsented()).toBe(false)
    expect(cache.read(DORM_HARMONY_CONSENT_CACHE_KEY)).toBeNull()
  })
})

describe('领域模型：标签、归一化与校验', () => {
  it('未知状态 / 未知期望降级为可读文案，而不是抛错', () => {
    expect(statusLabel('nope')).toBe('状态未知')
    expect(statusLabel('in-progress')).toBe('调解中')
    expect(expectationLabel(null)).toBeNull()
    expect(expectationLabel('nope')).toBeNull()
    expect(expectationLabel('mediation')).toBe('希望有人调解')
  })

  it('追踪码归一化：首尾空白去掉、中间分隔符统一成半角横线、转大写；形状判定只是软提示', () => {
    expect(normalizeTrackCode(' abcd-efgh-jklm ')).toBe('ABCD-EFGH-JKLM')
    expect(normalizeTrackCode('ABCD—EFGH－JKLM')).toBe('ABCD-EFGH-JKLM')
    expect(normalizeTrackCode('ABCD EFGH JKLM')).toBe('ABCD-EFGH-JKLM')
    expect(isTrackCodeShaped('abcd-efgh-jklm')).toBe(true)
    expect(isTrackCodeShaped('编号不对')).toBe(false)
    // 形状不合法也要放行给服务端 —— 客户端不替服务端做最终裁决
    expect(isTrackCodeShaped('anything-goes-here')).toBe(false)
  })

  it('校验一次性给出所有问题，口径与服务端一致（按码点计数）', () => {
    expect(validateSubmitDraft({ building: '', topic: '', detail: '', expectation: '' })).toEqual([
      '请填写宿舍楼',
      '请简要描述问题',
    ])
    expect(
      validateSubmitDraft({
        building: 'x'.repeat(DORM_HARMONY_BUILDING_MAX + 1),
        topic: 'ok',
        detail: 'x'.repeat(2001),
        expectation: 'nope',
      }),
    ).toHaveLength(3)
    // 40 个 emoji = 40 个码点（UTF-16 长度是 80），不该被误判超长
    expect(validateSubmitDraft({ building: '1 号楼', topic: '🐱'.repeat(40), detail: '', expectation: '' })).toEqual([])
  })

  it('summarizeCase 给出状态 / 期望 / 调解员 / 相对时间标签', () => {
    const summary = summarizeCase(
      {
        id: 'case-1',
        anonHandle: '鸭友0A1B2C',
        building: '1 号楼',
        topic: '作息不一致',
        detail: null,
        status: 'in-progress',
        mediatorId: 'staff-1',
        expectation: 'mediation',
        createdAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
        updatedAt: NOW.toISOString(),
      },
      NOW,
    )
    expect(summary.statusLabel).toBe('调解中')
    expect(summary.expectationLabel).toBe('希望有人调解')
    expect(summary.mediatorLabel).toBe('已有调解员介入')
    expect(summary.timeLabel).toBe('3 分钟前')
  })
})
