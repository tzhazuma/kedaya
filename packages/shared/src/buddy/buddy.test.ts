import { describe, expect, it } from 'vitest';
import {
  overlapsAvailability,
  overlapsAvailabilityMinutes,
  zonedDowAndMinute,
  type AvailabilitySlot,
} from './availability';
import {
  applyHardFilters,
  baseScoreFromCosineDistance,
  explainMatch,
  feedbackAdjustment,
  FEEDBACK_ACTION_WEIGHTS,
  fuseScore,
  ruleScoreFor,
  type MatchSubject,
} from './scoring';
import { cosineDistance, hashVector, l2Normalize, profileText } from './hashVector';

/* ================================================================== *
 * 可用时段（规格 §3.3 F7）—— 含跨零点边界
 * ================================================================== */

/** 周一 18:00–22:00。约定：dow 0=周日…6=周六，故周一 = dow 1 */
const MON_1800_2200: AvailabilitySlot = { dow: 1, startMin: 18 * 60, endMin: 22 * 60 };
/** 周内分钟数从**周日 00:00** 起算 → 周一 = 1*1440 */
const MON_18_22_MIN_OF_WEEK = 1 * 1440 + 18 * 60;

describe('overlapsAvailabilityMinutes', () => {
  it('完全落在时段内 → true', () => {
    expect(overlapsAvailabilityMinutes([MON_1800_2200], MON_18_22_MIN_OF_WEEK, 60)).toBe(true);
  });

  it('完全在时段外 → false', () => {
    // 周一 10:00
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 10 * 60, 60)).toBe(false);
    // 周二 18:00（不是周一）
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 2 * 1440 + 18 * 60, 60)).toBe(false);
  });

  it('部分重叠也算 → true', () => {
    // 周一 21:30 + 60min = 22:30，与 18–22 重叠 30 分钟
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 21 * 60 + 30, 60)).toBe(true);
    // 周一 17:30 + 60min = 18:30，重叠 30 分钟
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 17 * 60 + 30, 60)).toBe(true);
  });

  it('紧贴但不重叠 → false（半开区间）', () => {
    // 周一 22:00 + 60min 从 22:00 开始，与 [18:00, 22:00) 不相交
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 22 * 60, 60)).toBe(false);
    // 周一 17:00 + 60min 到 18:00 结束，不相交
    expect(overlapsAvailabilityMinutes([MON_1800_2200], 1 * 1440 + 17 * 60, 60)).toBe(false);
  });

  it('⚠️ 跨零点：23:30 + 90min 落到次日，应匹配周二的凌晨时段', () => {
    // 周一 23:30 + 90min → 周二 01:00
    const monLate = 1 * 1440 + 23 * 60 + 30;
    const tueEarly: AvailabilitySlot = { dow: 2, startMin: 0, endMin: 2 * 60 };
    expect(overlapsAvailabilityMinutes([tueEarly], monLate, 90)).toBe(true);
    // 若只比当天（周一 0–2 点），则不应匹配
    const monEarly: AvailabilitySlot = { dow: 1, startMin: 0, endMin: 2 * 60 };
    expect(overlapsAvailabilityMinutes([monEarly], monLate, 90)).toBe(false);
  });

  it('⚠️ 跨零点：slot 自身跨零点（22:00–02:00）', () => {
    const overnight: AvailabilitySlot = { dow: 1, startMin: 22 * 60, endMin: 2 * 60 };
    // 周一 23:00 + 60min
    expect(overlapsAvailabilityMinutes([overnight], 1 * 1440 + 23 * 60, 60)).toBe(true);
    // 周二 01:00 + 30min（落在跨零点的尾巴上）
    expect(overlapsAvailabilityMinutes([overnight], 2 * 1440 + 1 * 60, 30)).toBe(true);
    // 周二 03:00（已过尾段）
    expect(overlapsAvailabilityMinutes([overnight], 2 * 1440 + 3 * 60, 30)).toBe(false);
  });

  it('空可用时段 → false；时长为 0 或负 → false', () => {
    expect(overlapsAvailabilityMinutes([], MON_18_22_MIN_OF_WEEK, 60)).toBe(false);
    expect(overlapsAvailabilityMinutes([MON_1800_2200], MON_18_22_MIN_OF_WEEK, 0)).toBe(false);
    expect(overlapsAvailabilityMinutes([MON_1800_2200], MON_18_22_MIN_OF_WEEK, -30)).toBe(false);
  });

  it('多个时段任一命中即可', () => {
    const slots: AvailabilitySlot[] = [
      { dow: 3, startMin: 8 * 60, endMin: 10 * 60 },
      MON_1800_2200,
    ];
    expect(overlapsAvailabilityMinutes(slots, MON_18_22_MIN_OF_WEEK, 60)).toBe(true);
  });
});

