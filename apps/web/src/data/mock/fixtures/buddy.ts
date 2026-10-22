/**
 * 找搭子 mock 数据集 —— 保证**无后端也能跑通**（契约 §7 硬规则 4）。
 *
 * 时间基于传入的 `now` 相对生成，测试传固定 `now` 即可获得确定性。
 * 数据集刻意覆盖：
 * - 三个板块（`academic` / `daily` / `sport`，**没有第四个**）；
 * - 5 种帖子状态中的 4 种（`OPEN` / `FULL` / `CLOSED` / `EXPIRED`）；
 * - 性别偏好 `any` / `same` / `other` 与运动水平门槛；
 * - 一条**跨零点**可用时段（周五 23:00–次日 01:00）。
 *
 * ⚠️ 隐私（规格 §6.1）：`userGenders` 是 mock 的**私有映射**，
 * 只用于 F5 准入判定，**不出现在任何出站对象里**（schema 有负向断言守着）。
 *
 * ⚠️ 一致性：帖子与申请由**同一份** `BuddyPostSeed` 派生，因此
 * `joinedCount === 1 + 已通过申请数`（契约 §11.10-D）恒成立，不会漂移。
 */
import type {
  BuddyApplication,
  BuddyApplicationStatus,
  BuddyGender,
  BuddyMatchFeedback,
  BuddyPost,
  BuddyProfile,
  BuddySection,
  BuddySkillLevel,
} from '@/domain/models/buddy';
import { sectionOf } from '@/domain/models/buddy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 本地时间构造（测试传固定 now 即可确定性） */
/** 北京时间偏移（UTC+8）。**固定值，不跟随运行时 TZ** */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 生成「北京时间某天某时」的时间戳。
 *
 * ## 为什么不用 `setHours`
 *
 * 原来的实现用 `setDate` / `setHours` —— 那是**运行时本地时区**语义。
 * 于是同一份 fixture 在 `TZ=Asia/Shanghai` 和 `TZ=UTC` 下产出**相差 16 小时**
 * 的时间戳，而测试断言的是精确 ID 列表 → CI（UTC）全红、本机（UTC+8）全绿。
 *
 * 本函数的契约是「演示数据里说的 18:30 就是北京时间 18:30」，
 * 与跑在哪台机器上无关。所以显式用 UTC 算术 + 固定偏移，
 * **不读取系统时区**。
 *
 * 目标校在上海，用户的「今天 18:30」就是 +08:00，这个语义是对的。
 */
