import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createBuddyProfileUseCase } from '../buddyProfile'
import type { BuddyProfileDeps } from '../buddyProfile'
import { BUDDY_TAGS } from '../../../domain/models/buddy'
import {
  TEST_NOW_ISO,
  buddyProfile,
  buddyTag,
  createFakeBuddyRepository,
  createFakeCache,
  createFakeSessionStore,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 「我的匹配资料」用例测试 —— 规格 §2.2 / §6.3。
 *
 * 两条最重要的断言：
 * 1. **可用时段真的能填**（F7 硬过滤的唯一数据来源）；
 * 2. **撤回是真的**：`withdraw()` 必须调用 `DELETE /buddy/profile`
 *    并把本地资料清空 —— 撤回不做实就是虚假的隐私承诺。
 */

function createUseCase(
  options: Parameters<typeof createFakeBuddyRepository>[0] = {},
  session = createFakeSessionStore(),
  cacheSeed?: Record<string, unknown>,
) {
  const repository = createFakeBuddyRepository(options)
  const cache = createFakeCache(cacheSeed)
  const deps: BuddyProfileDeps = {
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    session,
    cacheKey: 'buddy:profile',
  }
  return { repository, cache, useCase: createBuddyProfileUseCase(deps) }
}

describe('buddyProfile · 契约 §8 hydrate', () => {
  it('hydrate 同步恢复缓存资料（不碰网络）', () => {
    const { repository, useCase } = createUseCase({}, createFakeSessionStore(), {
      'buddy:profile': { profile: buddyProfile({ department: '生命科学与技术学院' }), updatedAt: TEST_NOW_ISO },
    })

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.profile.department).toBe('生命科学与技术学院')
    expect(state.exists).toBe(true)
    expect(repository.putProfiles).toHaveLength(0)
  })

  it('缓存为空 → 保持 idle，不编造数据', () => {
    const { useCase } = createUseCase()
    expect(useCase.hydrate().status).toBe('idle')
  })
})

describe('buddyProfile · 读取', () => {
  it('服务端有资料 → ready + exists=true', async () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile()) })
    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.exists).toBe(true)
    expect(state.profile.matchEnabled).toBe(true)
  })

  it('服务端返回 null（还没填过）→ ready + exists=false + 空资料（**不是错误**）', async () => {
    const { useCase } = createUseCase({ profile: ok(null) })
    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.exists).toBe(false)
    expect(state.profile.matchEnabled).toBe(false)
    expect(state.profile.availability).toEqual([])
  })

  it('读取失败且无缓存 → error 态', async () => {
    const { useCase } = createUseCase({ profile: err(upstreamError('资料服务不可用')) })
    const state = await useCase.load()
    expect(state.status).toBe('error')
    expect(state.error).toBe('资料服务不可用')
  })

  it('loadTags 从服务端取封闭标签表（资料页的标签也必须从这里选）', async () => {
    const { useCase } = createUseCase({ tags: [ok([buddyTag('badminton', { label: '羽毛球' })])] })
    const state = await useCase.loadTags()
    expect(state.tags).toHaveLength(1)
    expect(state.tagsError).toBeNull()
  })
})

