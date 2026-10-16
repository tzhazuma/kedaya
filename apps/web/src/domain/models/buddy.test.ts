/**
 * 找搭子领域模型测试（规格 §2 / §3.2 / §3.3 / §6）。
 *
 * 覆盖验收里点名的四件事中的两件：
 * - **封闭标签校验**（规格 §3.2）：未知标签必须被拒，自由文本无法进入匹配特征；
 * - **可用时段（含跨零点）**（规格 §3.3 F7 / 验收 T14）。
 * 另外覆盖冻结状态机的 5×5 全矩阵（验收 T1）与 `sectionOf` 全映射（验收 T2）。
 */
import { overlapsAvailability } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import {
  availabilityOverlapsPost,
  BUDDY_ACTIVE_TAGS,
  BUDDY_ACTIVE_TAG_KEYS,
  BUDDY_PRIVACY_ITEMS,
  BUDDY_PRIVACY_SUMMARY,
  BUDDY_SECTIONS,
  BUDDY_TAG_KEYS,
  BUDDY_TAG_TABLE,
  canTransitionApplication,
  canTransitionPost,
  dedupeTags,
  describeAvailability,
  detectContactInfo,
  emptyBuddyPostDraft,
  findTag,
  formatAvailabilitySlot,
  genderCompatible,
  hasStarted,
  hhmmToMinutes,
  isBuddySection,
  isCrossMidnight,
  isKnownLocation,
  isKnownTag,
  isPostJoinable,
  isSelectableTag,
  joinBlockedReason,
  locationLabel,
  meetsMinSkillLevel,
  minutesToHHMM,
  progressPercent,
  remainingSlots,
  searchTags,
  sectionOf,
  skillRank,
  slotLengthMinutes,
  tagLabel,
  tagLabels,
  validateAvailability,
  validateAvailabilitySlot,
  validateBuddyPostDraft,
  validateBuddyProfileDraft,
  validateTagSelection,
  BUDDY_REASONS,
  BUDDY_POST_STATUSES,
  type BuddyAvailabilitySlot,
  type BuddyPost,
  type BuddyPostDraft,
  type BuddyProfileDraft,
} from './buddy';

const NOW = new Date('2026-10-17T05:00:00+08:00');

function makePost(overrides: Partial<BuddyPost> = {}): BuddyPost {
  return {
    id: 'bp-1',
    activity: 'study',
    status: 'OPEN',
    title: '图书馆自习',
    description: null,
    location: '图书馆',
    startsAt: '2026-10-24T14:00:00+08:00',
    durationMin: 120,
    capacity: 4,
    joinedCount: 1,
    genderPreference: 'any',
    minSkillLevel: null,
    tags: ['self-study'],
    creator: { id: 'u_1', nickname: '发起人', avatarUrl: null },
    createdAt: '2026-10-17T02:00:00.000Z',
    autoCloseAt: null,
    ...overrides,
  };
}

function validDraft(overrides: Partial<BuddyPostDraft> = {}): BuddyPostDraft {
  return {
    ...emptyBuddyPostDraft(),
    title: '周六下午羽毛球',
    description: '体育馆 3 号场，新手也行。',
    location: '体育馆',
    startsAt: '2026-10-24T14:00:00+08:00',
    durationMin: 120,
    capacity: 4,
    tags: ['badminton'],
    activity: 'sport',
    ...overrides,
  };
}