function localAt(base: Date, dayOffset: number, hour: number, minute = 0): string {
  const shifted = new Date(base.getTime() + CN_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  shifted.setUTCHours(hour, minute, 0, 0);
  return new Date(shifted.getTime() - CN_OFFSET_MS).toISOString();
}

function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

export interface BuddyApplicant {
  id: string;
  nickname: string;
  gender: BuddyGender;
  skillLevel: BuddySkillLevel;
}

/** 演示会话用户（与 `application/buddy/session.ts` 的 `DEMO_BUDDY_SESSION` 对齐） */
export const DEMO_BUDDY_USER_ID = 'u_1024';

/** 申请人池（同时充当「发起人档案」的来源，供规则分使用） */
export const BUDDY_APPLICANT_POOL: readonly BuddyApplicant[] = [
  { id: 'u_2048', nickname: '图书馆常驻', gender: 'female', skillLevel: 'beginner' },
  { id: 'u_3072', nickname: '早八人', gender: 'male', skillLevel: 'casual' },
  { id: 'u_4096', nickname: '球场老张', gender: 'male', skillLevel: 'regular' },
  { id: 'u_5120', nickname: '夜跑鸭', gender: 'female', skillLevel: 'casual' },
  { id: 'u_6144', nickname: '火锅搭子', gender: 'female', skillLevel: 'beginner' },
  { id: 'u_7168', nickname: '熬夜冠军', gender: 'male', skillLevel: 'competitive' },
  // 演示会话用户也在池里：他/她发布的活动要显示昵称，而不是裸 id。
  // ⚠️ 申请人生成时会把他/她排除（见 `createBuddyApplicationSeed`），
  // 否则「我的申请」会被伪造的种子记录污染。
  { id: DEMO_BUDDY_USER_ID, nickname: '鸭鸭先冲', gender: 'female', skillLevel: 'casual' },
];

const APPLICANT_BY_ID = new Map(BUDDY_APPLICANT_POOL.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ *
 * 匹配资料（服务端替身：`BuddyProfile` 只被算法使用，不对任何人可见）
 * ------------------------------------------------------------------ */

function profile(
  userId: string,
  input: Partial<BuddyProfile> & { sections: BuddySection[] },
  now: Date,
): BuddyProfile {
  return {
    userId,
    sections: input.sections,
    interestTags: input.interestTags ?? [],
    activityTags: input.activityTags ?? [],
    skillLevel: input.skillLevel ?? 'casual',
    availability: input.availability ?? [],
    preferredAreas: input.preferredAreas ?? [],
    department: input.department ?? null,
    bio: input.bio ?? null,
    matchEnabled: input.matchEnabled ?? false,
    updatedAt: iso(now, -2 * HOUR),
  };
}

export function createBuddyProfileSeed(now: Date): Record<string, BuddyProfile> {
  return {
    // 「我」—— 已开启匹配，含一条跨零点时段
    [DEMO_BUDDY_USER_ID]: profile(
      DEMO_BUDDY_USER_ID,
      {
        sections: ['academic', 'sport'],
        interestTags: ['self-study', 'programming', 'badminton', 'running'],
        activityTags: ['self-study', 'badminton'],
        skillLevel: 'casual',
        // 工作日 08:00–23:00、周末 10:00–22:00，外加一条跨零点时段。
        // 时段给得宽是为了让"时间能碰上"这条理由在演示数据里真的会出现 ——
        // F7 是**硬过滤**，时段太窄会把所有候选都筛掉（这也是它该有的行为）。
        availability: [
          { dow: 1, startMin: 8 * 60, endMin: 23 * 60 },
          { dow: 2, startMin: 8 * 60, endMin: 23 * 60 },
          { dow: 3, startMin: 8 * 60, endMin: 23 * 60 },
          { dow: 4, startMin: 8 * 60, endMin: 23 * 60 },
          { dow: 5, startMin: 8 * 60, endMin: 23 * 60 },
          { dow: 6, startMin: 10 * 60, endMin: 22 * 60 },
          { dow: 0, startMin: 10 * 60, endMin: 22 * 60 },
          // 跨零点：周五 23:00 → 次日（周六）01:00
          { dow: 5, startMin: 23 * 60, endMin: 60 },
        ],
        preferredAreas: ['图书馆', '体育馆'],
        department: '信息科学与技术学院',
        bio: '常驻图书馆四楼，晚上在体育馆。',
        matchEnabled: true,
      },
      now,
    ),
    u_2048: profile(
      'u_2048',
      {
        sections: ['academic'],
        interestTags: ['self-study', 'exam-prep', 'programming'],
        activityTags: ['self-study', 'group-project'],
        skillLevel: 'beginner',
        preferredAreas: ['图书馆', '教学楼A'],
        department: '信息科学与技术学院',
        matchEnabled: true,
      },
      now,
    ),
    u_3072: profile(
      'u_3072',
      {
        sections: ['daily'],
        interestTags: ['canteen', 'lunch', 'movie'],
        activityTags: ['lunch', 'airport-ride'],
        skillLevel: 'casual',
        preferredAreas: ['三食堂', '校门口'],
        department: '创业与管理学院',
        matchEnabled: true,
      },
      now,
    ),
    u_4096: profile(
      'u_4096',
      {
        sections: ['sport'],
        interestTags: ['badminton', 'basketball', 'fitness'],
        activityTags: ['badminton', 'basketball'],
        skillLevel: 'regular',
        preferredAreas: ['体育馆', '篮球场'],
        department: '物质科学与技术学院',
        matchEnabled: true,
      },
      now,
    ),
    u_5120: profile(
      'u_5120',
      {
        sections: ['sport'],
        interestTags: ['running', 'swimming', 'music'],
        activityTags: ['running', 'swimming'],
        skillLevel: 'casual',
        preferredAreas: ['田径场', '体育馆'],
        department: '生命科学与技术学院',
        matchEnabled: true,
      },
      now,
    ),
    u_6144: profile(
      'u_6144',
      {
        sections: ['daily'],
        interestTags: ['hotpot', 'dinner', 'coffee'],
        activityTags: ['dinner', 'coffee'],
        skillLevel: 'beginner',
        preferredAreas: ['三食堂', '学生活动中心'],
        department: '创意与艺术学院',
        matchEnabled: true,
      },
      now,
    ),
    // 未开启匹配的用户：用于验证「不开匹配也能发帖 / 也能看列表」
    u_7168: profile('u_7168', { sections: [], matchEnabled: false }, now),
  };
}

/* ------------------------------------------------------------------ *
 * 帖子（PostSeed 是唯一真相；帖子与申请都从它派生）
 * ------------------------------------------------------------------ */

export interface BuddyPostSeed {
  id: string;
  activity: BuddyPost['activity'];
  status: BuddyPost['status'];
  title: string;
  description: string | null;
  location: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
  creatorId: string;
  genderPreference: BuddyPost['genderPreference'];
  minSkillLevel: BuddySkillLevel | null;
  tags: string[];
  createdAt: string;
  /** 已通过的申请人数（`joinedCount = 1 + accepted`，契约 §11.10-D） */
  accepted: number;
  /** 待审批的申请人 id */
  pending: string[];
  /** 已撤回的申请人 id（演示「撤回后可复用同一行」） */
  withdrawn: string[];
}

export function createBuddyPostSeeds(now: Date): BuddyPostSeed[] {
  return [
    {
      id: 'bp-1001',
      activity: 'sport',
      status: 'OPEN',
      title: '周六下午羽毛球，缺 2 人',
      description: '体育馆 3 号场，打两小时，新手也行。球拍我多带一副。',
      location: '体育馆',
      startsAt: localAt(now, 3, 14, 0),
      durationMin: 120,
      capacity: 4,
      creatorId: 'u_4096',
      genderPreference: 'any',
      minSkillLevel: 'casual',
      tags: ['badminton'],
      createdAt: iso(now, -5 * HOUR),
      accepted: 1,
      pending: ['u_5120'],
      withdrawn: [],
    },
    {
      id: 'bp-1002',
      activity: 'study',
      status: 'OPEN',
      title: '图书馆四楼长期自习，找同桌',
      description: '工作日早上 8 点到 12 点，四楼靠窗那排。互不打扰，但可以互相盯着别摸鱼。',
      location: '图书馆',
      startsAt: localAt(now, 1, 8, 0),
      durationMin: 240,
      capacity: 6,
      creatorId: 'u_2048',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['self-study', 'exam-prep'],
      createdAt: iso(now, -20 * HOUR),
      accepted: 2,
      pending: [DEMO_BUDDY_USER_ID],
      withdrawn: [],
    },
    {
      id: 'bp-1003',
      activity: 'meal',
      status: 'OPEN',
      title: '三食堂火锅拼桌，还差 1 人',
      description: '六人桌，人均 40 左右，晚上六点半开涮。',
      location: '三食堂',
      startsAt: localAt(now, 0, 18, 30),
      durationMin: 90,
      capacity: 6,
      creatorId: 'u_6144',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['hotpot', 'dinner'],
      createdAt: iso(now, -3 * HOUR),
      accepted: 4,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1004',
      activity: 'sport',
      status: 'OPEN',
      title: '周三夜跑 5 公里，配速 6 分',
      description: '田径场外圈，跑完拉伸十分钟。下雨顺延。',
      location: '田径场',
      startsAt: localAt(now, 2, 21, 0),
      durationMin: 60,
      capacity: 8,
      creatorId: 'u_5120',
      genderPreference: 'any',
      minSkillLevel: 'beginner',
      tags: ['running'],
      createdAt: iso(now, -2 * DAY),
      accepted: 1,
      pending: ['u_7168'],
      withdrawn: [],
    },
    {
      id: 'bp-1005',
      activity: 'study',
      status: 'FULL',
      title: '数据库大作业组队（已满）',
      description: '四人一组，需要一个人负责前端。',
      location: '教学楼C',
      startsAt: localAt(now, 5, 14, 0),
      durationMin: 180,
      capacity: 4,
      creatorId: 'u_2048',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['group-project', 'programming'],
      createdAt: iso(now, -4 * DAY),
      accepted: 3,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1006',
      activity: 'travel',
      status: 'OPEN',
      title: '周六浦东机场拼车',
      description: '早上 6 点北门集合，行李不多的同学优先。',
      location: '校门口',
      startsAt: localAt(now, 4, 6, 0),
      durationMin: 90,
      capacity: 4,
      creatorId: 'u_3072',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['airport-ride'],
      createdAt: iso(now, -30 * HOUR),
      accepted: 0,
      pending: [],
      withdrawn: [DEMO_BUDDY_USER_ID],
    },
    {
      id: 'bp-1007',
      activity: 'game',
      status: 'OPEN',
      title: '篮球半场 3v3，仅限男生',
      description: '室外球场，打一个半小时。带球来更好。',
      location: '篮球场',
      startsAt: localAt(now, 2, 16, 0),
      durationMin: 120,
      capacity: 6,
      creatorId: 'u_4096',
      genderPreference: 'same',
      minSkillLevel: null,
      tags: ['basketball'],
      createdAt: iso(now, -8 * HOUR),
      accepted: 1,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1008',
      activity: 'meal',
      status: 'CLOSED',
      title: '咖啡 + 聊项目（已关闭）',
      description: '学生活动中心一楼，已经聊完了。',
      location: '学生活动中心',
      startsAt: localAt(now, 1, 15, 0),
      durationMin: 60,
      capacity: 3,
      creatorId: 'u_6144',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['coffee'],
      createdAt: iso(now, -3 * DAY),
      accepted: 1,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1009',
      activity: 'study',
      status: 'OPEN',
      title: '四六级口语练习搭子（2 人）',
      description: '每天 20 分钟对着练，教学中心 A 一楼。',
      location: '教学楼A',
      startsAt: localAt(now, 7, 19, 0),
      durationMin: 60,
      capacity: 2,
      creatorId: 'u_2048',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['english'],
      createdAt: iso(now, -12 * HOUR),
      accepted: 0,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1010',
      activity: 'sport',
      status: 'EXPIRED',
      title: '游泳馆晨泳（已过期）',
      description: '早上 7 点，游 40 分钟。',
      location: '体育馆',
      startsAt: localAt(now, -1, 7, 0),
      durationMin: 60,
      capacity: 4,
      creatorId: 'u_5120',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['swimming'],
      createdAt: iso(now, -5 * DAY),
      accepted: 1,
      pending: [],
      withdrawn: [],
    },
    {
      id: 'bp-1011',
      activity: 'other',
      status: 'OPEN',
      title: '周五晚看电影，缺 2 人',
      description: '学生活动中心放映室，片名待定，投票决定。',
      location: '学生活动中心',
      startsAt: localAt(now, 3, 19, 30),
      durationMin: 150,
      capacity: 4,
      creatorId: 'u_3072',
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['movie'],
      createdAt: iso(now, -6 * HOUR),
      accepted: 0,
      pending: ['u_2048'],
      withdrawn: [],
    },
    {
      // 由演示会话用户（u_1024）发布：这样「发起人视角」的申请管理 / 审批 / 关闭
      // 在浏览器里就能真实点到（否则演示会话永远是申请人视角）。
      id: 'bp-1013',
      activity: 'study',
      status: 'OPEN',
      title: '周三晚自习搭子（我发布的）',
      description: '图书馆三楼讨论间，主要写作业，互相监督。',
      location: '图书馆',
      startsAt: localAt(now, 2, 19, 0),
      durationMin: 120,
      capacity: 4,
      creatorId: DEMO_BUDDY_USER_ID,
      genderPreference: 'any',
      minSkillLevel: null,
      tags: ['self-study', 'programming'],
      createdAt: iso(now, -4 * HOUR),
      accepted: 0,
      pending: ['u_3072', 'u_4096'],
      withdrawn: [],
    },
    {
      id: 'bp-1012',
      activity: 'sport',
      status: 'OPEN',
      title: '健身房撸铁，仅限女生',
      description: '需要能独立完成深蹲 40kg 的同学，晚上七点。',
      location: '体育馆',
      startsAt: localAt(now, 1, 19, 0),
      durationMin: 90,
      capacity: 2,
      creatorId: 'u_6144',
      genderPreference: 'same',
      minSkillLevel: 'regular',
      tags: ['fitness'],
      createdAt: iso(now, -10 * HOUR),
      accepted: 0,
      pending: [],
      withdrawn: [],
    },
  ];
}

export function createBuddyPostSeed(now: Date): BuddyPost[] {
  return createBuddyPostSeeds(now).map((seed) => {
    const creator = APPLICANT_BY_ID.get(seed.creatorId);
    return {
      id: seed.id,
      activity: seed.activity,
      status: seed.status,
      title: seed.title,
      description: seed.description,
      location: seed.location,
      startsAt: seed.startsAt,
      durationMin: seed.durationMin,
      capacity: seed.capacity,
      joinedCount: 1 + seed.accepted,
      genderPreference: seed.genderPreference,
      minSkillLevel: seed.minSkillLevel,
      tags: [...seed.tags],
      creator: {
        id: seed.creatorId,
        nickname: creator?.nickname ?? seed.creatorId,
        avatarUrl: null,
      },
      createdAt: seed.createdAt,
      autoCloseAt: seed.startsAt,
    };
  });
}

/** 帖子的发起人性别（mock 私有映射 —— **不进任何出站对象**） */
export function createUserGenderSeed(): Record<string, BuddyGender> {
  const out: Record<string, BuddyGender> = {};
  for (const applicant of BUDDY_APPLICANT_POOL) out[applicant.id] = applicant.gender;
  out[DEMO_BUDDY_USER_ID] = 'female';
  return out;
}

/* ------------------------------------------------------------------ *
 * 申请
 * ------------------------------------------------------------------ */

export function createBuddyApplicationSeed(now: Date): BuddyApplication[] {
  const seeds = createBuddyPostSeeds(now);
  const applications: BuddyApplication[] = [];
  const applicantPool = BUDDY_APPLICANT_POOL.map((a) => a.id).filter(
    (id) => id !== DEMO_BUDDY_USER_ID,
  );
  let seq = 0;

  const push = (
    seed: BuddyPostSeed,
    applicantId: string,
    status: BuddyApplicationStatus,
    message: string | null,
    createdAt: string,
  ): void => {
    seq += 1;
    const applicant = APPLICANT_BY_ID.get(applicantId);
    const decided = status === 'ACCEPTED' || status === 'REJECTED';
    applications.push({
      id: `ba-${2000 + seq}`,
      postId: seed.id,
      applicantId,
      applicantNickname: applicant?.nickname ?? applicantId,
      status,
      message,
      createdAt,
      decidedAt: decided ? iso(now, -1 * HOUR) : null,
      decidedBy: decided ? seed.creatorId : null,
    });
  };

  for (const seed of seeds) {
    const candidates = applicantPool.filter((id) => id !== seed.creatorId);
    candidates.slice(0, seed.accepted).forEach((applicantId, index) => {
      push(seed, applicantId, 'ACCEPTED', index === 0 ? '一起！' : null, iso(now, -(index + 2) * HOUR));
    });
    seed.pending.forEach((applicantId, index) => {
      push(
        seed,
        applicantId,
        'PENDING',
        index === 0 ? '算我一个。' : null,
        iso(now, -(index + 1) * HOUR),
      );
    });
    seed.withdrawn.forEach((applicantId) => {
      push(seed, applicantId, 'WITHDRAWN', '行程改了，先撤回。', iso(now, -20 * HOUR));
    });
  }

  return applications;
}

/* ------------------------------------------------------------------ *
 * 反馈
 * ------------------------------------------------------------------ */

export function createBuddyFeedbackSeed(now: Date): BuddyMatchFeedback[] {
  return [
    {
      userId: DEMO_BUDDY_USER_ID,
      targetPostId: 'bp-1002',
      section: 'academic',
      action: 'like',
      createdAt: iso(now, -6 * HOUR),
    },
    {
      userId: DEMO_BUDDY_USER_ID,
      targetPostId: 'bp-1005',
      section: 'academic',
      action: 'dislike',
      createdAt: iso(now, -1 * DAY),
    },
  ];
}

export interface BuddySeed {
  posts: BuddyPost[];
  applications: BuddyApplication[];
  profiles: Record<string, BuddyProfile>;
  feedbacks: BuddyMatchFeedback[];
  userGenders: Record<string, BuddyGender>;
}

export function createBuddySeed(now: Date): BuddySeed {
  return {
    posts: createBuddyPostSeed(now),
    applications: createBuddyApplicationSeed(now),
    profiles: createBuddyProfileSeed(now),
    feedbacks: createBuddyFeedbackSeed(now),
    userGenders: createUserGenderSeed(),
  };
}

/** 板块 → 帖子（fixture 自检与测试用） */
export function postsOfSection(posts: readonly BuddyPost[], section: BuddySection): BuddyPost[] {
  return posts.filter((post) => sectionOf(post.activity) === section);
}

export { MINUTE, HOUR, DAY, localAt, iso };