describe('zonedDowAndMinute / overlapsAvailability', () => {
  it('按时区取出星期与分钟（Asia/Shanghai）', () => {
    // 2026-10-19 是周一；UTC 10:00 = 上海 18:00
    const { dow, minuteOfDay } = zonedDowAndMinute(new Date('2026-10-19T10:00:00Z'), 'Asia/Shanghai');
    expect(dow).toBe(1);
    expect(minuteOfDay).toBe(18 * 60);
  });

  it('同一时刻在不同时区得到不同星期/分钟（证明时区真的生效）', () => {
    const at = new Date('2026-10-19T20:00:00Z'); // 上海 周二 04:00 / UTC 周一 20:00
    const sh = zonedDowAndMinute(at, 'Asia/Shanghai');
    const utc = zonedDowAndMinute(at, 'UTC');
    expect(utc).toEqual({ dow: 1, minuteOfDay: 20 * 60 });
    expect(sh).toEqual({ dow: 2, minuteOfDay: 4 * 60 });
  });

  it('overlapsAvailability 端到端', () => {
    // 上海 周一 19:00
    const at = new Date('2026-10-19T11:00:00Z');
    expect(overlapsAvailability([MON_1800_2200], at, 60)).toBe(true);
    // 上海 周一 08:00
    const morning = new Date('2026-10-19T00:00:00Z');
    expect(overlapsAvailability([MON_1800_2200], morning, 60)).toBe(false);
  });
});

/* ================================================================== *
 * 硬过滤（规格 §3.3 F1–F7）
 * ================================================================== */

const NOW = new Date('2026-10-20T12:00:00Z');
const FUTURE = new Date('2026-10-25T10:00:00Z');
const PAST = new Date('2026-10-19T10:00:00Z');

const baseFilter = {
  status: 'OPEN',
  joinedCount: 1,
  capacity: 4,
  startsAt: FUTURE,
  creatorId: 'u-other',
  viewerId: 'u-me',
  alreadyApplied: false,
  genderCompatible: true,
  availabilityOverlaps: true,
};

describe('applyHardFilters', () => {
  it('全部满足 → pass', () => {
    expect(applyHardFilters(baseFilter, NOW)).toEqual({ pass: true, failed: [] });
  });

  it.each([
    ['F1 已满', { joinedCount: 4 }],
    ['F1 已关闭', { status: 'CLOSED' }],
    ['F2 已过期', { startsAt: PAST }],
    ['F3 自己发的', { creatorId: 'u-me' }],
    ['F4 已申请', { alreadyApplied: true }],
    ['F5 性别不相容', { genderCompatible: false }],
    ['F7 时间碰不上', { availabilityOverlaps: false }],
  ])('%s → 被过滤', (label, patch) => {
    const r = applyHardFilters({ ...baseFilter, ...patch }, NOW);
    expect(r.pass, label).toBe(false);
    expect(r.failed.length).toBeGreaterThan(0);
  });

  it('F6 技能等级不足 → 被过滤；足够 → 通过', () => {
    const rank = (l: string) => ({ beginner: 0, intermediate: 1, advanced: 2 })[l] ?? 0;
    const low = applyHardFilters(
      { ...baseFilter, minSkillLevel: 'advanced', viewerSkillLevel: 'beginner', skillRank: rank },
      NOW,
    );
    expect(low.failed).toContain('F6');
    const ok = applyHardFilters(
      { ...baseFilter, minSkillLevel: 'beginner', viewerSkillLevel: 'advanced', skillRank: rank },
      NOW,
    );
    expect(ok.pass).toBe(true);
  });

  it('可同时命中多条', () => {
    const r = applyHardFilters(
      { ...baseFilter, status: 'CLOSED', alreadyApplied: true, availabilityOverlaps: false },
      NOW,
    );
    expect(r.failed).toEqual(expect.arrayContaining(['F1', 'F4', 'F7']));
  });
});