describe('buddyProfile · 编辑（含 F7 的可用时段）', () => {
  it('板块可以多选/取消，且顺序始终是**契约的规范顺序**（academic/daily/sport）', () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile({ sections: [] })) })
    void useCase.load()
    useCase.toggleSection('sport')
    useCase.toggleSection('academic')
    // 先点 sport 再点 academic，结果仍是规范顺序 —— 顺序不随点击次序漂移，
    // 否则保存到服务端的数组会因操作顺序不同而不同（无意义的 diff）。
    expect(useCase.getSnapshot().profile.sections).toEqual(['academic', 'sport'])
    expect(useCase.toggleSection('sport').profile.sections).toEqual(['academic'])
  })

  it('兴趣标签上限 20、活动标签上限 10（超限给出错误且不加入）', async () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile({ interestTags: [], activityTags: [] })) })
    await useCase.load()

    const activeKeys = BUDDY_TAGS.filter((tag) => tag.isActive).map((tag) => tag.key)
    for (const key of activeKeys.slice(0, 20)) useCase.toggleInterestTag(key)
    expect(useCase.getSnapshot().profile.interestTags).toHaveLength(20)
    const overflow = useCase.toggleInterestTag(activeKeys[20] ?? '')
    expect(overflow.profile.interestTags).toHaveLength(20)
    expect(overflow.error).toContain('最多选择 20 个标签')

    for (const key of activeKeys.slice(0, 10)) useCase.toggleActivityTag(key)
    expect(useCase.getSnapshot().profile.activityTags).toHaveLength(10)
    const overflow2 = useCase.toggleActivityTag(activeKeys[10] ?? '')
    expect(overflow2.error).toContain('最多选择 10 个标签')
  })

  it('**可用时段能填**：合法时段被加入并规范化排序', async () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile({ availability: [] })) })
    await useCase.load()

    useCase.addAvailabilitySlot({ dow: 3, startMin: 19 * 60, endMin: 21 * 60 })
    useCase.addAvailabilitySlot({ dow: 1, startMin: 18 * 60, endMin: 22 * 60 })
    // 重复项会被去重
    useCase.addAvailabilitySlot({ dow: 1, startMin: 18 * 60, endMin: 22 * 60 })

    expect(useCase.getSnapshot().profile.availability).toEqual([
      { dow: 1, startMin: 1080, endMin: 1320 },
      { dow: 3, startMin: 1140, endMin: 1260 },
    ])
  })

  it('非法时段（结束早于开始）被丢弃，不会污染 F7 的输入', async () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile({ availability: [] })) })
    await useCase.load()
    useCase.addAvailabilitySlot({ dow: 1, startMin: 1200, endMin: 600 })
    expect(useCase.getSnapshot().profile.availability).toEqual([])
  })

  it('删除单个时段 / 清空全部时段', async () => {
    const { useCase } = createUseCase({
      profile: ok(
        buddyProfile({
          availability: [
            { dow: 1, startMin: 1080, endMin: 1320 },
            { dow: 3, startMin: 1080, endMin: 1320 },
          ],
        }),
      ),
    })
    await useCase.load()

    expect(useCase.removeAvailabilitySlot(0).profile.availability).toEqual([
      { dow: 3, startMin: 1080, endMin: 1320 },
    ])
    expect(useCase.clearAvailability().profile.availability).toEqual([])
  })

  it('常去区域上限 5', async () => {
    const { useCase } = createUseCase({ profile: ok(buddyProfile({ preferredAreas: [] })) })
    await useCase.load()
    for (const area of ['图书馆', '体育馆', '一食堂', '二食堂', '三食堂']) {
      useCase.togglePreferredArea(area)
    }
    expect(useCase.getSnapshot().profile.preferredAreas).toHaveLength(5)
    const overflow = useCase.togglePreferredArea('田径场')
    expect(overflow.profile.preferredAreas).toHaveLength(5)
    expect(overflow.error).toContain('最多选 5 个')
  })

  it('自述清空时存 null 而不是空字符串', () => {
    const { useCase } = createUseCase()
    expect(useCase.setBio('常打羽毛球').profile.bio).toBe('常打羽毛球')
    expect(useCase.setBio('').profile.bio).toBeNull()
  })

  it('匹配开关默认关闭，可显式打开', () => {
    const { useCase } = createUseCase()
    expect(useCase.getSnapshot().profile.matchEnabled).toBe(false)
    expect(useCase.setMatchEnabled(true).profile.matchEnabled).toBe(true)
  })
})

