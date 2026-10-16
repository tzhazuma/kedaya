import type {
  BuddyApplication,
  BuddyPost,
  BuddyProfile,
  BuddySection,
} from '../../domain/models/buddy'
import type { FeedbackAction } from '@kedaya/shared'
import { MOCK_NOW_ISO } from './fixtures'

/**
 * 找搭子 mock 种子数据 —— 契约 §7 硬规则 4：「必须有 mock adapter，让 UI 在无后端时开发」。
 *
 * 设计约束（与其它模块的 mock 一致）：
 * - **确定性**：所有时间相对 `MOCK_NOW_ISO`（= 北京时间 2026-10-16 20:00，周五）推算；
 *   基准值**从 `./fixtures` 复用**，而不是各写一份 ——
 *   两处都 `export const MOCK_NOW_ISO` 会让 `data/mock/index.ts` 的 `export *`
 *   产生导出歧义（TS2308），消费方可能拿到不想要的那一个。
 * - **覆盖三态**：招募中 / 已满员 / 已关闭 / 已过期都有种子，
 *   列表页因此天然能看到不同状态的卡片；
 * - **覆盖硬过滤**：种子里**刻意**各放一条会被 F1–F7 排除的候选，
 *   这样「推荐页为什么少了一条」是可解释的，而不是靠猜（规格 §3.3）。
 */

/** mock 世界的「现在」—— 与其它模块共用同一基准 */
export function buddyMockNow(): Date {
  return new Date(MOCK_NOW_ISO)
}

/**
 * 把「北京时间的某天某时刻」写成 ISO-8601 UTC 字符串。
 * 显式带 `+08:00` 偏移，避免依赖运行环境的本地时区（CI 可能是 UTC）。
 */
export function shanghai(localDateTime: string): string {
  return new Date(`${localDateTime}+08:00`).toISOString()
}

function shiftHours(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString()
}

/* ------------------------------------------------------------------ *
 * 发起人 / 我 的匹配资料（推荐算分的输入）
 * ------------------------------------------------------------------ */

/** 我（`u-me`，与 `MOCK_PROFILE.id` 一致） */
export const MOCK_MY_BUDDY_PROFILE: BuddyProfile = {
  userId: 'u-me',
  sections: ['academic', 'daily', 'sport'],
  interestTags: ['programming', 'music', 'gaming'],
  activityTags: ['badminton', 'canteen', 'self-study'],
  skillLevel: 'regular',
  /**
   * 可用时段：工作日 18:00–23:00 + 周末 08:00–23:00。
   * `dow` 约定 **0=周日 … 6=周六**（与 `@kedaya/shared` 的 `AvailabilitySlot` 一致）。
   * 这是 F7 硬过滤的输入 —— 种子里有活动落在这些窗口之外，用来演示 F7。
   */
  availability: [
    { dow: 1, startMin: 18 * 60, endMin: 23 * 60 },
    { dow: 2, startMin: 18 * 60, endMin: 23 * 60 },
    { dow: 3, startMin: 18 * 60, endMin: 23 * 60 },
    { dow: 4, startMin: 18 * 60, endMin: 23 * 60 },
    { dow: 5, startMin: 18 * 60, endMin: 23 * 60 },
    { dow: 6, startMin: 8 * 60, endMin: 23 * 60 },
    { dow: 0, startMin: 8 * 60, endMin: 23 * 60 },
  ],
  preferredAreas: ['体育馆', '图书馆'],
  department: '信息科学与技术学院',
  bio: '常打羽毛球，也常泡图书馆',
  matchEnabled: true,
  updatedAt: shiftHours(MOCK_NOW_ISO, -30),
}

