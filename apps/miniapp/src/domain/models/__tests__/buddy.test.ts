import { describe, expect, it } from 'vitest'
import { overlapsAvailabilityMinutes } from '@kedaya/shared'

import {
  BUDDY_APPLICATION_STATUSES,
  BUDDY_POST_STATUSES,
  BUDDY_PRIVACY_POINTS,
  BUDDY_SECTIONS,
  BUDDY_TAGS,
  BUDDY_TAG_LIMITS,
  CAMPUS_AREAS,
  EMPTY_BUDDY_POST_DRAFT,
  SHTU_DEPARTMENTS,
  availabilityOverlapsPost,
  buddyRemainingSlots,
  buddyFillPercent,
  canApplyToPost,
  canTransitionApplication,
  canTransitionPost,
  describeAvailability,
  detectContactInfo,
  emptyBuddyProfile,
  formatMinuteOfDay,
  isBuddyPostExpired,
  isKnownArea,
  isValidAvailabilitySlot,
  normalizeAvailability,
  parseMinuteOfDay,
  parseShanghaiLocal,
  sectionOf,
  summarizeBuddyPost,
  validateBuddyPostDraft,
  validateBuddyProfile,
  validateTagKeys,
} from '../buddy'
import type { BuddyPost, BuddyProfile } from '../buddy'

/**
 * 找搭子领域模型测试。
 *
 * 三条**任务硬要求**的落点在这里：
 * 1. **封闭标签校验**（自由文本被拒）—— 规格 §3.2
 * 2. **可用时段边界（含跨零点）** —— 规格 §3.3 F7
 * 3. **状态机全矩阵** —— 规格 §2.8
 */

const NOW = new Date('2026-10-16T12:00:00.000Z') // 北京时间 2026-10-16 20:00（周五）

function post(overrides: Partial<BuddyPost> = {}): BuddyPost {
  return {
    id: 'bp-1',
    activity: 'sport',
    status: 'OPEN',
    title: '周六下午羽毛球',
    description: null,
    location: '体育馆',
    startsAt: '2026-10-24T06:00:00.000Z', // 北京时间 10-24 14:00（周六）
    durationMin: 120,
    capacity: 4,
    joinedCount: 2,
    genderPreference: 'any',
    tags: ['badminton'],
    minSkillLevel: null,
    creator: { id: 'u-other', nickname: '王同学', avatarUrl: null },
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    myApplication: null,
    ...overrides,
  }
}

function profile(overrides: Partial<BuddyProfile> = {}): BuddyProfile {
  return { ...emptyBuddyProfile('u-me'), ...overrides }
}

/* ------------------------------------------------------------------ *
 * 1. 板块（契约 §11.10-G：只有 academic / daily / sport，没有 dating）
 * ------------------------------------------------------------------ */

describe('buddy · 板块', () => {
  it('三板块就是 academic / daily / sport —— 明确没有 dating', () => {
    expect(BUDDY_SECTIONS).toEqual(['academic', 'daily', 'sport'])
    expect(BUDDY_SECTIONS).not.toContain('dating')
  })

  it('sectionOf 覆盖全部 6 个 activity（规格 §2.3 / 验收 T2）', () => {
    expect(sectionOf('study')).toBe('academic')
    expect(sectionOf('sport')).toBe('sport')
    expect(sectionOf('game')).toBe('sport')
    expect(sectionOf('meal')).toBe('daily')
    expect(sectionOf('travel')).toBe('daily')
    expect(sectionOf('other')).toBe('daily')
  })
})

/* ------------------------------------------------------------------ *
 * 2. 封闭标签表（**任务硬要求 1**：自由文本被拒）
 * ------------------------------------------------------------------ */