describe('buddyProfile · 保存（规格 §2.2）', () => {
  it('开启匹配但没选板块 → VALIDATION_FAILED，不发请求', async () => {
    const { repository, useCase } = createUseCase({ profile: ok(null) })
    await useCase.load()
    useCase.setMatchEnabled(true)

    const result = await useCase.save()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(useCase.getSnapshot().errors.some((e) => e.field === 'sections')).toBe(true)
    expect(repository.putProfiles).toHaveLength(0)
  })

  it('保存成功 → 写仓储 + 写缓存 + exists=true', async () => {
    const { repository, cache, useCase } = createUseCase({
      profile: ok(null),
      putProfile: ok(buddyProfile({ department: '信息科学与技术学院' })),
    })
    await useCase.load()
    useCase.setMatchEnabled(true)
    useCase.toggleSection('sport')
    useCase.toggleActivityTag('badminton')

    const result = await useCase.save()
    expect(result.ok).toBe(true)

    const call = repository.putProfiles[0]
    expect(call?.profile.sections).toEqual(['sport'])
    expect(call?.profile.activityTags).toEqual(['badminton'])
    expect(call?.idempotencyKey).toBeTruthy()
    expect(useCase.getSnapshot().exists).toBe(true)
    expect(cache.read('buddy:profile')).not.toBeNull()
  })

  it('未登录 → UNAUTHENTICATED，不发请求', async () => {
    const { repository, useCase } = createUseCase({}, createFakeSessionStore(null))
    const result = await useCase.save()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repository.putProfiles).toHaveLength(0)
  })

  it('仓储失败 → 保留本地编辑内容，只挂错误', async () => {
    const { useCase } = createUseCase({
      profile: ok(null),
      putProfile: err(upstreamError('保存失败')),
    })
    await useCase.load()
    useCase.setMatchEnabled(true)
    useCase.toggleSection('sport')

    const result = await useCase.save()
    expect(result.ok).toBe(false)
    const state = useCase.getSnapshot()
    expect(state.error).toBe('保存失败')
    expect(state.profile.sections).toEqual(['sport'])
    expect(state.exists).toBe(false)
  })
})

describe('buddyProfile · 撤回（规格 §6.3，**硬要求**）', () => {
  it('withdraw 调用 DELETE /buddy/profile，清空本地资料并置 withdrawn', async () => {
    const { repository, cache, useCase } = createUseCase({ profile: ok(buddyProfile()) })
    await useCase.load()
    expect(useCase.getSnapshot().exists).toBe(true)

    const result = await useCase.withdraw()

    expect(result.ok).toBe(true)
    expect(repository.deleteProfileCalls).toBe(1)
    const state = useCase.getSnapshot()
    expect(state.exists).toBe(false)
    expect(state.withdrawn).toBe(true)
    expect(state.profile.interestTags).toEqual([])
    expect(state.profile.availability).toEqual([])
    expect(state.profile.matchEnabled).toBe(false)
    // 本地缓存也要清掉，否则下次 hydrate 会把"已撤回"的资料又渲染出来
    expect(cache.read('buddy:profile')).toEqual({ profile: null, updatedAt: TEST_NOW_ISO })
  })

  it('撤回失败 → 不谎报成功', async () => {
    const { useCase } = createUseCase({
      profile: ok(buddyProfile()),
      deleteProfile: err(upstreamError('删除失败')),
    })
    await useCase.load()

    const result = await useCase.withdraw()
    expect(result.ok).toBe(false)
    const state = useCase.getSnapshot()
    expect(state.withdrawn).toBe(false)
    expect(state.exists).toBe(true)
    expect(state.error).toBe('删除失败')
  })

  it('未登录 → UNAUTHENTICATED，不发请求', async () => {
    const { repository, useCase } = createUseCase({}, createFakeSessionStore(null))
    const result = await useCase.withdraw()
    expect(result.ok).toBe(false)
    expect(repository.deleteProfileCalls).toBe(0)
  })
})