/** 其它同学的匹配资料 —— 推荐算法里作为 `MatchTarget.creator`（规格 §3.4） */
export const MOCK_BUDDY_PROFILES: readonly BuddyProfile[] = [
  MOCK_MY_BUDDY_PROFILE,
  {
    userId: 'u-0001',
    sections: ['sport', 'daily'],
    interestTags: ['gaming', 'music'],
    activityTags: ['badminton', 'running', 'canteen'],
    skillLevel: 'regular',
    availability: [{ dow: 1, startMin: 18 * 60, endMin: 22 * 60 }],
    preferredAreas: ['体育馆'],
    department: '信息科学与技术学院',
    bio: null,
    matchEnabled: true,
    updatedAt: shiftHours(MOCK_NOW_ISO, -20),
  },
  {
    userId: 'u-0002',
    sections: ['academic', 'daily'],
    interestTags: ['reading', 'music'],
    activityTags: ['self-study', 'canteen'],
    skillLevel: 'casual',
    availability: [{ dow: 6, startMin: 9 * 60, endMin: 18 * 60 }],
    preferredAreas: ['图书馆'],
    department: '生命科学与技术学院',
    bio: null,
    matchEnabled: true,
    updatedAt: shiftHours(MOCK_NOW_ISO, -18),
  },
  {
    userId: 'u-0003',
    sections: ['sport', 'academic'],
    interestTags: ['programming', 'anime'],
    activityTags: ['badminton', 'board-game', 'self-study'],
    skillLevel: 'regular',
    availability: [{ dow: 6, startMin: 8 * 60, endMin: 22 * 60 }],
    preferredAreas: ['体育馆', '图书馆'],
    department: '信息科学与技术学院',
    bio: '羽毛球常客',
    matchEnabled: true,
    updatedAt: shiftHours(MOCK_NOW_ISO, -10),
  },
]

/* ------------------------------------------------------------------ *
 * 活动（`BuddyPost`）
 * ------------------------------------------------------------------ */

function creator(id: string, nickname: string): BuddyPost['creator'] {
  return { id, nickname, avatarUrl: null }
}

function post(partial: Omit<BuddyPost, 'myApplication' | 'updatedAt'> & { updatedAt?: string }): BuddyPost {
  return {
    ...partial,
    myApplication: null,
    updatedAt: partial.updatedAt ?? partial.createdAt,
  }
}