/* ================================================================== *
 * 规则分（规格 §3.3 软打分表）
 * ================================================================== */

const me: MatchSubject = {
  department: 'SIST',
  interestTags: ['badminton', 'hiking', 'coffee'],
  activityTags: ['running'],
  preferredAreas: ['library', 'gym'],
  skillLevel: 'intermediate',
};

describe('ruleScoreFor', () => {
  it('academic：同院系 +0.4、共同兴趣 +0.1×n（上限 0.3）、共同活动 +0.1', () => {
    const s = ruleScoreFor('academic', me, {
      creator: { ...me, interestTags: ['badminton', 'hiking'], activityTags: ['running'] },
      tags: [],
    });
    // 0.4 + min(0.3, 0.1*2)=0.2 + 0.1 = 0.7
    expect(s).toBeCloseTo(0.7, 6);
  });

  it('academic：**没有**「同学校」的 0.2 —— 这是刻意的适配', () => {
    // 只有院系不同、兴趣不同、活动不同 → 应为 0（若保留「同学校」会是 0.2）
    const s = ruleScoreFor('academic', me, {
      creator: { department: 'SLST', interestTags: [], activityTags: [] },
      tags: [],
    });
    expect(s).toBe(0);
  });

  it('daily：共同兴趣 +0.15×n（上限 0.5）+ 时段重叠 0.2 + 同区域 0.1', () => {
    const s = ruleScoreFor(
      'daily',
      me,
      {
        creator: { interestTags: ['badminton', 'hiking'], preferredAreas: ['library'] },
        tags: [],
      },
      { availabilityOverlaps: true },
    );
    // min(0.5, 0.3) + 0.2 + 0.1 = 0.6
    expect(s).toBeCloseTo(0.6, 6);
  });

  it('daily：时段不重叠则拿不到那 0.2', () => {
    const withOverlap = ruleScoreFor('daily', me, { creator: { interestTags: ['badminton'] }, tags: [] }, { availabilityOverlaps: true });
    const without = ruleScoreFor('daily', me, { creator: { interestTags: ['badminton'] }, tags: [] }, { availabilityOverlaps: false });
    expect(withOverlap - without).toBeCloseTo(0.2, 6);
  });

  it('sport：同水平 +0.3、共同活动 +0.15×n（上限 0.4）、共同兴趣 +0.1×n（上限 0.2）、同区域 0.1', () => {
    const s = ruleScoreFor('sport', me, {
      creator: {
        skillLevel: 'intermediate',
        activityTags: ['running', 'swimming'],
        interestTags: ['badminton'],
        preferredAreas: ['gym'],
      },
      tags: [],
    });
    // 0.3（同水平）+ min(0.4, 0.15×1=0.15) + min(0.2, 0.10×1=0.10) + 0.1（同区域）= 0.65
    // ⚠️ 初版注释把「共同活动」按 2 项算成 0.3，实际只有 1 项（running）—— 期望值已修正
    expect(s).toBeCloseTo(0.65, 6);
  });

  it('规则分被 clamp 到 [0,1]（sport 理论上限正好 1.0，不会溢出）', () => {
    const rich: MatchSubject = {
      skillLevel: 'advanced',
      activityTags: ['a', 'b', 'c', 'd'],
      interestTags: ['x', 'y', 'z'],
      preferredAreas: ['gym'],
    };
    const s = ruleScoreFor('sport', rich, { creator: { ...rich }, tags: [] });
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
    // 0.3 + 0.4 + 0.2 + 0.1 = 1.0
    expect(s).toBeCloseTo(1.0, 6);
  });

  it('空特征不会抛错，返回 0', () => {
    expect(ruleScoreFor('daily', { interestTags: [], activityTags: [] }, { creator: { interestTags: [], activityTags: [] }, tags: [] })).toBe(0);
  });
});