describe('buddy · 封闭标签校验（规格 §3.2）', () => {
  it('接受封闭表里已登记的 key', () => {
    const result = validateTagKeys(['badminton', 'canteen'], BUDDY_TAG_LIMITS.postTags)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(['badminton', 'canteen'])
    expect(result.error.unknown).toEqual([])
    expect(result.error.message).toBeNull()
  })

  it('**拒绝自由文本**，并给出 UNKNOWN_TAG 的依据（验收：自由文本被拒）', () => {
    // 这三个写法在自由文本体系里互不匹配 —— 正是规格 §3.2 要杜绝的
    for (const freeText of ['打羽毛球', 'badminton 球', '羽毛球!']) {
      const result = validateTagKeys([freeText], BUDDY_TAG_LIMITS.postTags)
      expect(result.ok).toBe(false)
      expect(result.error.unknown).toEqual([freeText])
      expect(result.error.message).toContain('未登记的标签')
      expect(result.value).toEqual([])
    }
  })

  it('自由文本与合法标签混在一起时，整体不通过（不能只取合法的那部分）', () => {
    const result = validateTagKeys(['badminton', '随便写点什么'], BUDDY_TAG_LIMITS.postTags)
    expect(result.ok).toBe(false)
    expect(result.error.unknown).toEqual(['随便写点什么'])
  })

  it('拒绝**已下架**的标签（规格 §3.2「下架标签不删除，但不允许新引用」）', () => {
    // ⚠️ 服务端的权威标签表当前**没有**下架条目（62 项全 active），
    // 因此这条分支用一个显式的表来验（`validateTagKeys` 的第三个参数），
    // 而不是在镜像里塞一条服务端不认的 key —— 那会让客户端提供后端拒收的标签。
    const table = [
      { key: 'badminton', label: '羽毛球', group: 'sport' as const, aliases: [], isActive: true },
      { key: 'legacy-tag', label: '旧标签', group: 'sport' as const, aliases: [], isActive: false },
    ]
    const result = validateTagKeys(['legacy-tag'], BUDDY_TAG_LIMITS.postTags, table)
    expect(result.ok).toBe(false)
    expect(result.error.inactive).toEqual(['legacy-tag'])
    expect(result.error.message).toContain('已下架')

    // 同一个 key 在默认表（服务端镜像）里是**未登记**，而不是"已下架"
    expect(validateTagKeys(['legacy-tag'], BUDDY_TAG_LIMITS.postTags).error.unknown).toEqual([
      'legacy-tag',
    ])
  })

  it('超出上限时 overflow 为 true（`BuddyPost.tags` ≤8）', () => {
    const active = BUDDY_TAGS.filter((tag) => tag.isActive).map((tag) => tag.key)
    const tooMany = active.slice(0, BUDDY_TAG_LIMITS.postTags + 1)
    const result = validateTagKeys(tooMany, BUDDY_TAG_LIMITS.postTags)
    expect(result.ok).toBe(false)
    expect(result.error.overflow).toBe(true)
    expect(result.error.message).toContain(`最多选择 ${BUDDY_TAG_LIMITS.postTags} 个标签`)
  })

  it('去重且忽略空白项', () => {
    const result = validateTagKeys(['badminton', 'badminton', '  ', ''], BUDDY_TAG_LIMITS.postTags)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(['badminton'])
  })

  it('标签表里没有任何属于「约会」的标签（与不做 dating 一致）', () => {
    const active = BUDDY_TAGS.filter((tag) => tag.isActive)
    expect(active.length).toBeGreaterThan(20)
    for (const tag of active) {
      expect(tag.key).not.toContain('dating')
      expect(tag.label).not.toContain('交友')
    }
  })

  it('镜像的标签表与**服务端权威表逐字一致**（62 项；防止两端各说各话）', () => {
    // 服务端 `services/api/src/modules/buddy/domain/tags.ts` 的 BUDDY_TAGS 是权威表。
    // 这里钉住它的规模与几个关键 key，任何一端单方面改动都会让本测试变红。
    expect(BUDDY_TAGS).toHaveLength(62)
    expect(BUDDY_TAGS.every((tag) => tag.isActive)).toBe(true)
    for (const key of ['badminton', 'gym', 'self-study', 'canteen', 'carpool', 'citywalk', 'chess']) {
      expect(BUDDY_TAGS.some((tag) => tag.key === key), key).toBe(true)
    }
    // 初版自拟、但服务端并不存在的 key 必须已经清掉
    for (const bogus of ['fitness', 'airport-pickup', 'grocery', 'badminton-indoor', 'course-help', 'paper-reading', 'dating-night']) {
      expect(BUDDY_TAGS.some((tag) => tag.key === bogus), bogus).toBe(false)
    }
  })

  it('地点白名单与**服务端权威表逐字一致**（25 项）', () => {
    expect(CAMPUS_AREAS).toHaveLength(25)
    for (const area of ['图书馆', '一食堂', '体育馆', '教学楼A', '张江地铁站']) {
      expect(isKnownArea(area), area).toBe(true)
    }
    // 初版自拟、但服务端不存在的地点必须已经清掉
    for (const bogus of ['教学中心', '行政楼', '科研楼', '学生宿舍区']) {
      expect(isKnownArea(bogus), bogus).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 3. 状态机（规格 §2.8，全矩阵）
 * ------------------------------------------------------------------ */

describe('buddy · 状态机（规格 §2.8）', () => {
  it('canTransitionPost 覆盖 5×5 全矩阵，与冻结状态图逐字一致', () => {
    // 期望的合法转移（契约 02-domain-model.md:535-548）
    const legal: Record<string, string[]> = {
      OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
      FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
      CLOSED: [],
      EXPIRED: [],
      CANCELLED: [],
    }

    for (const from of BUDDY_POST_STATUSES) {
      for (const to of BUDDY_POST_STATUSES) {
        const expected = (legal[from] ?? []).includes(to)
        expect(canTransitionPost(from, to), `${from} → ${to}`).toBe(expected)
      }
    }
  })

  it('状态机没有自环（from === to 一律 false）', () => {
    for (const status of BUDDY_POST_STATUSES) {
      expect(canTransitionPost(status, status)).toBe(false)
    }
  })

  it('申请状态机：PENDING 三个出口 + WITHDRAWN 可重新申请（规格 §2.8 / 未决 U7）', () => {
    expect(canTransitionApplication('PENDING', 'ACCEPTED')).toBe(true)
    expect(canTransitionApplication('PENDING', 'REJECTED')).toBe(true)
    expect(canTransitionApplication('PENDING', 'WITHDRAWN')).toBe(true)
    expect(canTransitionApplication('WITHDRAWN', 'PENDING')).toBe(true)
    expect(canTransitionApplication('ACCEPTED', 'PENDING')).toBe(false)
    expect(canTransitionApplication('REJECTED', 'WITHDRAWN')).toBe(false)
    expect(BUDDY_APPLICATION_STATUSES).toEqual(['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'])
  })
})

/* ------------------------------------------------------------------ *
 * 4. 派生状态与摘要（契约 §11.10-D 的 joinedCount 语义）
 * ------------------------------------------------------------------ */

describe('buddy · 派生状态与摘要', () => {
  it('joinedCount 含发起人：capacity=4 且 joined=4 → FULL，剩余 0', () => {
    const full = post({ capacity: 4, joinedCount: 4 })
    expect(summarizeBuddyPost(full, NOW).status).toBe('FULL')
    expect(buddyRemainingSlots(full)).toBe(0)
  })

  it('startsAt 已过 → EXPIRED；显式终态不被推导覆盖', () => {
    expect(summarizeBuddyPost(post({ startsAt: '2026-10-15T06:00:00.000Z' }), NOW).status).toBe(
      'EXPIRED',
    )
    expect(isBuddyPostExpired(post({ startsAt: '2026-10-15T06:00:00.000Z' }), NOW)).toBe(true)
    expect(
      summarizeBuddyPost(
        post({ status: 'CLOSED', startsAt: '2026-10-15T06:00:00.000Z' }),
        NOW,
      ).status,
    ).toBe('CLOSED')
  })

  it('摘要把标签 key 翻成中文，并给出本地时间文案', () => {
    const summary = summarizeBuddyPost(post({ tags: ['badminton', 'gym'] }), NOW)
    expect(summary.tagLabels).toEqual(['羽毛球', '健身'])
    expect(summary.section).toBe('sport')
    expect(summary.startsAtLabel).toContain('14:00')
  })

  it('名额填充百分比：正常取整、超额夹到 100、capacity=0 不是 NaN', () => {
    expect(buddyFillPercent({ capacity: 6, joinedCount: 3 })).toBe(50)
    expect(buddyFillPercent({ capacity: 3, joinedCount: 1 })).toBe(33)
    // 超额（后端允许小幅超员）→ 夹到 100，进度条不会撑破容器
    expect(buddyFillPercent({ capacity: 4, joinedCount: 5 })).toBe(100)
    // 老数据 capacity=0：返回 0 而不是 NaN（"算不出来"与"没人报名"要区分开）
    expect(buddyFillPercent({ capacity: 0, joinedCount: 2 })).toBe(0)
    expect(summarizeBuddyPost(post({ capacity: 6, joinedCount: 3 }), NOW).fillPercent).toBe(50)
  })
})

/* ------------------------------------------------------------------ *
 * 5. 申请资格（F1–F6）
 * ------------------------------------------------------------------ */

describe('buddy · 申请资格（规格 §3.3 F1–F6）', () => {
  it('未登录 → not-logged-in', () => {
    const result = canApplyToPost(post(), null, NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('not-logged-in')
  })

  it('自己的帖子 → own-post（F3）', () => {
    const mine = post({ creator: { id: 'u-me', nickname: '我', avatarUrl: null } })
    const result = canApplyToPost(mine, 'u-me', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('own-post')
  })

  it('已申请（PENDING / ACCEPTED）→ already-applied（F4）', () => {
    const applied = post({
      myApplication: {
        id: 'ba-1',
        postId: 'bp-1',
        applicantId: 'u-me',
        applicantName: '我',
        message: null,
        status: 'PENDING',
        createdAt: NOW.toISOString(),
        decidedAt: null,
      },
    })
    const result = canApplyToPost(applied, 'u-me', NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('already-applied')
  })

  it('已满 / 已过期 / 已关闭 分别给出对应原因（F1 / F2）', () => {
    const full = canApplyToPost(post({ joinedCount: 4 }), 'u-me', NOW)
    expect(full.allowed).toBe(false)
    if (!full.allowed) expect(full.reason).toBe('full')

    const expired = canApplyToPost(post({ startsAt: '2026-10-15T06:00:00.000Z' }), 'u-me', NOW)
    expect(expired.allowed).toBe(false)
    if (!expired.allowed) expect(expired.reason).toBe('expired')

    const closed = canApplyToPost(post({ status: 'CLOSED' }), 'u-me', NOW)
    expect(closed.allowed).toBe(false)
    if (!closed.allowed) expect(closed.reason).toBe('not-open')
  })

  it('运动水平低于 minSkillLevel → skill-too-low（F6，仅 sport）', () => {
    const result = canApplyToPost(post({ minSkillLevel: 'competitive' }), 'u-me', NOW, {
      mySkillLevel: 'regular',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('skill-too-low')
  })

  it('正常情况允许申请', () => {
    expect(canApplyToPost(post(), 'u-me', NOW).allowed).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 6. 可用时段（**任务硬要求 2**：边界 + 跨零点）
 * ------------------------------------------------------------------ */

describe('buddy · 可用时段（规格 §3.3 F7）', () => {
  const MON_1800_2200 = { dow: 1, startMin: 18 * 60, endMin: 22 * 60 }
  const TUE_0000_0200 = { dow: 2, startMin: 0, endMin: 2 * 60 }

  it('时段合法性：dow 0–6、分钟 0–1439、endMin > startMin', () => {
    expect(isValidAvailabilitySlot(MON_1800_2200)).toBe(true)
    expect(isValidAvailabilitySlot({ dow: 7, startMin: 0, endMin: 60 })).toBe(false)
    expect(isValidAvailabilitySlot({ dow: -1, startMin: 0, endMin: 60 })).toBe(false)
    expect(isValidAvailabilitySlot({ dow: 1, startMin: 0, endMin: 1440 })).toBe(false)
    // endMin === startMin 不是"零长度时段"，是非法输入
    expect(isValidAvailabilitySlot({ dow: 1, startMin: 600, endMin: 600 })).toBe(false)
    expect(isValidAvailabilitySlot({ dow: 1, startMin: 600, endMin: 599 })).toBe(false)
  })

  it('**跨零点**：周一 23:30 开始、踢 90 分钟，命中「周二 00:00–02:00」的时段', () => {
    // 周一 23:30 北京时间 = 2026-10-19T15:30:00Z（2026-10-19 是周一）
    const mondayLate = post({ startsAt: '2026-10-19T15:30:00.000Z', durationMin: 90 })
    expect(availabilityOverlapsPost([TUE_0000_0200], mondayLate)).toBe(true)

    // 同一活动与「周一 18:00–22:00」不相交 —— 活动从 23:30 才开始
    expect(availabilityOverlapsPost([MON_1800_2200], mondayLate)).toBe(false)
  })

  it('跨零点边界：周一 22:30 开始、90 分钟正好到 24:00 —— **不算**进入周二', () => {
    const mondayToMidnight = post({ startsAt: '2026-10-19T14:30:00.000Z', durationMin: 90 })
    // 窗口 [1350, 1440) 与周二 [2880, 3000) 不相交
    expect(availabilityOverlapsPost([TUE_0000_0200], mondayToMidnight)).toBe(false)
    // 但确实落在周一 18:00–23:00 里
    expect(availabilityOverlapsPost([{ dow: 1, startMin: 1080, endMin: 1380 }], mondayToMidnight)).toBe(
      true,
    )
  })

  it('纯函数层面直接验证「周内分钟数」的跨零点判定', () => {
    // 周一 23:30 = 1*1440 + 1410 = 2850；+90 分钟 = 2940（落在周二）
    expect(overlapsAvailabilityMinutes([TUE_0000_0200], 1 * 1440 + 1410, 90)).toBe(true)
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 1410, 90)).toBe(false)
    // 恰好相接（22:00–23:00 的时段 vs 20:00+120 分钟结束于 22:00）不算重叠
    expect(overlapsAvailabilityMinutes([{ dow: 1, startMin: 1320, endMin: 1380 }], 1 * 1440 + 1200, 120)).toBe(
      false,
    )
    // 空时段 / 非正时长
    expect(overlapsAvailabilityMinutes([], 1 * 1440 + 1200, 60)).toBe(false)
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 1200, 0)).toBe(false)
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 1200, -30)).toBe(false)
  })

  it('没有可用时段 → 一律不重叠（F7 会把这些活动全部过滤掉）', () => {
    expect(availabilityOverlapsPost([], post())).toBe(false)
  })

  it('`durationMin` 为 null 时按 DEFAULT_DURATION_MIN(60) 处理', () => {
    const at2000 = post({ startsAt: '2026-10-19T12:00:00.000Z', durationMin: null })
    // 周一 20:00 + 60 → 21:00，落在 18:00–22:00 内
    expect(availabilityOverlapsPost([MON_1800_2200], at2000)).toBe(true)

    // ⚠️ 重叠判定是**相交**，不是「包含」：
    // 周一 21:30 + 60 → 窗口 21:30–22:30，与 18:00–22:00 相交（21:30–22:00 那段），
    // 因此**算**重叠 —— 早先版本的断言在这里写错了，是测试的错，不是实现的错。
    const at2130 = post({ startsAt: '2026-10-19T13:30:00.000Z', durationMin: null })
    expect(availabilityOverlapsPost([MON_1800_2200], at2130)).toBe(true)

    // 真正不相交的是「从 22:00 才开始」：窗口 22:00–23:00 与 18:00–22:00 只是**相接**
    const at2200 = post({ startsAt: '2026-10-19T14:00:00.000Z', durationMin: null })
    expect(availabilityOverlapsPost([MON_1800_2200], at2200)).toBe(false)
  })

  it('normalizeAvailability 去掉非法项、去重并按 dow/startMin 排序', () => {
    const normalized = normalizeAvailability([
      { dow: 3, startMin: 600, endMin: 700 },
      { dow: 1, startMin: 1080, endMin: 1200 },
      { dow: 1, startMin: 1080, endMin: 1200 },
      { dow: 9, startMin: 0, endMin: 60 },
      { dow: 2, startMin: 700, endMin: 700 },
    ])
    expect(normalized).toEqual([
      { dow: 1, startMin: 1080, endMin: 1200 },
      { dow: 3, startMin: 600, endMin: 700 },
    ])
  })

  it('describeAvailability 生成「周一 18:00–22:00」这类文案', () => {
    expect(describeAvailability([MON_1800_2200, TUE_0000_0200])).toEqual([
      '周一 18:00–22:00',
      '周二 00:00–02:00',
    ])
  })

  it('分钟 ↔ HH:mm 互转', () => {
    expect(formatMinuteOfDay(18 * 60)).toBe('18:00')
    expect(formatMinuteOfDay(0)).toBe('00:00')
    expect(formatMinuteOfDay(1439)).toBe('23:59')
    expect(parseMinuteOfDay('18:00')).toBe(1080)
    expect(parseMinuteOfDay('23:59')).toBe(1439)
    expect(parseMinuteOfDay('24:00')).toBeNull()
    expect(parseMinuteOfDay('18:60')).toBeNull()
    expect(parseMinuteOfDay('abc')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 7. 匹配资料校验（规格 §2.2 / §6.3）
 * ------------------------------------------------------------------ */

describe('buddy · 匹配资料校验', () => {
  it('默认资料是 matchEnabled=false 且无时段（规格 §6.3：不默认参与）', () => {
    const empty = emptyBuddyProfile('u-me')
    expect(empty.matchEnabled).toBe(false)
    expect(empty.availability).toEqual([])
    expect(empty.sections).toEqual([])
  })

  it('开启匹配但没选板块 → 校验失败', () => {
    const result = validateBuddyProfile(profile({ matchEnabled: true, sections: [] }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'sections')).toBe(true)
  })

  it('兴趣标签超过 20 项 → 失败；活动标签超过 10 项 → 失败', () => {
    // ⚠️ 必须用**互不相同**的 key：`validateTagKeys` 会去重，
    // 21 个重复的 'badminton' 其实是 1 项（这是正确的，不是 bug）。
    const activeKeys = BUDDY_TAGS.filter((tag) => tag.isActive).map((tag) => tag.key)

    const manyInterests = activeKeys.slice(0, BUDDY_TAG_LIMITS.interestTags + 1)
    expect(manyInterests).toHaveLength(21)
    const result = validateBuddyProfile(profile({ interestTags: manyInterests }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'interestTags')).toBe(true)

    const manyActivities = activeKeys.slice(0, BUDDY_TAG_LIMITS.activityTags + 1)
    expect(manyActivities).toHaveLength(11)
    const result2 = validateBuddyProfile(profile({ activityTags: manyActivities }))
    expect(result2.ok).toBe(false)
    expect(result2.errors.some((e) => e.field === 'activityTags')).toBe(true)

    // 恰好等于上限是允许的
    expect(
      validateBuddyProfile(
        profile({ interestTags: activeKeys.slice(0, BUDDY_TAG_LIMITS.interestTags) }),
      ).ok,
    ).toBe(true)
  })

  it('时段非法 → 失败（F7 的输入不能被污染）', () => {
    const result = validateBuddyProfile(
      profile({ availability: [{ dow: 1, startMin: 1200, endMin: 600 }] }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'availability')).toBe(true)
  })

  it('常去区域超过 5 项或不在白名单 → 失败', () => {
    const tooMany = validateBuddyProfile(
      profile({ preferredAreas: ['图书馆', '体育馆', '一食堂', '二食堂', '三食堂', '田径场'] }),
    )
    expect(tooMany.ok).toBe(false)
    expect(tooMany.errors.some((e) => e.field === 'preferredAreas')).toBe(true)

    const unknown = validateBuddyProfile(profile({ preferredAreas: ['不存在的地方'] }))
    expect(unknown.ok).toBe(false)
    expect(unknown.errors.some((e) => e.field === 'preferredAreas')).toBe(true)
  })

  it('自述里写联系方式 → 失败（规格 §6.4）', () => {
    const result = validateBuddyProfile(profile({ bio: '加我微信 abcdef123 一起打球' }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'bio')).toBe(true)
  })

  it('合法资料通过校验', () => {
    expect(validateBuddyProfile(profile({ matchEnabled: true, sections: ['sport'] })).ok).toBe(true)
  })

  it('院系清单是封闭的（规格 §3.3 用院系而不是专业）', () => {
    expect(SHTU_DEPARTMENTS.length).toBeGreaterThan(5)
    expect(SHTU_DEPARTMENTS).toContain('信息科学与技术学院')
  })
})

/* ------------------------------------------------------------------ *
 * 8. 联系方式检测（规格 §6.4）—— 并验证「不误报日期」
 * ------------------------------------------------------------------ */

describe('buddy · 联系方式检测（规格 §6.4）', () => {
  it('识别手机号 / 微信 / QQ', () => {
    expect(detectContactInfo('打我电话 13800138000')?.kind).toBe('mobile')
    expect(detectContactInfo('微信: abcdef123')?.kind).toBe('wechat')
    expect(detectContactInfo('vx：abcdef123')?.kind).toBe('wechat')
    expect(detectContactInfo('QQ 123456789')?.kind).toBe('qq')
  })

  it('**不误报**正常的日期 / 时间文本（刻意不复用 containsLikelyPii 的 8 位数字规则）', () => {
    expect(detectContactInfo('2026年10月24日周六下午两点，体育馆3号场')).toBeNull()
    expect(detectContactInfo('20261024 出发')).toBeNull()
    expect(detectContactInfo('缺 2 人，打两小时')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 9. 发布表单校验（规格 §5.4）
 * ------------------------------------------------------------------ */

describe('buddy · 发布表单校验', () => {
  it('空表单把所有必填项都报出来', () => {
    const errors = validateBuddyPostDraft(EMPTY_BUDDY_POST_DRAFT, NOW)
    const fields = errors.map((e) => e.field)
    expect(fields).toContain('title')
    expect(fields).toContain('location')
    expect(fields).toContain('startsAtLocal')
  })

  it('活动时间必须晚于当前时间', () => {
    const draft = {
      ...EMPTY_BUDDY_POST_DRAFT,
      title: '羽毛球',
      location: '体育馆',
      startsAtLocal: '2026-10-15T19:00',
      tags: ['badminton'],
    }
    const errors = validateBuddyPostDraft(draft, NOW)
    expect(errors.some((e) => e.field === 'startsAtLocal')).toBe(true)
  })

  it('人数必须在 2–20（含发起人，契约 §11.10-D）', () => {
    const base = {
      ...EMPTY_BUDDY_POST_DRAFT,
      title: '羽毛球',
      location: '体育馆',
      startsAtLocal: '2026-10-24T14:00',
      tags: ['badminton'],
    }
    expect(validateBuddyPostDraft({ ...base, capacity: 1 }, NOW).some((e) => e.field === 'capacity')).toBe(
      true,
    )
    expect(validateBuddyPostDraft({ ...base, capacity: 21 }, NOW).some((e) => e.field === 'capacity')).toBe(
      true,
    )
    expect(validateBuddyPostDraft({ ...base, capacity: 4 }, NOW)).toEqual([])
  })

  it('地点必须在校园地点白名单里', () => {
    expect(isKnownArea('体育馆')).toBe(true)
    expect(isKnownArea('某个不存在的地方')).toBe(false)
  })

  it('说明里写联系方式被拦下（CONTACT_INFO 的客户端预校验）', () => {
    const errors = validateBuddyPostDraft(
      {
        ...EMPTY_BUDDY_POST_DRAFT,
        title: '羽毛球',
        location: '体育馆',
        startsAtLocal: '2026-10-24T14:00',
        tags: ['badminton'],
        description: '想来的加微信 abcdef123',
      },
      NOW,
    )
    expect(errors.some((e) => e.field === 'description')).toBe(true)
  })

  it('自由文本标签在表单层就被拒（与封闭标签表一致）', () => {
    const errors = validateBuddyPostDraft(
      {
        ...EMPTY_BUDDY_POST_DRAFT,
        title: '羽毛球',
        location: '体育馆',
        startsAtLocal: '2026-10-24T14:00',
        tags: ['打羽毛球'],
      },
      NOW,
    )
    expect(errors.some((e) => e.field === 'tags')).toBe(true)
  })

  it('运动水平要求只适用于 sport 板块', () => {
    const errors = validateBuddyPostDraft(
      {
        ...EMPTY_BUDDY_POST_DRAFT,
        activity: 'study',
        title: '自习',
        location: '图书馆',
        startsAtLocal: '2026-10-20T19:00',
        tags: ['self-study'],
        minSkillLevel: 'regular',
      },
      NOW,
    )
    expect(errors.some((e) => e.field === 'minSkillLevel')).toBe(true)
  })

  it('parseShanghaiLocal 按 +08:00 解析（不依赖运行环境时区）', () => {
    expect(parseShanghaiLocal({ date: '2026-10-24', time: '14:00' })?.toISOString()).toBe(
      '2026-10-24T06:00:00.000Z',
    )
    expect(parseShanghaiLocal({ date: 'bad', time: '14:00' })).toBeNull()
    expect(parseShanghaiLocal({ date: '2026-10-24', time: '25:00' })).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 10. 隐私提示（规格 §6，**硬要求**）
 * ------------------------------------------------------------------ */

describe('buddy · 隐私提示内容（规格 §6）', () => {
  it('三句话都在：资料不展示给他人 / 联系方式经站内信 / 资料可撤回', () => {
    expect(BUDDY_PRIVACY_POINTS).toHaveLength(3)
    expect(BUDDY_PRIVACY_POINTS[0]).toContain('不对任何人展示')
    expect(BUDDY_PRIVACY_POINTS[1]).toContain('站内信')
    expect(BUDDY_PRIVACY_POINTS[2]).toContain('撤回')
  })
})
