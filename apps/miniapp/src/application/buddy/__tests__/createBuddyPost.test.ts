import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createCreateBuddyPostUseCase } from '../createBuddyPost'
import type { CreateBuddyPostDeps } from '../createBuddyPost'
import { __resetIdempotencyCounterForTests } from '../../idempotency'
import {
  TEST_NOW_ISO,
  buddyPost,
  buddyTag,
  createFakeBuddyRepository,
  createFakeSessionStore,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 发布用例测试 —— 重点是**封闭标签**（规格 §3.2）。
 *
 * 任务明确要求验证「自由文本被拒」。这里从**两条路径**都验：
 * - 用例层的 `addTagByText()`（唯一能"输入"标签的入口）；
 * - `submit()` 的纵深防御（UI 可以被绕过，用例不能）。
 */

function createUseCase(options: Parameters<typeof createFakeBuddyRepository>[0] = {}) {
  const repository = createFakeBuddyRepository(options)
  const deps: CreateBuddyPostDeps = {
    repository,
    session: createFakeSessionStore(),
    clock: fixedClock(TEST_NOW_ISO),
  }
  return { repository, useCase: createCreateBuddyPostUseCase(deps) }
}

/** 填一份合法的表单 */
function fillValidForm(useCase: ReturnType<typeof createUseCase>['useCase']): void {
  useCase.setActivity('sport')
  useCase.setTitle('周六下午羽毛球，缺 2 人')
  useCase.setDescription('体育馆 3 号场，打两小时')
  useCase.setLocation('体育馆')
  useCase.setStartDate('2026-10-24')
  useCase.setStartTime('14:00')
  useCase.setDuration(120)
  useCase.setCapacity(4)
  useCase.toggleTag('badminton')
}

describe('createBuddyPost · 封闭标签（规格 §3.2，**自由文本被拒**）', () => {
  it('`addTagByText` 接受封闭表里已登记的 key', () => {
    const { useCase } = createUseCase()
    const state = useCase.addTagByText('badminton')
    expect(state.draft.tags).toEqual(['badminton'])
    expect(state.tagError).toBeNull()
  })

  it('`addTagByText` **拒绝自由文本**并给出中文原因，标签不被加入', () => {
    const { useCase } = createUseCase()

    for (const freeText of ['打羽毛球', 'badminton 场', '随便写']) {
      const state = useCase.addTagByText(freeText)
      expect(state.draft.tags).toEqual([])
      expect(state.tagError).not.toBeNull()
      expect(state.tagError).toContain('未登记的标签')
    }
  })

  it('`toggleTag` 也走同一套校验（未登记的 key 被拒）', () => {
    const { useCase } = createUseCase()
    const state = useCase.toggleTag('打羽毛球')
    expect(state.draft.tags).toEqual([])
    expect(state.tagError).toContain('未登记的标签')
  })

  it('超过 8 个标签 → tagError，且不再接受新的', () => {
    const { useCase } = createUseCase()
    const keys = ['badminton', 'basketball', 'football', 'table-tennis', 'tennis', 'running', 'gym', 'swimming']
    for (const key of keys) useCase.toggleTag(key)
    expect(useCase.getSnapshot().draft.tags).toHaveLength(8)

    const overflowed = useCase.toggleTag('yoga')
    expect(overflowed.draft.tags).toHaveLength(8)
    expect(overflowed.tagError).toContain('最多选择 8 个标签')
  })

  it('再次 toggle 同一个 key 会取消选中', () => {
    const { useCase } = createUseCase()
    useCase.toggleTag('badminton')
    const state = useCase.toggleTag('badminton')
    expect(state.draft.tags).toEqual([])
  })

  it('`removeTag` 移除指定标签', () => {
    const { useCase } = createUseCase()
    useCase.toggleTag('badminton')
    useCase.toggleTag('running')
    expect(useCase.removeTag('badminton').draft.tags).toEqual(['running'])
  })

  it('标签表从服务端拉取（`loadTags`）成功时用服务端那份', async () => {
    const okCase = createUseCase({ tags: [ok([buddyTag('badminton', { label: '羽毛球' })])] })
    const loaded = await okCase.useCase.loadTags()
    expect(loaded.tags).toHaveLength(1)
    expect(loaded.tags[0]?.label).toBe('羽毛球')
    expect(loaded.tagsError).toBeNull()
  })

  it('服务端标签表拉取失败 → **回落到本端封闭镜像**（不是清空、更不是自由输入）', async () => {
    // 服务端当前没有 `GET /buddy/tags`，真后端模式下这里必然失败。
    // 回落的是**封闭表**（服务端权威表的逐字副本），因此选出来的 key 服务端一定认。
    const failCase = createUseCase({ tags: [err(upstreamError('标签服务不可用'))] })
    const failed = await failCase.useCase.loadTags()

    expect(failed.tagsError).toContain('标签服务不可用')
    expect(failed.tagsError).toContain('回落到内置的封闭标签表')
    expect(failed.tags.length).toBeGreaterThan(20)
    expect(failed.tags.every((tag) => tag.isActive)).toBe(true)

    // 回落之后依然只认封闭表：自由文本仍被拒
    expect(failCase.useCase.addTagByText('打羽毛球').tagError).toContain('未登记的标签')
    expect(failCase.useCase.addTagByText('badminton').draft.tags).toEqual(['badminton'])
  })
})

describe('createBuddyPost · 板块与活动类型联动（规格 §2.3）', () => {
  it('`setSection` 切到一个属于该板块的 activity', () => {
    const { useCase } = createUseCase()
    expect(useCase.setSection('academic').draft.activity).toBe('study')
    expect(useCase.setSection('daily').draft.activity).toBe('meal')
    expect(useCase.setSection('sport').draft.activity).toBe('sport')
  })

  it('离开 sport 板块时清掉「运动水平要求」（仅 sport 有意义）', () => {
    const { useCase } = createUseCase()
    useCase.setActivity('sport')
    useCase.setMinSkillLevel('regular')
    expect(useCase.getSnapshot().draft.minSkillLevel).toBe('regular')

    const state = useCase.setActivity('study')
    expect(state.draft.minSkillLevel).toBeNull()
  })

  it('非 sport 板块下 `setMinSkillLevel` 不生效', () => {
    const { useCase } = createUseCase()
    useCase.setActivity('meal')
    expect(useCase.setMinSkillLevel('regular').draft.minSkillLevel).toBeNull()
  })
})

describe('createBuddyPost · 提交（规格 §5.4 / 契约 §11.3）', () => {
  it('未登录 → UNAUTHENTICATED，不发请求', async () => {
    const repository = createFakeBuddyRepository()
    const useCase = createCreateBuddyPostUseCase({
      repository,
      session: createFakeSessionStore(null),
      clock: fixedClock(TEST_NOW_ISO),
    })
    fillValidForm(useCase)

    const result = await useCase.submit()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repository.created).toHaveLength(0)
  })

  it('表单校验未通过 → VALIDATION_FAILED，不发请求', async () => {
    const { repository, useCase } = createUseCase()
    // 只填标题，缺地点与时间
    useCase.setTitle('羽毛球')

    const result = await useCase.submit()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(useCase.getSnapshot().errors.length).toBeGreaterThan(0)
    expect(repository.created).toHaveLength(0)
  })

  it('说明里写联系方式 → 被拦下（规格 §6.4）', async () => {
    const { repository, useCase } = createUseCase()
    fillValidForm(useCase)
    useCase.setDescription('想来的加微信 abcdef123')

    const result = await useCase.submit()
    expect(result.ok).toBe(false)
    expect(repository.created).toHaveLength(0)
  })

  it('提交成功：本地时间按 +08:00 转成 UTC，且带 Idempotency-Key', async () => {
    __resetIdempotencyCounterForTests()
    const { repository, useCase } = createUseCase()
    fillValidForm(useCase)

    const result = await useCase.submit()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(buddyPost('bp-new').id)

    const created = repository.created[0]
    // 北京时间 2026-10-24 14:00 = 06:00Z（不依赖运行环境时区）
    expect(created?.body.startsAt).toBe('2026-10-24T06:00:00.000Z')
    expect(created?.body.tags).toEqual(['badminton'])
    expect(created?.body.capacity).toBe(4)
    expect(created?.idempotencyKey).toBeTruthy()
    expect(useCase.getSnapshot().status).toBe('submitted')
  })

  it('同一次表单内容重复提交**复用同一个幂等键**（弱网重试不会重复发帖）', async () => {
    __resetIdempotencyCounterForTests()
    const { repository, useCase } = createUseCase()
    fillValidForm(useCase)

    await useCase.submit()
    await useCase.submit()

    expect(repository.created).toHaveLength(2)
    expect(repository.created[1]?.idempotencyKey).toBe(repository.created[0]?.idempotencyKey)
  })

  it('改动表单后幂等键会变（否则改完再提交会被服务端当成重放）', async () => {
    __resetIdempotencyCounterForTests()
    const { repository, useCase } = createUseCase()
    fillValidForm(useCase)

    await useCase.submit()
    useCase.setTitle('换个标题')
    await useCase.submit()

    expect(repository.created[1]?.idempotencyKey).not.toBe(repository.created[0]?.idempotencyKey)
  })

  it('仓储失败 → error 态并保留表单内容', async () => {
    const { useCase } = createUseCase({ create: err(upstreamError('发布失败')) })
    fillValidForm(useCase)

    const result = await useCase.submit()
    expect(result.ok).toBe(false)
    const state = useCase.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('发布失败')
    expect(state.draft.title).not.toBe('')
  })

  it('`reset` 清空表单但保留已拉取的标签表', async () => {
    const { useCase } = createUseCase({ tags: [ok([buddyTag('badminton', { label: '羽毛球' })])] })
    await useCase.loadTags()
    fillValidForm(useCase)

    const state = useCase.reset()
    expect(state.draft.title).toBe('')
    expect(state.draft.tags).toEqual([])
    expect(state.tags).toHaveLength(1)
  })
})

describe('createBuddyPost · 日期/时间拼装', () => {
  it('`setStartDate` / `setStartTime` 拼成 `YYYY-MM-DDTHH:mm`', () => {
    const { useCase } = createUseCase()
    useCase.setStartTime('19:00')
    useCase.setStartDate('2026-10-24')
    expect(useCase.getSnapshot().draft.startsAtLocal).toBe('2026-10-24T19:00')

    useCase.setStartTime('08:30')
    expect(useCase.getSnapshot().draft.startsAtLocal).toBe('2026-10-24T08:30')
  })

  it('没选日期时只设时间不会造出非法字符串', () => {
    const { useCase } = createUseCase()
    expect(useCase.setStartTime('19:00').draft.startsAtLocal).toBe('')
  })
})