describe('explainMatch', () => {
  it('给出可解释理由，按权重降序', () => {
    const reasons = explainMatch(
      'daily',
      me,
      { creator: { interestTags: ['badminton', 'hiking'], preferredAreas: ['library'] }, tags: [] },
      { availabilityOverlaps: true },
    );
    expect(reasons.map((r) => r.code)).toContain('shared-interests');
    expect(reasons.map((r) => r.code)).toContain('availability-overlap');
    expect(reasons.map((r) => r.code)).toContain('same-area');
    // 降序
    for (let i = 1; i < reasons.length; i += 1) {
      expect(reasons[i - 1]!.weight).toBeGreaterThanOrEqual(reasons[i]!.weight);
    }
  });

  it('无共同点 → 空理由（不编造）', () => {
    expect(explainMatch('daily', me, { creator: { interestTags: [], activityTags: [] }, tags: [] })).toEqual([]);
  });
});

/* ================================================================== *
 * 反馈衰减（规格 §3.6）—— 对应 STUMatch test_matching.py:121-167
 * ================================================================== */

describe('feedbackAdjustment', () => {
  it('权重表与 STUMatch 一致', () => {
    expect(FEEDBACK_ACTION_WEIGHTS).toEqual({ like: 0.2, dislike: -0.3, skip: -0.05 });
  });

  it('刚发生的反馈不衰减', () => {
    const m = feedbackAdjustment([{ targetPostId: 'p1', action: 'like', createdAt: NOW }], NOW);
    expect(m.get('p1')).toBeCloseTo(0.2, 6);
  });

  it('按 exp(-days/30) 衰减（**时间常数**，不是半衰期）', () => {
    const d30 = new Date(NOW.getTime() - 30 * 86_400_000);
    const m = feedbackAdjustment([{ targetPostId: 'p1', action: 'like', createdAt: d30 }], NOW);
    // e^-1 ≈ 0.3679，不是 0.5 —— 这正是命名诚实的理由
    expect(m.get('p1')).toBeCloseTo(0.2 * Math.exp(-1), 6);
    expect(m.get('p1')).toBeLessThan(0.1);
  });

  it('dislike / skip 为负', () => {
    const m = feedbackAdjustment(
      [
        { targetPostId: 'p1', action: 'dislike', createdAt: NOW },
        { targetPostId: 'p2', action: 'skip', createdAt: NOW },
      ],
      NOW,
    );
    expect(m.get('p1')).toBeCloseTo(-0.3, 6);
    expect(m.get('p2')).toBeCloseTo(-0.05, 6);
  });

  it('同一帖子多次反馈 → 最后一次生效（不累积）', () => {
    const m = feedbackAdjustment(
      [
        { targetPostId: 'p1', action: 'skip', createdAt: NOW },
        { targetPostId: 'p1', action: 'like', createdAt: NOW },
      ],
      NOW,
    );
    expect(m.get('p1')).toBeCloseTo(0.2, 6);
    expect(m.size).toBe(1);
  });

  it('未来时间不产生正增益（days 被夹到 ≥0）', () => {
    const future = new Date(NOW.getTime() + 10 * 86_400_000);
    const m = feedbackAdjustment([{ targetPostId: 'p1', action: 'like', createdAt: future }], NOW);
    expect(m.get('p1')).toBeCloseTo(0.2, 6);
  });

  it('空反馈 → 空 Map', () => {
    expect(feedbackAdjustment([], NOW).size).toBe(0);
  });
});

/* ================================================================== *
 * 融合（规格 §3.4）
 * ================================================================== */