export const MOCK_BUDDY_POSTS: readonly BuddyPost[] = [
  // —— 运动板块 ——
  post({
    id: 'bp-1001',
    activity: 'sport',
    status: 'OPEN',
    title: '周六下午羽毛球，缺 2 人',
    description: '体育馆 3 号场，打两小时，新手也行。球拍我多带一把。',
    location: '体育馆',
    startsAt: shanghai('2026-10-24T14:00:00'),
    durationMin: 120,
    capacity: 4,
    joinedCount: 2,
    genderPreference: 'any',
    tags: ['badminton'],
    minSkillLevel: null,
    creator: creator('u-0003', '王同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -6),
  }),
  post({
    id: 'bp-1004',
    activity: 'sport',
    status: 'OPEN',
    title: '周日下午篮球 3v3，缺 3 人',
    description: '打半场，强度中等，需要一点基础。',
    location: '体育馆',
    startsAt: shanghai('2026-10-18T16:00:00'),
    durationMin: 120,
    capacity: 6,
    joinedCount: 3,
    genderPreference: 'any',
    tags: ['basketball'],
    minSkillLevel: 'regular',
    creator: creator('u-0001', '张同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -5),
  }),
  post({
    id: 'bp-1007',
    activity: 'sport',
    status: 'OPEN',
    title: '周一晚上夜跑 5km',
    description: '田径场绕圈，配速 6 分左右。',
    location: '田径场',
    startsAt: shanghai('2026-10-19T21:00:00'),
    durationMin: 60,
    capacity: 3,
    // joinedCount === capacity → 展示侧推导为 FULL（F1 排除）
    joinedCount: 3,
    genderPreference: 'any',
    tags: ['running'],
    minSkillLevel: null,
    creator: creator('u-0003', '王同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -4),
  }),
  // F7 反例：周二 06:00–07:00 不在我的可用时段内
  post({
    id: 'bp-1011',
    activity: 'sport',
    status: 'OPEN',
    title: '周二清晨晨跑（早鸟局）',
    description: '6 点田径场集合，跑完正好赶早饭。',
    location: '田径场',
    startsAt: shanghai('2026-10-20T06:00:00'),
    durationMin: 60,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['running'],
    minSkillLevel: null,
    creator: creator('u-0001', '张同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -3),
  }),
  // F6 反例：要求「竞技」水平，我是「经常」
  post({
    id: 'bp-1012',
    activity: 'sport',
    status: 'OPEN',
    title: '游泳队训练（竞技组）',
    description: '需要能连续游 1000 米。',
    location: '体育馆',
    startsAt: shanghai('2026-10-21T19:00:00'),
    durationMin: 90,
    capacity: 6,
    joinedCount: 2,
    genderPreference: 'any',
    tags: ['swimming'],
    minSkillLevel: 'competitive',
    creator: creator('u-0003', '王同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -3),
  }),

  // —— 学术自习板块 ——
  post({
    id: 'bp-1002',
    activity: 'study',
    status: 'OPEN',
    title: '图书馆四楼自习搭子',
    description: '互相监督，手机放包里。',
    location: '图书馆',
    startsAt: shanghai('2026-10-19T19:00:00'),
    durationMin: 180,
    capacity: 3,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['self-study', 'exam-prep'],
    minSkillLevel: null,
    creator: creator('u-0002', '李同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -7),
  }),
  post({
    id: 'bp-1013',
    activity: 'study',
    status: 'OPEN',
    title: '周二晚一起写代码',
    description: '在图书馆一楼讨论区，各写各的，卡住互相看。',
    location: '图书馆',
    startsAt: shanghai('2026-10-20T19:00:00'),
    durationMin: 180,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['self-study', 'programming'],
    minSkillLevel: null,
    creator: creator('u-0003', '王同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -6),
  }),
  post({
    id: 'bp-1014',
    activity: 'study',
    status: 'OPEN',
    title: '周四高数互助，一起过习题',
    description: '带上课本和作业，主要讲不会的题。',
    location: '教学楼A',
    startsAt: shanghai('2026-10-22T19:00:00'),
    durationMin: 120,
    capacity: 5,
    joinedCount: 2,
    genderPreference: 'any',
    tags: ['math', 'group-project'],
    minSkillLevel: null,
    creator: creator('u-0001', '张同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -2),
  }),
  // 我自己的帖子（F3 排除）—— 同时带两条待审批申请，用来演示 `decide`
  post({
    id: 'bp-1006',
    activity: 'study',
    status: 'OPEN',
    title: '组队赶 DDL，图书馆蹲一晚',
    description: '我有插座，带插线板。',
    location: '图书馆',
    startsAt: shanghai('2026-10-20T20:00:00'),
    durationMin: 240,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['self-study', 'programming'],
    minSkillLevel: null,
    creator: creator('u-me', '可达鸭测试号'),
    createdAt: shiftHours(MOCK_NOW_ISO, -8),
  }),
  // 已过期（F2 排除）
  post({
    id: 'bp-1009',
    activity: 'study',
    status: 'OPEN',
    title: '论文共读（已过期）',
    description: '读一篇 NLP 的综述。',
    location: '图书馆',
    startsAt: shanghai('2026-10-15T15:00:00'),
    durationMin: 90,
    capacity: 3,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['paper-writing'],
    minSkillLevel: null,
    creator: creator('u-0002', '李同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -40),
  }),

  // —— 日常板块 ——
  post({
    id: 'bp-1003',
    activity: 'meal',
    status: 'OPEN',
    title: '今晚二食堂拼饭',
    description: '想点几个菜分着吃，AA。',
    location: '二食堂',
    startsAt: shanghai('2026-10-16T21:00:00'),
    durationMin: 60,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['canteen', 'late-night-snack'],
    minSkillLevel: null,
    creator: creator('u-0001', '张同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -2),
  }),
  post({
    id: 'bp-1005',
    activity: 'travel',
    status: 'OPEN',
    title: '周六早上拼车去地铁站',
    description: '打车到 16 号线，三人平摊。',
    location: '校门口',
    startsAt: shanghai('2026-10-17T09:00:00'),
    durationMin: 60,
    capacity: 3,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['carpool'],
    minSkillLevel: null,
    creator: creator('u-0002', '李同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -1),
  }),
  post({
    id: 'bp-1008',
    activity: 'meal',
    status: 'CLOSED',
    title: '火锅局（发起人已关闭）',
    description: '人不够，改成下次了。',
    location: '二食堂',
    startsAt: shanghai('2026-10-21T18:30:00'),
    durationMin: 120,
    capacity: 4,
    joinedCount: 2,
    genderPreference: 'any',
    tags: ['hotpot'],
    minSkillLevel: null,
    creator: creator('u-0001', '张同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -9),
  }),
  post({
    id: 'bp-1010',
    activity: 'other',
    status: 'OPEN',
    title: '周末逛超市采购，一起拼单打车',
    description: '去附近的大超市，买完打车回来分摊。',
    location: '校门口',
    startsAt: shanghai('2026-10-24T10:00:00'),
    durationMin: 120,
    capacity: 2,
    joinedCount: 1,
    genderPreference: 'any',
    tags: ['carpool'],
    minSkillLevel: null,
    creator: creator('u-0003', '王同学'),
    createdAt: shiftHours(MOCK_NOW_ISO, -12),
  }),
]

/* ------------------------------------------------------------------ *
 * 申请（`BuddyApplication`）
 * ------------------------------------------------------------------ */

export const MOCK_BUDDY_APPLICATIONS: readonly BuddyApplication[] = [
  // 我已申请 bp-1002（F4：已申请的不再推荐）
  {
    id: 'ba-2001',
    postId: 'bp-1002',
    applicantId: 'u-me',
    applicantName: '可达鸭测试号',
    message: '我也常去四楼，一起？',
    status: 'PENDING',
    createdAt: shiftHours(MOCK_NOW_ISO, -3),
    decidedAt: null,
  },
  // 我的帖子 bp-1006 收到的两条待审批申请（演示 `decide`）
  {
    id: 'ba-2002',
    postId: 'bp-1006',
    applicantId: 'u-0001',
    applicantName: '张同学',
    message: '我也在赶 DDL，一起？',
    status: 'PENDING',
    createdAt: shiftHours(MOCK_NOW_ISO, -5),
    decidedAt: null,
  },
  {
    id: 'ba-2003',
    postId: 'bp-1006',
    applicantId: 'u-0003',
    applicantName: '王同学',
    message: '带我一个，我安静。',
    status: 'PENDING',
    createdAt: shiftHours(MOCK_NOW_ISO, -4),
    decidedAt: null,
  },
]

/* ------------------------------------------------------------------ *
 * 匹配反馈（`BuddyMatchFeedback`，规格 §3.6）
 * ------------------------------------------------------------------ */

export interface MockBuddyFeedback {
  userId: string
  targetPostId: string
  /** ⚠️ 反馈按 section 隔离（规格 §3.6 / 验收 T6）—— 这是最容易写错的地方 */
  section: BuddySection
  action: FeedbackAction
  createdAt: string
}

export const MOCK_BUDDY_FEEDBACK: readonly MockBuddyFeedback[] = [
  {
    userId: 'u-me',
    targetPostId: 'bp-1004',
    section: 'sport',
    action: 'dislike',
    createdAt: shiftHours(MOCK_NOW_ISO, -1),
  },
]

/* ------------------------------------------------------------------ *
 * 三板块的展示顺序与文案（页面直接用，避免在组件里硬编码）
 * ------------------------------------------------------------------ */

export const BUDDY_TAB_SECTIONS: readonly (BuddySection | 'all')[] = [
  'all',
  'academic',
  'daily',
  'sport',
]