function validProfileDraft(overrides: Partial<BuddyProfileDraft> = {}): BuddyProfileDraft {
  return {
    sections: ['academic'],
    interestTags: ['self-study'],
    activityTags: ['self-study'],
    skillLevel: 'casual',
    availability: [{ dow: 1, startMin: 8 * 60, endMin: 12 * 60 }],
    preferredAreas: ['图书馆'],
    department: '信息科学与技术学院',
    bio: '常驻图书馆。',
    matchEnabled: true,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * §2.3 板块派生（验收 T2）
 * ------------------------------------------------------------------ */

describe('sectionOf：板块由 activity 派生（规格 §2.3 / 验收 T2）', () => {
  it('6 种活动类型全部映射正确', () => {
    expect(sectionOf('study')).toBe('academic');
    expect(sectionOf('meal')).toBe('daily');
    expect(sectionOf('travel')).toBe('daily');
    expect(sectionOf('other')).toBe('daily');
    expect(sectionOf('sport')).toBe('sport');
    expect(sectionOf('game')).toBe('sport');
  });

  it('只有三个板块（契约 §11.10-G：不做交友/约会板块）', () => {
    expect(BUDDY_SECTIONS).toEqual(['academic', 'daily', 'sport']);
    expect(BUDDY_SECTIONS).toHaveLength(3);
  });

  it('isBuddySection 拒绝第四个板块与任意字符串', () => {
    expect(isBuddySection('academic')).toBe(true);
    expect(isBuddySection('sport')).toBe(true);
    expect(isBuddySection('daily')).toBe(true);
    expect(isBuddySection('academic ')).toBe(false);
    expect(isBuddySection(42)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * §2.8 状态机（验收 T1）
 * ------------------------------------------------------------------ */

describe('BuddyPost 状态机：5×5 全矩阵（规格 §2.8，冻结不得改动）', () => {
  const allowed: Record<string, string[]> = {
    OPEN: ['FULL', 'CLOSED', 'EXPIRED', 'CANCELLED'],
    FULL: ['OPEN', 'CLOSED', 'EXPIRED'],
    CLOSED: [],
    EXPIRED: [],
    CANCELLED: [],
  };

  it('每一条合法转移为 true，其余全部为 false', () => {
    for (const from of BUDDY_POST_STATUSES) {
      for (const to of BUDDY_POST_STATUSES) {
        const expected = allowed[from]?.includes(to) ?? false;
        expect(
          canTransitionPost(from, to),
          `canTransitionPost(${from}, ${to}) 应为 ${expected}`,
        ).toBe(expected);
      }
    }
  });

  it('FULL 没有 CANCELLED 分支（不擅自扩边）', () => {
    expect(canTransitionPost('FULL', 'CANCELLED')).toBe(false);
  });

  it('终态不可再转移', () => {
    for (const to of BUDDY_POST_STATUSES) {
      expect(canTransitionPost('CLOSED', to)).toBe(false);
      expect(canTransitionPost('EXPIRED', to)).toBe(false);
      expect(canTransitionPost('CANCELLED', to)).toBe(false);
    }
  });
});

describe('BuddyApplication 状态机（规格 §2.8）', () => {
  it('PENDING → ACCEPTED / REJECTED / WITHDRAWN', () => {
    expect(canTransitionApplication('PENDING', 'ACCEPTED')).toBe(true);
    expect(canTransitionApplication('PENDING', 'REJECTED')).toBe(true);
    expect(canTransitionApplication('PENDING', 'WITHDRAWN')).toBe(true);
    expect(canTransitionApplication('PENDING', 'PENDING')).toBe(false);
  });

  it('WITHDRAWN → PENDING（复用同一行，服务 @@unique 约束）', () => {
    expect(canTransitionApplication('WITHDRAWN', 'PENDING')).toBe(true);
    expect(canTransitionApplication('WITHDRAWN', 'ACCEPTED')).toBe(false);
  });

  it('ACCEPTED / REJECTED 是终态', () => {
    for (const to of ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(canTransitionApplication('ACCEPTED', to)).toBe(false);
      expect(canTransitionApplication('REJECTED', to)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 派生量与准入
 * ------------------------------------------------------------------ */

describe('名额与可申请性（契约 §11.10-D：joinedCount 含发起人，初值 1）', () => {
  it('remainingSlots / progressPercent', () => {
    expect(remainingSlots({ capacity: 4, joinedCount: 1 })).toBe(3);
    expect(remainingSlots({ capacity: 4, joinedCount: 6 })).toBe(0);
    expect(progressPercent({ capacity: 4, joinedCount: 2 })).toBe(50);
    expect(progressPercent({ capacity: 0, joinedCount: 2 })).toBe(0);
  });

  it('isPostJoinable：OPEN + 有名额 + 未开始', () => {
    expect(isPostJoinable(makePost(), NOW)).toBe(true);
    expect(isPostJoinable(makePost({ status: 'FULL' }), NOW)).toBe(false);
    expect(isPostJoinable(makePost({ joinedCount: 4 }), NOW)).toBe(false);
    expect(isPostJoinable(makePost({ startsAt: '2026-10-16T14:00:00+08:00' }), NOW)).toBe(false);
  });

  it('hasStarted 对非法时间返回 true（宁可挡住，也不放行）', () => {
    expect(hasStarted({ startsAt: 'not-a-date' }, NOW)).toBe(true);
  });

  it('joinBlockedReason 给出中文原因，可申请时为 null', () => {
    expect(joinBlockedReason(makePost(), 'u_2', NOW)).toBeNull();
    expect(joinBlockedReason(makePost(), 'u_1', NOW)).toBe('不能申请自己发布的活动');
    expect(joinBlockedReason(makePost({ status: 'CLOSED' }), 'u_2', NOW)).toContain('不能申请');
    expect(joinBlockedReason(makePost({ joinedCount: 4 }), 'u_2', NOW)).toBe('名额已满');
    expect(
      joinBlockedReason(makePost({ startsAt: '2026-10-16T14:00:00+08:00' }), 'u_2', NOW),
    ).toBe('活动已开始');
  });
});

describe('性别只做准入、不进打分（规格 §1.2 N5）', () => {
  it('any 一律相容', () => {
    expect(genderCompatible('any', 'male', 'female')).toBe(true);
    expect(genderCompatible('any', 'unspecified', 'unspecified')).toBe(true);
  });

  it('same / other 按性别判定', () => {
    expect(genderCompatible('same', 'male', 'male')).toBe(true);
    expect(genderCompatible('same', 'male', 'female')).toBe(false);
    expect(genderCompatible('other', 'male', 'female')).toBe(true);
    expect(genderCompatible('other', 'male', 'male')).toBe(false);
  });

  it('任一方未填写性别时不拦（"无法判定"不等于"不相容"）', () => {
    expect(genderCompatible('same', 'unspecified', 'female')).toBe(true);
    expect(genderCompatible('same', 'male', 'unspecified')).toBe(true);
    expect(genderCompatible('other', 'unspecified', 'female')).toBe(true);
  });
});

describe('运动水平（F6 硬过滤，仅 sport）', () => {
  it('skillRank 单调递增', () => {
    expect(skillRank('beginner')).toBeLessThan(skillRank('casual'));
    expect(skillRank('casual')).toBeLessThan(skillRank('regular'));
    expect(skillRank('regular')).toBeLessThan(skillRank('competitive'));
  });

  it('meetsMinSkillLevel：无门槛或未填写时不拦', () => {
    expect(meetsMinSkillLevel('casual', null)).toBe(true);
    expect(meetsMinSkillLevel(null, 'regular')).toBe(true);
    expect(meetsMinSkillLevel('regular', 'casual')).toBe(true);
    expect(meetsMinSkillLevel('casual', 'regular')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * §3.2 封闭标签（硬要求）
 * ------------------------------------------------------------------ */

describe('封闭标签表（规格 §3.2）', () => {
  it('标签表非空、key 唯一、都带中文名与分组', () => {
    expect(BUDDY_TAG_TABLE.length).toBeGreaterThanOrEqual(20);
    const keys = BUDDY_TAG_TABLE.map((tag) => tag.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tag of BUDDY_TAG_TABLE) {
      expect(tag.label.length).toBeGreaterThan(0);
      expect(tag.label.length).toBeLessThanOrEqual(24);
    }
  });

  it('标签表来自唯一真相，且当前**没有**下架标签（如实记录）', () => {
    // ⚠️ 修正说明：本条原先断言 Web 自拟表里的 `esports-league` 是"下架标签"。
    // 标签表收敛到 `@kedaya/contracts` 后，权威表**没有**任何下架标签
    // （服务端的 `BuddyTagDef` 从来没有 `isActive` 字段，`isActive` 是我们为
    // "规格 §3.2 允许下架但不删除"预留的可选字段）。
    // 因此这里改为断言**真实情况**，而不是为了测试去伪造一个下架标签 ——
    // 伪造数据来迁就测试是本末倒置。
    expect(BUDDY_TAG_TABLE.length).toBeGreaterThanOrEqual(60);
    const retired = BUDDY_TAG_TABLE.filter((tag) => !tag.isActive);
    expect(retired, '权威表当前没有下架标签；若将来有，此断言会提醒你补下架路径的测试').toHaveLength(0);
    // 全表可选，且 ACTIVE 与全表 key 一致
    for (const tag of BUDDY_TAG_TABLE) {
      expect(isSelectableTag(tag.key), tag.key).toBe(true);
      expect(isKnownTag(tag.key), tag.key).toBe(true);
    }
    expect(BUDDY_ACTIVE_TAG_KEYS).toHaveLength(BUDDY_TAG_KEYS.length);
    // 未知 key 一律不可选、不可知
    expect(isKnownTag('not-a-real-tag')).toBe(false);
    expect(isSelectableTag('not-a-real-tag')).toBe(false);
  });

  it('未登记的 key 不是已知标签，label 回退为 key（不猜中文）', () => {
    expect(isKnownTag('打羽毛球')).toBe(false);
    expect(isSelectableTag('badminton')).toBe(true);
    expect(tagLabel('badminton')).toBe('羽毛球');
    expect(tagLabel('打羽毛球')).toBe('打羽毛球');
    expect(tagLabels(['badminton', 'running'])).toEqual(['羽毛球', '跑步']);
  });

  it('别名只用于搜索（规格 §3.2：不用于匹配）', () => {
    // 别名取自**权威表**（原先断言的 `fitness`/`羽球` 是 Web 自拟表的别名，权威表里不存在）
    expect(searchTags('打羽毛球').map((tag) => tag.key)).toContain('badminton');
    expect(searchTags('撸铁').map((tag) => tag.key)).toContain('gym');
    expect(searchTags('不存在的词')).toEqual([]);
    expect(findTag('badminton')?.aliases).toContain('打羽毛球');
    // 权威表的每个别名都能搜到对应的 key（别名表不许有孤儿）
    for (const tag of BUDDY_TAG_TABLE) {
      for (const alias of tag.aliases) {
        expect(searchTags(alias).map((x) => x.key), `别名 ${alias}`).toContain(tag.key);
      }
    }
  });

  it('validateTagSelection：未知标签被拒，reason 为 UNKNOWN_TAG:<key>', () => {
    const problems = validateTagSelection(['badminton', '自由文本标签'], {
      max: 8,
      field: 'tags',
      tooManyReason: BUDDY_REASONS.TOO_MANY_TAGS,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toBe('UNKNOWN_TAG:自由文本标签');
    expect(problems[0]?.field).toBe('tags');
    expect(problems[0]?.message).toContain('只能从列表中选择');
  });

  it('validateTagSelection：超上限被拒（TOO_MANY_TAGS）', () => {
    const problems = validateTagSelection(['badminton', 'running', 'swimming'], {
      max: 2,
      field: 'tags',
      tooManyReason: BUDDY_REASONS.TOO_MANY_TAGS,
    });
    expect(problems.map((p) => p.reason)).toContain(BUDDY_REASONS.TOO_MANY_TAGS);
  });

  it('validateTagSelection：未知标签一律被拒（allowRetired 也救不了它）', () => {
    // 原先用 `esports-league`（Web 自拟的下架标签）。权威表没有下架标签，
    // 故改为用**未知 key** 覆盖同一条代码路径，并断言两条分支的差异：
    //   - 默认（allowRetired 缺省）：走 isSelectableTag
    //   - allowRetired: true：走 isKnownTag（允许历史值）
    // 两者对**未知** key 都必须拒绝 —— 这正是"allowRetired 不是万能放行"的证明。
    const opts = { max: 8, field: 'tags', tooManyReason: BUDDY_REASONS.TOO_MANY_TAGS };
    expect(validateTagSelection(['not-a-real-tag'], opts)).toHaveLength(1);
    expect(validateTagSelection(['not-a-real-tag'], { ...opts, allowRetired: true })).toHaveLength(1);
    // 合法 key 两条分支都通过
    expect(validateTagSelection(['badminton'], opts)).toHaveLength(0);
    expect(validateTagSelection(['badminton'], { ...opts, allowRetired: true })).toHaveLength(0);
  });

  it('dedupeTags 保持首次出现顺序', () => {
    expect(dedupeTags(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('活动标签最多 8 项（发布时校验）', () => {
    const tags = BUDDY_ACTIVE_TAGS.slice(0, 9).map((tag) => tag.key);
    const problems = validateBuddyPostDraft(validDraft({ tags }), { now: NOW });
    expect(problems.map((p) => p.reason)).toContain(BUDDY_REASONS.TOO_MANY_TAGS);
  });
});

/* ------------------------------------------------------------------ *
 * 发布草稿校验
 * ------------------------------------------------------------------ */

describe('validateBuddyPostDraft（规格 §5.4）', () => {
  it('合法草稿没有问题', () => {
    expect(validateBuddyPostDraft(validDraft(), { now: NOW })).toEqual([]);
  });

  it('标题为空 / 超 60 字被拒', () => {
    expect(
      validateBuddyPostDraft(validDraft({ title: '   ' }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_TITLE);
    expect(
      validateBuddyPostDraft(validDraft({ title: 'x'.repeat(61) }), { now: NOW }).map(
        (p) => p.reason,
      ),
    ).toContain(BUDDY_REASONS.INVALID_TITLE);
  });

  it('地点必须来自校园地点白名单（**上线值是中文名**）', () => {
    // ⚠️ 修正说明：本条原先断言 `isKnownLocation('gym')` 为 true —— 那是把
    // **英文 slug** 当成了上线值。服务端白名单校验的是**中文名**，
    // 所以 `gym` 在真实后端上会被判为不在白名单。现已统一到唯一真相。
    expect(isKnownLocation('体育馆')).toBe(true);
    expect(isKnownLocation(' 体育馆 '), '应容错首尾空白').toBe(true);
    expect(isKnownLocation('随便一个地方')).toBe(false);
    // 英文 slug 必须被拒 —— 它就是当初会踩雷的输入
    expect(isKnownLocation('gym')).toBe(false);
    // 上线值即显示名，故 label 是恒等映射
    expect(locationLabel('体育馆')).toBe('体育馆');
    expect(locationLabel('未知地点'), '未知值原样返回，不抛错').toBe('未知地点');
    expect(
      validateBuddyPostDraft(validDraft({ location: '校外某地' }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.UNKNOWN_LOCATION);
  });

  it('开始时间必须在未来', () => {
    expect(
      validateBuddyPostDraft(validDraft({ startsAt: '2026-10-16T14:00:00+08:00' }), { now: NOW }).map(
        (p) => p.reason,
      ),
    ).toContain(BUDDY_REASONS.INVALID_STARTS_AT);
    expect(
      validateBuddyPostDraft(validDraft({ startsAt: '' }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_STARTS_AT);
  });

  it('人数 2–20、时长 30–480', () => {
    expect(
      validateBuddyPostDraft(validDraft({ capacity: 1 }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_CAPACITY);
    expect(
      validateBuddyPostDraft(validDraft({ capacity: 21 }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_CAPACITY);
    expect(
      validateBuddyPostDraft(validDraft({ durationMin: 10 }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_DURATION);
    expect(
      validateBuddyPostDraft(validDraft({ durationMin: 481 }), { now: NOW }).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_DURATION);
  });

  it('运动水平门槛只在 sport 板块生效', () => {
    const problems = validateBuddyPostDraft(
      validDraft({ activity: 'study', minSkillLevel: 'regular' }),
      { now: NOW },
    );
    expect(problems.map((p) => p.reason)).toContain(BUDDY_REASONS.INVALID_SKILL_LEVEL);
    expect(
      validateBuddyPostDraft(validDraft({ activity: 'sport', minSkillLevel: 'regular' }), {
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe('联系方式检测（规格 §6.4，命中即 CONTACT_INFO_IN_DESCRIPTION）', () => {
  it('识别手机号 / 微信 / QQ / 邮箱', () => {
    expect(detectContactInfo('我的手机 13800000000')?.kind).toBe('mobile');
    expect(detectContactInfo('微信：duck2026')?.kind).toBe('wechat');
    expect(detectContactInfo('QQ 12345678')?.kind).toBe('qq');
    expect(detectContactInfo('邮箱 duck@shanghaitech.edu.cn')?.kind).toBe('email');
    expect(detectContactInfo('体育馆 3 号场，打两小时')).toBeNull();
  });

  it('正文命中联系方式时发布被拒，且提示正确路径', () => {
    const problems = validateBuddyPostDraft(
      validDraft({ description: '想来的加我微信：duck2026' }),
      { now: NOW },
    );
    const hit = problems.find((p) => p.reason === BUDDY_REASONS.CONTACT_INFO_IN_DESCRIPTION);
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('站内信');
  });
});

/* ------------------------------------------------------------------ *
 * 可用时段（含跨零点）—— 硬要求
 * ------------------------------------------------------------------ */

describe('可用时段：分钟换算与跨零点（规格 §2.2 / §3.3 F7）', () => {
  it('minutesToHHMM / hhmmToMinutes 互逆；非法输入返回 null（不猜）', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(23 * 60 + 59)).toBe('23:59');
    expect(minutesToHHMM(8 * 60 + 5)).toBe('08:05');
    expect(hhmmToMinutes('08:05')).toBe(485);
    expect(hhmmToMinutes('23:59')).toBe(1439);
    expect(hhmmToMinutes('24:00')).toBeNull();
    expect(hhmmToMinutes('8:5')).toBeNull();
    expect(hhmmToMinutes('abc')).toBeNull();
  });

  it('slotLengthMinutes：普通时段与跨零点时段', () => {
    expect(slotLengthMinutes({ dow: 1, startMin: 480, endMin: 720 })).toBe(240);
    // 23:00 → 次日 01:00 = 2 小时
    expect(slotLengthMinutes({ dow: 5, startMin: 1380, endMin: 60 })).toBe(120);
  });

  it('isCrossMidnight 只在 endMin < startMin 时为 true', () => {
    expect(isCrossMidnight({ dow: 5, startMin: 1380, endMin: 60 })).toBe(true);
    expect(isCrossMidnight({ dow: 5, startMin: 480, endMin: 720 })).toBe(false);
  });

  it('formatAvailabilitySlot 给跨零点时段加「次日」前缀', () => {
    expect(formatAvailabilitySlot({ dow: 1, startMin: 480, endMin: 720 })).toBe('周一 08:00–12:00');
    expect(formatAvailabilitySlot({ dow: 5, startMin: 1380, endMin: 60 })).toBe(
      '周五 23:00–次日 01:00',
    );
  });

  it('describeAvailability 汇总段数、小时数与跨零点段数', () => {
    expect(describeAvailability([])).toContain('未设置');
    const summary = describeAvailability([
      { dow: 1, startMin: 480, endMin: 720 },
      { dow: 5, startMin: 1380, endMin: 60 },
    ]);
    expect(summary).toContain('每周 2 段');
    expect(summary).toContain('1 段跨零点');
  });

  it('validateAvailability：跨零点合法，起止相同非法', () => {
    expect(validateAvailability([{ dow: 5, startMin: 1380, endMin: 60 }])).toEqual([]);
    const problems = validateAvailability([{ dow: 5, startMin: 600, endMin: 600 }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toBe(BUDDY_REASONS.INVALID_AVAILABILITY);
  });

  it('validateAvailabilitySlot 拒绝越界的 dow / 分钟', () => {
    expect(validateAvailabilitySlot({ dow: 7, startMin: 0, endMin: 60 })?.reason).toBe(
      BUDDY_REASONS.INVALID_AVAILABILITY,
    );
    expect(validateAvailabilitySlot({ dow: 1, startMin: -1, endMin: 60 })?.reason).toBe(
      BUDDY_REASONS.INVALID_AVAILABILITY,
    );
    expect(validateAvailabilitySlot({ dow: 1, startMin: 1440, endMin: 60 })?.reason).toBe(
      BUDDY_REASONS.INVALID_AVAILABILITY,
    );
    expect(validateAvailabilitySlot({ dow: 1, startMin: 0, endMin: 60 })).toBeNull();
  });

  it('overlapsAvailability（共享纯函数）：跨零点活动落在次日的时段里', () => {
    // 周五 23:00 → 次日（周六）01:00
    const slots: BuddyAvailabilitySlot[] = [{ dow: 5, startMin: 23 * 60, endMin: 60 }];

    // 周五 23:30 开始，踢 60 分钟（23:30–00:30）→ 命中
    expect(
      overlapsAvailability(slots, new Date('2026-10-23T23:30:00+08:00'), 60, 'Asia/Shanghai'),
    ).toBe(true);

    // 周六 00:30 开始 30 分钟（00:30–01:00）→ 落在跨零点时段内，命中
    expect(
      overlapsAvailability(slots, new Date('2026-10-24T00:30:00+08:00'), 30, 'Asia/Shanghai'),
    ).toBe(true);

    // 周五 22:00 开始 60 分钟（22:00–23:00）→ 恰好结束在时段开始前，不命中
    expect(
      overlapsAvailability(slots, new Date('2026-10-23T22:00:00+08:00'), 60, 'Asia/Shanghai'),
    ).toBe(false);

    // 周六 01:30 开始 → 时段已结束，不命中
    expect(
      overlapsAvailability(slots, new Date('2026-10-24T01:30:00+08:00'), 30, 'Asia/Shanghai'),
    ).toBe(false);

    // 周日 23:30 → 星期不匹配，不命中
    expect(
      overlapsAvailability(slots, new Date('2026-10-25T23:30:00+08:00'), 60, 'Asia/Shanghai'),
    ).toBe(false);
  });

  it('overlapsAvailability：空时段 / 零时长一律不命中', () => {
    expect(
      overlapsAvailability([], new Date('2026-10-23T23:30:00+08:00'), 60, 'Asia/Shanghai'),
    ).toBe(false);
    expect(
      overlapsAvailability(
        [{ dow: 5, startMin: 1380, endMin: 60 }],
        new Date('2026-10-23T23:30:00+08:00'),
        0,
        'Asia/Shanghai',
      ),
    ).toBe(false);
  });

  it('availabilityOverlapsPost 包装：用帖子的 startsAt + durationMin', () => {
    const slots: BuddyAvailabilitySlot[] = [{ dow: 5, startMin: 23 * 60, endMin: 60 }];
    expect(
      availabilityOverlapsPost(slots, {
        startsAt: '2026-10-23T23:30:00+08:00',
        durationMin: 60,
      }),
    ).toBe(true);
    expect(
      availabilityOverlapsPost(slots, {
        startsAt: '2026-10-24T02:00:00+08:00',
        durationMin: 60,
      }),
    ).toBe(false);
    expect(
      availabilityOverlapsPost(slots, { startsAt: 'bad-date', durationMin: 60 }),
    ).toBe(false);
  });

  it('跨零点时段能通过资料校验（这是对规格 endMin>startMin 的显式扩展）', () => {
    expect(
      validateBuddyProfileDraft(
        validProfileDraft({ availability: [{ dow: 5, startMin: 1380, endMin: 60 }] }),
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 资料校验
 * ------------------------------------------------------------------ */

describe('validateBuddyProfileDraft（规格 §2.2）', () => {
  it('合法资料没有问题', () => {
    expect(validateBuddyProfileDraft(validProfileDraft())).toEqual([]);
  });

  it('至少选一个板块', () => {
    expect(
      validateBuddyProfileDraft(validProfileDraft({ sections: [] })).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.NO_SECTION);
  });

  it('兴趣标签 ≤20、活动标签 ≤10', () => {
    const many = BUDDY_ACTIVE_TAGS.slice(0, 21).map((tag) => tag.key);
    expect(
      validateBuddyProfileDraft(validProfileDraft({ interestTags: many })).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.TOO_MANY_INTERESTS);
    const manyActivities = BUDDY_ACTIVE_TAGS.slice(0, 11).map((tag) => tag.key);
    expect(
      validateBuddyProfileDraft(validProfileDraft({ activityTags: manyActivities })).map(
        (p) => p.reason,
      ),
    ).toContain(BUDDY_REASONS.TOO_MANY_ACTIVITIES);
  });

  it('兴趣标签也必须是登记在册的 key（封闭标签）', () => {
    expect(
      validateBuddyProfileDraft(validProfileDraft({ interestTags: ['打羽毛球'] })).map(
        (p) => p.reason,
      ),
    ).toContain('UNKNOWN_TAG:打羽毛球');
  });

  it('常去区域 ≤5 且必须来自校园地点清单（**提交的是中文名，不是英文 slug**）', () => {
    // ⚠️ 修正说明：本条原先用 `gym`/`library`/`stadium`/`canteen-1`/`north-gate` 这些
    // **英文 slug** —— 那是 Web 自拟的地点表。服务端白名单校验的是**中文名**
    // （`体育馆`/`图书馆`…），所以英文 slug 在真实后端上**一定会被拒**。
    // 这正是"两端命名空间不相交"这个真实缺陷的测试面；现已统一到唯一真相。
    const five = ['体育馆', '图书馆', '田径场', '一食堂', '校门口'];
    expect(validateBuddyProfileDraft(validProfileDraft({ preferredAreas: five }))).toEqual([]);

    expect(
      validateBuddyProfileDraft(validProfileDraft({ preferredAreas: [...five, '宿舍区'] })).map(
        (p) => p.reason,
      ),
    ).toContain(BUDDY_REASONS.TOO_MANY_AREAS);

    expect(
      validateBuddyProfileDraft(validProfileDraft({ preferredAreas: ['外滩'] })).map((p) => p.reason),
    ).toContain('UNKNOWN_LOCATION:外滩');

    // 英文 slug 现在**必须**被拒（它就是当初会踩雷的输入）
    expect(
      validateBuddyProfileDraft(validProfileDraft({ preferredAreas: ['gym'] })).map((p) => p.reason),
    ).toContain('UNKNOWN_LOCATION:gym');
  });

  it('院系 ≤64 字、自述 ≤200 字', () => {
    expect(
      validateBuddyProfileDraft(validProfileDraft({ department: 'x'.repeat(65) })).map(
        (p) => p.reason,
      ),
    ).toContain(BUDDY_REASONS.INVALID_DEPARTMENT);
    expect(
      validateBuddyProfileDraft(validProfileDraft({ bio: 'x'.repeat(201) })).map((p) => p.reason),
    ).toContain(BUDDY_REASONS.INVALID_BIO);
  });
});

/* ------------------------------------------------------------------ *
 * §6 隐私（硬要求）
 * ------------------------------------------------------------------ */

describe('隐私说明常量（规格 §6）', () => {
  it('四条硬要求都有文案', () => {
    expect(BUDDY_PRIVACY_SUMMARY.publicNotice).toContain('公开');
    expect(BUDDY_PRIVACY_SUMMARY.hiddenNotice).toContain('不可见');
    expect(BUDDY_PRIVACY_SUMMARY.contactExchange).toContain('站内信');
    expect(BUDDY_PRIVACY_SUMMARY.withdrawal).toContain('删除');
  });

  it('可见性矩阵覆盖「匹配资料对任何人不可见」与「联系方式申请通过后才可见」', () => {
    const byTopic = new Map(BUDDY_PRIVACY_ITEMS.map((item) => [item.topic, item]));
    const profile = [...byTopic.values()].find((item) => item.topic.includes('匹配资料'));
    expect(profile?.visibility).toBe('never');
    expect(profile?.detail).toContain('包括我申请的那个活动的发起人');

    const contact = [...byTopic.values()].find((item) => item.topic.includes('联系方式'));
    expect(contact?.visibility).toBe('after-accepted');

    const feedback = [...byTopic.values()].find((item) => item.topic.includes('匹配反馈'));
    expect(feedback?.visibility).toBe('never');
  });

  it('矩阵里不出现「性别/年龄进匹配」这种说法：它们标为不可见', () => {
    const gender = BUDDY_PRIVACY_ITEMS.find((item) => item.topic.includes('性别'));
    expect(gender?.visibility).toBe('never');
    expect(gender?.detail).toContain('不进向量');
  });
});