describe('fuseScore', () => {
  it('rule 模式：规则分占满', () => {
    expect(fuseScore({ mode: 'rule', ruleScore: 0.6 })).toBeCloseTo(0.6, 6);
  });

  it('rule 模式：反馈叠加后仍被 clamp', () => {
    expect(fuseScore({ mode: 'rule', ruleScore: 0.9, feedbackAdjustment: 0.5 })).toBe(1);
    expect(fuseScore({ mode: 'rule', ruleScore: 0.1, feedbackAdjustment: -0.5 })).toBe(0);
  });

  it('vector 模式且**无** towerScore → base×0.7 + rule×0.3（与 STUMatch no-tower 分支一致）', () => {
    expect(fuseScore({ mode: 'vector', baseScore: 1, ruleScore: 0 })).toBeCloseTo(0.7, 6);
    expect(fuseScore({ mode: 'vector', baseScore: 0, ruleScore: 1 })).toBeCloseTo(0.3, 6);
    expect(fuseScore({ mode: 'vector', baseScore: 1, ruleScore: 1 })).toBeCloseTo(1, 6);
  });

  it('hash 模式与 vector 模式同公式（差别只在向量怎么来，并在响应里标注）', () => {
    const a = fuseScore({ mode: 'hash', baseScore: 0.5, ruleScore: 0.5 });
    const b = fuseScore({ mode: 'vector', baseScore: 0.5, ruleScore: 0.5 });
    expect(a).toBe(b);
  });

  it('显式给 towerScore 时才走 0.50/0.30/0.20 三权重', () => {
    expect(fuseScore({ mode: 'vector', baseScore: 1, ruleScore: 1, towerScore: 1 })).toBeCloseTo(1, 6);
    expect(fuseScore({ mode: 'vector', baseScore: 1, ruleScore: 0, towerScore: 0 })).toBeCloseTo(0.5, 6);
  });

  it('结果恒在 [0,1]', () => {
    for (const base of [0, 0.5, 1, 2, -1]) {
      for (const rule of [0, 0.5, 1, 2, -1]) {
        const s = fuseScore({ mode: 'vector', baseScore: base, ruleScore: rule });
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('baseScoreFromCosineDistance', () => {
  it('距离 0 → 1；距离 1 → 0；距离 >1 夹到 0', () => {
    expect(baseScoreFromCosineDistance(0)).toBe(1);
    expect(baseScoreFromCosineDistance(1)).toBe(0);
    expect(baseScoreFromCosineDistance(1.7)).toBe(0);
    expect(baseScoreFromCosineDistance(-0.5)).toBe(1);
  });
});

/* ================================================================== *
 * 哈希向量（规格 §3.5）
 * ================================================================== */

describe('hashVector', () => {
  it('确定性：同文本同向量', () => {
    expect(hashVector('羽毛球 跑步')).toEqual(hashVector('羽毛球 跑步'));
  });

  it('维度正确且已 L2 归一化（模长 ≈ 1）', () => {
    const v = hashVector('羽毛球 跑步 咖啡', 128);
    expect(v).toHaveLength(128);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 9);
  });

  it('空文本 → 零向量（不产生 NaN）', () => {
    const v = hashVector('', 16);
    expect(v).toHaveLength(16);
    expect(v.every((x) => x === 0)).toBe(true);
    expect(v.some((x) => Number.isNaN(x))).toBe(false);
  });

  it('emoji / 代理对不被拆坏（按码点切分）', () => {
    expect(() => hashVector('🏸羽毛球', 64)).not.toThrow();
    expect(hashVector('🏸', 64)).toHaveLength(64);
  });

  it('dim 非法抛错', () => {
    expect(() => hashVector('x', 0)).toThrow(RangeError);
    expect(() => hashVector('x', -1)).toThrow(RangeError);
    expect(() => hashVector('x', 1.5)).toThrow(RangeError);
  });

  it('相同文本相似度 = 1；完全不同文本 < 1', () => {
    const a = hashVector('羽毛球', 256);
    expect(cosineDistance(a, a)).toBeCloseTo(0, 9);
    const b = hashVector('量子力学导论', 256);
    expect(cosineDistance(a, b)).toBeGreaterThan(0);
  });

  it('⚠️ 它是字符级哈希，**不是**语义向量（把这一点钉死）', () => {
    // 语义相近但用词不同 → 相似度并不高
    const a = hashVector('羽毛球', 512);
    const b = hashVector('badminton', 512);
    expect(cosineDistance(a, b)).toBeGreaterThan(0.9);
    // 而字符高度重合的文本相似度很高 —— 这正是"非语义"的证据
    const c = hashVector('羽毛球拍', 512);
    expect(cosineDistance(a, c)).toBeLessThan(0.9);
  });
});

describe('l2Normalize / profileText', () => {
  it('零向量原样返回', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('profileText 对标签排序 → 输入顺序不影响结果（保证确定性）', () => {
    const a = profileText({ interestTags: ['b', 'a'], activityTags: ['y', 'x'] });
    const b = profileText({ interestTags: ['a', 'b'], activityTags: ['x', 'y'] });
    expect(a).toBe(b);
  });
});
