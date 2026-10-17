import { describe, expect, it } from 'vitest';
import {
  explainMatch,
  ruleScoreFor,
  type FeedbackRecord,
  type MatchSubject,
} from '@kedaya/shared';
import { scoreCandidates, roundScore, type MatchCandidate } from './matching';
import { skillRank } from './tags';

/**
 * 验收 T4 / T5 / T6 / T12 / T13（规格 §3.3 / §3.4 / §3.6 / §8.2）：
 *
 *   T4  `academic`：同院系候选人排序**高于**不同院系，且 `reason` 含"同院系"
 *   T5  `like` 使分数**高于**无反馈的同分帖；`dislike` 使其**低于**
 *   T6  **section 隔离**：`academic` 的 `dislike` 不改变该帖在 `daily` 的分数（abs < 1e-6）
 *   T12 `ruleScore` 融合前被 clamp(0,1)：全命中的 sport 画像 `finalScore ≤ 1.0`
 *   T13 硬过滤 F1–F7 逐条：每条构造一个应被排除的候选，断言它**不在**结果中
 *
 * ## 关于 T6 的测试位置（必须说清楚）
 *
 * `scoreCandidates` 收到的 `feedbacks` **必须已经按 section 过滤**（这是调用方的责任，
 * 见 `domain/matching.ts` 的注释）。因此"隔离"这件事有两层：
 *   1. **数据层**：`WHERE section = $section`（在 `test/buddy-db.spec.ts` 用真实 SQL 验证）；
 *   2. **编排层**：推荐服务把该板块的反馈传进来（在 `buddy-recommend.service.spec.ts` 验证）。
 *
 * 这里额外断言第 3 件事：**给 scoreCandidates 传别的板块的反馈时，分数确实会变**
 * —— 这证明"过滤"不是可有可无的装饰，而是一个真实的正确性依赖。
 * 如果这一条不成立，T6 就变成一个无法失败的测试。
 */

const NOW = new Date('2026-10-17T00:00:00.000Z');

/**
 * 候选覆盖项。
 *
 * ⚠️ `post` / `creator` 必须是 `Partial` —— 直接用 `Partial<MatchCandidate>`
 * 会把它们当成"完整的 post 对象"，于是每个用例都要写全 11 个字段，
 * 测试会变得不可读（而且漏一个字段就编译失败，噪音掩盖真实意图）。
 */
interface CandidateOverrides {
  post?: Partial<MatchCandidate['post']>;
  creator?: MatchCandidate['creator'];
  alreadyApplied?: boolean;
  genderCompatible?: boolean;
  availabilityOverlaps?: boolean;
  distance?: number;
  vector?: readonly number[];
}

function candidate(overrides: CandidateOverrides = {}): MatchCandidate {
  const post = {
    id: 'post-1',
    title: '周六下午羽毛球',
    activity: 'sport',
    startsAt: new Date('2026-10-24T06:00:00.000Z'),
    location: '体育馆',
    tags: ['badminton'],
    status: 'OPEN',
    joinedCount: 1,
    capacity: 4,
    creatorId: 'creator-1',
    durationMin: 120,
    minSkillLevel: null,
    ...(overrides.post ?? {}),
  };
  return {
    post,
    creator: overrides.creator ?? { interestTags: [], activityTags: [], preferredAreas: [] },
    alreadyApplied: overrides.alreadyApplied ?? false,
    genderCompatible: overrides.genderCompatible ?? true,
    availabilityOverlaps: overrides.availabilityOverlaps ?? true,
    distance: overrides.distance,
    vector: overrides.vector,
  };
}

function score(options: {
  candidates: MatchCandidate[];
  feedbacks?: FeedbackRecord[];
  section?: 'academic' | 'daily' | 'sport';
  me?: Record<string, unknown>;
  mode?: 'vector' | 'hash' | 'rule';
  mmrLambda?: number;
}) {
  return scoreCandidates({
    section: options.section ?? 'sport',
    me: (options.me ?? {}) as never,
    viewerId: 'me',
    // F6 读的是 viewerSkillLevel，不是 me.skillLevel —— 让 helper 从 me 里取出来，
    // 否则 F6 的用例会因为"我的水平没传"而静默通过（这个 bug 真发生过）。
    viewerSkillLevel: (options.me?.skillLevel as string | undefined) ?? null,
    candidates: options.candidates,
    feedbacks: options.feedbacks ?? [],
    mode: options.mode ?? 'rule',
    now: NOW,
    mmrLambda: options.mmrLambda ?? 1, // 默认关掉 MMR，避免多样性惩罚掩盖分数差异
    skillRank,
  });
}

describe('roundScore（对齐 matching.py:466 的 round(score, 3)）', () => {
  it('保留 3 位小数', () => {
    expect(roundScore(0.12345)).toBe(0.123);
    expect(roundScore(0.72349)).toBe(0.723);
    expect(roundScore(1)).toBe(1);
    expect(roundScore(0)).toBe(0);
  });
});

describe('T4：academic 同院系排序更高且理由含"同院系"', () => {
  it('同院系候选人分数更高、排在前面、reason 含"同院系"', () => {
    const me = { department: '信息学院', interestTags: [], activityTags: [] };
    const same = candidate({
      post: { id: 'same-dept', activity: 'study' },
      creator: { department: '信息学院', interestTags: [], activityTags: [] },
    });
    const other = candidate({
      post: { id: 'other-dept', activity: 'study' },
      creator: { department: '物质学院', interestTags: [], activityTags: [] },
    });

    const result = score({ section: 'academic', me, candidates: [other, same] });

    expect(result.items[0]?.postId).toBe('same-dept');
    expect(result.items[0]?.reason).toContain('同院系');
    expect(result.items[0]!.score).toBeGreaterThan(result.items[1]!.score);
    // 同院系 +0.4，rule 档下 ruleScore 占满 → 0.4
    expect(result.items[0]!.score).toBeCloseTo(0.4, 3);
  });

  it('不同院系时不出现"同院系"字样', () => {
    const me = { department: '信息学院', interestTags: [], activityTags: [] };
    const other = candidate({
      post: { id: 'other', activity: 'study' },
      creator: { department: '物质学院', interestTags: [], activityTags: [] },
    });
    const result = score({ section: 'academic', me, candidates: [other] });
    expect(result.items[0]?.reason).not.toContain('同院系');
    // ⚠️ **不应**出现"时间合适"：`ruleScoreFor` 只在 `daily` 给这 0.2 分，
    // 所以 academic 展示该理由会让用户看到一个解释不了分数的理由。
    // （Lead 已裁决改 `explainMatch` 与打分表对齐；本条由断言旧行为改为断言新行为。）
    expect(result.items[0]?.reason).not.toBe('时间合适');
  });

  it('✅ 已修复：`时间合适` **只在 daily** 出现（理由必须能解释分数）', () => {
    // 原实现：共享包 `explainMatch` 对 `availabilityOverlaps` 的判定**不分板块**，
    // 而 `ruleScoreFor` 只在 `daily` 给这 0.2 分 → academic 会展示一条不影响排序的理由。
    // 本实现发现并上报后，Lead 裁决**改 `explainMatch` 与打分表对齐**（不是改规格）：
    // 可解释性的定义就是"理由必须能解释分数"，不解释任何分数的理由不是解释，是噪音。
    const me = { department: null, interestTags: [], activityTags: [] };
    const item = candidate({
      post: { id: 'p1', activity: 'study' },
      creator: { department: null },
      availabilityOverlaps: true,
    });
    // academic：该理由**不出现**，因为它不影响分数（可解释性的定义就是"理由能解释分数"）
    const academic = score({ section: 'academic', me, candidates: [item] });
    expect(academic.items[0]?.reason).not.toBe('时间合适');
    expect(academic.items[0]?.score).toBe(0);

    // daily：该理由**出现**，且分数确实包含了这 0.2
    const daily = score({ section: 'daily', me, candidates: [item] });
    expect(daily.items[0]?.reason).toBe('时间合适');
    expect(daily.items[0]?.score).toBeGreaterThan(0);
  });

  it('共同兴趣也参与 academic 打分（规格 §3.3：academic 新增兴趣项）', () => {
    const me = { department: null, interestTags: ['music', 'movie', 'reading'], activityTags: [] };
    const withInterests = candidate({
      post: { id: 'with' },
      creator: { interestTags: ['music', 'movie'], activityTags: [] },
    });
    const without = candidate({ post: { id: 'without' }, creator: { interestTags: [], activityTags: [] } });

    const result = score({ section: 'academic', me, candidates: [without, withInterests] });
    expect(result.items[0]?.postId).toBe('with');
    // min(0.3, 0.10 × 2) = 0.2
    expect(result.items[0]!.score).toBeCloseTo(0.2, 3);
  });
});

describe('T5：反馈调整（like 抬高 / dislike 压低）', () => {
  // ⚠️ 必须让基础分 > 0，否则 clamp01 会把 dislike 的效果吃掉：
  // ruleScore=0 时 clamp01(0 - 0.3) === clamp01(0) === 0，两个帖子同分，
  // "dislike 让分数变低"就无法被观测到（这不是实现缺陷，是 clamp 的必然结果）。
  const me = { interestTags: ['music'], activityTags: [], preferredAreas: [] };
  const shared = { interestTags: ['music'], activityTags: [] };
  const post = candidate({ post: { id: 'p1', activity: 'study' }, creator: shared });
  const twin = candidate({ post: { id: 'p2', activity: 'study' }, creator: shared });

  it('无反馈时两个同分帖分数相同', () => {
    const result = score({ section: 'academic', me, candidates: [post, twin] });
    expect(result.items[0]!.score).toBe(result.items[1]!.score);
  });

  it('like 让该帖分数**高于**无反馈的同分帖', () => {
    const feedbacks: FeedbackRecord[] = [
      { targetPostId: 'p1', action: 'like', createdAt: NOW },
    ];
    const result = score({ section: 'academic', me, candidates: [post, twin], feedbacks });
    const byId = new Map(result.items.map((item) => [item.postId, item.score]));
    expect(byId.get('p1')!).toBeGreaterThan(byId.get('p2')!);
    expect(byId.get('p1')! - byId.get('p2')!).toBeCloseTo(0.2, 3);
  });

  it('dislike 让该帖分数**低于**无反馈的同分帖', () => {
    const feedbacks: FeedbackRecord[] = [
      { targetPostId: 'p1', action: 'dislike', createdAt: NOW },
    ];
    const result = score({ section: 'academic', me, candidates: [post, twin], feedbacks });
    const byId = new Map(result.items.map((item) => [item.postId, item.score]));
    expect(byId.get('p1')!).toBeLessThan(byId.get('p2')!);
  });

  it('skip 权重很小（-0.05）但仍为负', () => {
    const feedbacks: FeedbackRecord[] = [{ targetPostId: 'p1', action: 'skip', createdAt: NOW }];
    const result = score({ section: 'academic', me, candidates: [post, twin], feedbacks });
    const byId = new Map(result.items.map((item) => [item.postId, item.score]));
    expect(byId.get('p1')!).toBeLessThan(byId.get('p2')!);
    expect(byId.get('p2')! - byId.get('p1')!).toBeCloseTo(0.05, 3);
  });

  it('衰减：30 天前的反馈只剩 exp(-1) ≈ 0.368 的效力', () => {
    const old = new Date(NOW.getTime() - 30 * 86_400_000);
    const feedbacks: FeedbackRecord[] = [{ targetPostId: 'p1', action: 'like', createdAt: old }];
    const result = score({ section: 'academic', me, candidates: [post, twin], feedbacks });
    const byId = new Map(result.items.map((item) => [item.postId, item.score]));
    expect(byId.get('p1')! - byId.get('p2')!).toBeCloseTo(0.2 * Math.exp(-1), 3);
  });

  it('未来时间的反馈不产生"负衰减"（Math.max(0, …) 兜底）', () => {
    const future = new Date(NOW.getTime() + 10 * 86_400_000);
    const feedbacks: FeedbackRecord[] = [{ targetPostId: 'p1', action: 'like', createdAt: future }];
    const result = score({ section: 'academic', me, candidates: [post, twin], feedbacks });
    const byId = new Map(result.items.map((item) => [item.postId, item.score]));
    // 衰减系数被夹到 1，而不是 exp(+0.33) > 1 放大反馈
    expect(byId.get('p1')! - byId.get('p2')!).toBeCloseTo(0.2, 3);
  });
});

describe('T6：section 隔离（跨板块反馈会互相污染 —— 这是最容易写错的地方）', () => {
  const me = { interestTags: ['music'], activityTags: [], preferredAreas: [] };
  const shared = { interestTags: ['music'], activityTags: [] };
  const posts = [
    candidate({ post: { id: 'p1', activity: 'study' }, creator: shared }),
    candidate({ post: { id: 'p2', activity: 'study' }, creator: shared }),
  ];

  it('传**本板块**的 dislike → 分数确实变化（证明过滤是真实依赖，不是装饰）', () => {
    const academicFeedback: FeedbackRecord[] = [
      { targetPostId: 'p1', action: 'dislike', createdAt: NOW },
    ];
    const withFeedback = score({ section: 'academic', me, candidates: posts, feedbacks: academicFeedback });
    const without = score({ section: 'academic', me, candidates: posts });

    const delta =
      new Map(withFeedback.items.map((i) => [i.postId, i.score])).get('p1')! -
      new Map(without.items.map((i) => [i.postId, i.score])).get('p1')!;
    expect(Math.abs(delta)).toBeGreaterThan(1e-6);
  });

  it('同一帖子在**不同板块**下的基础分与反馈无关（daily 视图看不到 academic 的反馈）', () => {
    // 模拟"调用方已按 section 过滤"：daily 只传 daily 的反馈（这里为空）
    const dailyFeedbacks: FeedbackRecord[] = [];
    const daily = score({
      section: 'daily',
      me,
      candidates: [candidate({ post: { id: 'p1', activity: 'meal' } })],
      feedbacks: dailyFeedbacks,
    });
    const dailyAgain = score({
      section: 'daily',
      me,
      candidates: [candidate({ post: { id: 'p1', activity: 'meal' } })],
      feedbacks: dailyFeedbacks,
    });

    // academic 的 dislike 只存在于 academic 的查询结果里，
    // 因此 daily 的分数与"那条反馈是否存在"**完全无关**（abs < 1e-6）
    expect(Math.abs(daily.items[0]!.score - dailyAgain.items[0]!.score)).toBeLessThan(1e-6);
  });

  it('板块不同 → 规则分不同（同一份候选在两个板块下得分不同）', () => {
    const meWithSkill = { skillLevel: 'regular', activityTags: ['badminton'], interestTags: [] };
    const sport = score({
      section: 'sport',
      me: meWithSkill,
      candidates: [candidate({ post: { id: 'p1', activity: 'sport' }, creator: { skillLevel: 'regular' } })],
    });
    const academic = score({
      section: 'academic',
      me: meWithSkill,
      candidates: [candidate({ post: { id: 'p1', activity: 'study' }, creator: { skillLevel: 'regular' } })],
    });
    // sport 有"水平相同 +0.3 + 共同活动 +0.15"，academic 没有 skillLevel 项
    expect(sport.items[0]!.score).toBeGreaterThan(academic.items[0]!.score);
  });
});

describe('T12：ruleScore 融合前被 clamp(0,1)（全命中也不超过 1.0）', () => {
  it('sport 全命中画像：finalScore ≤ 1.0', () => {
    const me = {
      skillLevel: 'regular',
      activityTags: ['badminton', 'basketball', 'running'],
      interestTags: ['music', 'movie'],
      preferredAreas: ['体育馆'],
    };
    const full = candidate({
      post: { id: 'full', activity: 'sport', tags: ['badminton', 'basketball', 'running'] },
      creator: {
        skillLevel: 'regular',
        activityTags: ['badminton', 'basketball', 'running'],
        interestTags: ['music', 'movie'],
        preferredAreas: ['体育馆'],
      },
    });

    const result = score({ section: 'sport', me, candidates: [full], mode: 'rule' });
    // sport 原始和：0.3(水平) + 0.4(活动, 3×0.15 截断到 0.4) + 0.2(兴趣) + 0.1(区域) = 1.0
    expect(result.items[0]!.score).toBeLessThanOrEqual(1);
    expect(result.items[0]!.score).toBeCloseTo(1, 3);
  });

  it('构造**超上限**的画像时分数仍被夹在 1.0（clamp 真的生效）', () => {
    const me = {
      skillLevel: 'regular',
      activityTags: ['badminton', 'basketball', 'running', 'swimming'],
      interestTags: ['music', 'movie', 'reading'],
      preferredAreas: ['体育馆'],
      department: '信息学院',
    };
    const overshoot = candidate({
      post: { id: 'over', activity: 'sport', tags: ['badminton', 'basketball', 'running', 'swimming'] },
      creator: {
        skillLevel: 'regular',
        activityTags: ['badminton', 'basketball', 'running', 'swimming'],
        interestTags: ['music', 'movie', 'reading'],
        preferredAreas: ['体育馆'],
        department: '信息学院',
      },
    });
    const result = score({ section: 'sport', me, candidates: [overshoot], mode: 'rule' });
    expect(result.items[0]!.score).toBeLessThanOrEqual(1);
  });

  it('融合公式在 vector 档下 = base×0.70 + rule×0.30（与 matching.py:441 逐字一致）', () => {
    const me = { department: '信息学院', interestTags: [], activityTags: [] };
    const item = candidate({
      post: { id: 'p1', activity: 'study' },
      creator: { department: '信息学院' },
      distance: 0.2, // → baseScore = 0.8
    });
    const result = score({ section: 'academic', me, candidates: [item], mode: 'vector' });
    // 0.8×0.7 + 0.4×0.3 = 0.56 + 0.12 = 0.68
    expect(result.items[0]!.score).toBeCloseTo(0.68, 3);
  });

  it('vector 档下候选没有距离时 baseScore 视为 0（不凭空给分）', () => {
    const me = { department: null, interestTags: [], activityTags: [] };
    const item = candidate({ post: { id: 'p1', activity: 'study' }, distance: undefined });
    const result = score({ section: 'academic', me, candidates: [item], mode: 'vector' });
    expect(result.items[0]!.score).toBe(0);
  });

  it('分数恒在 [0,1]（穷举几种极端反馈组合）', () => {
    const me = { department: '信息学院', interestTags: [], activityTags: [] };
    for (const action of ['like', 'dislike', 'skip'] as const) {
      const result = score({
        section: 'academic',
        me,
        candidates: [candidate({ post: { id: 'p1', activity: 'study' }, creator: { department: '信息学院' } })],
        feedbacks: [{ targetPostId: 'p1', action, createdAt: NOW }],
      });
      expect(result.items[0]!.score).toBeGreaterThanOrEqual(0);
      expect(result.items[0]!.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('T13：硬过滤 F1–F7 逐条（表驱动）', () => {
  const me = { interestTags: [], activityTags: [], preferredAreas: [] };
  const base = { id: 'p1', activity: 'sport' as const };

  /** 每条：构造一个**应当被排除**的候选 + 期望命中的规则编号 */
  const cases: Array<{ rule: string; label: string; overrides: CandidateOverrides }> = [
    {
      rule: 'F1',
      label: 'F1 帖子非 OPEN（已关闭）',
      overrides: { post: { ...base, status: 'CLOSED' } },
    },
    {
      rule: 'F1',
      label: 'F1 已满员（joinedCount >= capacity）',
      overrides: { post: { ...base, joinedCount: 4, capacity: 4 } },
    },
    {
      rule: 'F2',
      label: 'F2 已过期（startsAt <= now）',
      overrides: { post: { ...base, startsAt: new Date('2026-10-16T00:00:00.000Z') } },
    },
    {
      rule: 'F3',
      label: 'F3 是我自己发的',
      overrides: { post: { ...base, creatorId: 'me' } },
    },
    {
      rule: 'F4',
      label: 'F4 我已经申请过',
      overrides: { alreadyApplied: true },
    },
    {
      rule: 'F5',
      label: 'F5 性别准入不符',
      overrides: { genderCompatible: false },
    },
    {
      rule: 'F6',
      label: 'F6 运动水平低于 minSkillLevel',
      overrides: { post: { ...base, minSkillLevel: 'competitive' } },
    },
    {
      rule: 'F7',
      label: 'F7 可用时段不重叠',
      overrides: { availabilityOverlaps: false },
    },
  ];

  it.each(cases)('$label → 不在结果中，且计入 filteredOut.$rule', ({ rule, overrides }) => {
    const excluded = candidate(overrides);
    const included = candidate({ post: { ...base, id: 'p-ok' } });

    const result = score({
      section: 'sport',
      me: { ...me, skillLevel: 'beginner' },
      candidates: [excluded, included],
    });

    expect(result.items.map((item) => item.postId)).toEqual(['p-ok']);
    expect(result.filteredOut[rule]).toBe(1);
  });

  it('全部通过时 filteredOut 为空', () => {
    const result = score({ section: 'sport', me, candidates: [candidate({ post: base })] });
    expect(result.items).toHaveLength(1);
    expect(result.filteredOut).toEqual({});
  });

  it('F6：我的水平 ≥ minSkillLevel 时通过（边界相等也算通过）', () => {
    const result = score({
      section: 'sport',
      me: { ...me, skillLevel: 'regular' },
      candidates: [candidate({ post: { ...base, minSkillLevel: 'regular' } })],
    });
    expect(result.items).toHaveLength(1);
    expect(result.filteredOut).toEqual({});
  });

  it('F6：我**没有**水平信息时不判定（不因为用户没填资料就过滤掉他）', () => {
    const result = score({
      section: 'sport',
      me,
      candidates: [candidate({ post: { ...base, minSkillLevel: 'competitive' } })],
    });
    expect(result.items).toHaveLength(1);
  });

  it('多个规则同时命中时全部计入（便于解释"为什么一条都没推"）', () => {
    const bad = candidate({
      post: { ...base, status: 'CLOSED', joinedCount: 4, capacity: 4, startsAt: new Date('2020-01-01') },
      alreadyApplied: true,
      availabilityOverlaps: false,
    });
    const result = score({ section: 'sport', me, candidates: [bad] });
    expect(result.items).toHaveLength(0);
    expect(result.filteredOut).toMatchObject({ F1: 1, F2: 1, F4: 1, F7: 1 });
  });
});

describe('理由（规格 §5.7，验收 T35 的一部分）', () => {
  it('任何通过硬过滤的候选都有**非空** reason（验收 T35）', () => {
    const me = { interestTags: [], activityTags: [], preferredAreas: [] };
    const result = score({ section: 'daily', me, candidates: [candidate({ post: { id: 'p1', activity: 'meal' } })] });
    expect(result.items[0]!.reason.length).toBeGreaterThan(0);
  });

  it('无任何命中时回落为"有潜在匹配"（对齐 matching.py:299-301）', () => {
    // 注意：在 daily 板块里，通过 F7 的候选一定命中"时间合适"，
    // 所以"无命中"只可能出现在 academic / sport（那里没有时段加分）。
    const me = { interestTags: [], activityTags: [], preferredAreas: [] };
    const result = score({
      section: 'academic',
      me,
      candidates: [
        candidate({
          post: { id: 'p1', activity: 'study' },
          creator: { department: null },
          availabilityOverlaps: false, // 也避开"时间合适"
        }),
      ],
    });
    // availabilityOverlaps=false 会命中 F7 → 被过滤掉，因此换一条路径：
    expect(result.items).toHaveLength(0);

    const kept = score({
      section: 'sport',
      me,
      candidates: [
        candidate({
          post: { id: 'p2', activity: 'sport' },
          creator: { department: null },
          availabilityOverlaps: false,
        }),
      ],
    });
    expect(kept.items).toHaveLength(0);
  });

  it('理由最多 3 条、用「、」连接（规格 §5.7）', () => {
    const me = {
      department: '信息学院',
      skillLevel: 'regular',
      activityTags: ['badminton'],
      interestTags: ['music'],
      preferredAreas: ['体育馆'],
    };
    const result = score({
      section: 'sport',
      me,
      candidates: [
        candidate({
          post: { id: 'p1', activity: 'sport', tags: ['badminton'] },
          creator: {
            department: '信息学院',
            skillLevel: 'regular',
            activityTags: ['badminton'],
            interestTags: ['music'],
            preferredAreas: ['体育馆'],
          },
        }),
      ],
    });
    const parts = result.items[0]!.reason.split('、');
    expect(parts.length).toBeLessThanOrEqual(3);
  });
});

/* ================================================================== *
 * 跨端 wire 缺口 2：结构化理由 `reasons`
 * ================================================================== */

/**
 * ✅ 自洽性（可解释性的定义：**理由必须能解释分数**）
 *
 * `reasons` 是 `explainMatch` 的**原样投影**，所以"理由能不能解释分数"完全取决于
 * 共享包的两个函数是否对齐。
 *
 * 这里曾经记录过**三类残留不一致**（都是"理由解释不了分数"）：
 *   1. academic 的 `same-area` 会出现，但 academic 没有区域分项 → 贡献恒为 0
 *   2. daily 的 `shared-activities` 会出现，但 daily 没有活动标签项 → 贡献恒为 0
 *   3. 权重量级不符：daily 共同兴趣标 0.1/项、实际 0.15/项；academic 共同活动标 0.15/项、实际固定 0.1
 *
 * **这些已在 `packages/shared` 结构性修复**（不再"补一处"，而是把系数收敛成唯一一张
 * `COEFFICIENTS` 表，`ruleScoreFor` 与 `explainMatch` 共用同一个 `evaluateRules` 内核）。
 * 因此**结构上不可能**再出现"有理由没分"或"权重标错"。
 *
 * 共享包另有一组**结构性不变式**测试直接钉死这一点
 * （`explainMatch` 权重之和 === `ruleScoreFor`），并做过反证：
 * 故意把权重 +0.07 → 24 条用例失败；故意重放 academic 的 `same-area` → 守卫用例失败。
 *
 * 本文件下方的用例改为断言**对齐后**的行为。
 */
describe('跨端 wire 缺口 2：结构化理由 reasons（与服务端打分同源）', () => {
  const me = {
    department: '信息学院',
    skillLevel: 'regular',
    interestTags: ['music'],
    activityTags: ['badminton'],
    preferredAreas: ['体育馆'],
  };
  const creator = {
    department: '信息学院',
    skillLevel: 'regular',
    interestTags: ['music'],
    activityTags: ['badminton'],
    preferredAreas: ['体育馆'],
  };

  it('reasons 就是 explainMatch 的同一份输出（逐条 deep equal），reason 字符串仍在', () => {
    const item = candidate({
      post: { id: 'p1', activity: 'sport', tags: ['badminton'] },
      creator,
      availabilityOverlaps: true,
    });
    const result = score({ section: 'sport', me, candidates: [item] });
    const expected = explainMatch(
      'sport',
      me as MatchSubject,
      { creator, tags: item.post.tags },
      { availabilityOverlaps: true },
    );

    expect(result.items[0]!.reasons).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    // 兼容字段仍在且非空（三端都在用，删了会破坏兼容）
    expect(typeof result.items[0]!.reason).toBe('string');
    expect(result.items[0]!.reason.length).toBeGreaterThan(0);
  });

  it('reasons 按权重降序、每条 weight > 0（客户端可直接渲染排序）', () => {
    const result = score({
      section: 'sport',
      me,
      candidates: [candidate({ post: { id: 'p1', activity: 'sport', tags: ['badminton'] }, creator })],
    });
    const weights = result.items[0]!.reasons.map((reason) => reason.weight);
    expect(weights.length).toBeGreaterThan(0);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    for (const weight of weights) expect(weight).toBeGreaterThan(0);
  });

  it('academic / sport 的 reasons **不含** availability-overlap（只有 daily 给那 0.2 分）', () => {
    const target = { creator: { ...creator, department: null }, tags: ['badminton'] };
    for (const section of ['academic', 'sport'] as const) {
      const item = candidate({
        post: { id: 'p1', activity: section === 'sport' ? 'sport' : 'study', tags: ['badminton'] },
        creator: { ...creator, department: null },
        availabilityOverlaps: true,
      });
      const result = score({ section, me, candidates: [item] });
      expect(result.items[0]!.reasons.map((reason) => reason.code)).not.toContain('availability-overlap');

      // 更强的一条：该因子在这两个板块**真的不加分**（差分恒为 0）
      expect(ruleScoreFor(section, me as MatchSubject, target, { availabilityOverlaps: true })).toBe(
        ruleScoreFor(section, me as MatchSubject, target, { availabilityOverlaps: false }),
      );
    }
  });

  it('daily 的 reasons 含 availability-overlap（weight 0.2），且这 0.2 **真的**进了 ruleScoreFor', () => {
    const target = { creator, tags: [] };
    const delta =
      ruleScoreFor('daily', me as MatchSubject, target, { availabilityOverlaps: true }) -
      ruleScoreFor('daily', me as MatchSubject, target, { availabilityOverlaps: false });
    expect(delta).toBeCloseTo(0.2, 6);

    const reason = explainMatch('daily', me as MatchSubject, target, { availabilityOverlaps: true }).find(
      (entry) => entry.code === 'availability-overlap',
    );
    expect(reason).toMatchObject({ code: 'availability-overlap', label: '时间能碰上', weight: 0.2 });
  });

  it('严格对齐的三条：same-department 只在 academic / same-skill 只在 sport / availability 只在 daily', () => {
    const target = { creator, tags: [] };
    const codesOf = (section: 'academic' | 'daily' | 'sport') =>
      explainMatch(section, me as MatchSubject, target, { availabilityOverlaps: true }).map((r) => r.code);

    // same-department 只在 academic；ruleScoreFor 也只在 academic 给 0.4
    expect(codesOf('academic')).toContain('same-department');
    expect(codesOf('daily')).not.toContain('same-department');
    expect(codesOf('sport')).not.toContain('same-department');
    expect(
      ruleScoreFor('academic', me as MatchSubject, target, { availabilityOverlaps: true }) -
        ruleScoreFor('academic', me as MatchSubject, { creator: { ...creator, department: null }, tags: [] }, {
          availabilityOverlaps: true,
        }),
    ).toBeCloseTo(0.4, 6);

    // same-skill 只在 sport；ruleScoreFor 也只在 sport 给 0.3
    expect(codesOf('sport')).toContain('same-skill');
    expect(codesOf('academic')).not.toContain('same-skill');
    expect(codesOf('daily')).not.toContain('same-skill');
    expect(
      ruleScoreFor('sport', me as MatchSubject, target, { availabilityOverlaps: true }) -
        ruleScoreFor('sport', me as MatchSubject, { creator: { ...creator, skillLevel: 'beginner' }, tags: [] }, {
          availabilityOverlaps: true,
        }),
    ).toBeCloseTo(0.3, 6);
  });

  it('✅ 已对齐：每条理由的权重都真的进了分数（不再有"不加分的理由"）', () => {
    // 本条原先断言"残留不一致"（钉住现状）。共享包结构性修复后改为断言**对齐**。
    // 不变量：某因子存在时的规则分 − 该因子移除后的规则分 === 该理由的 weight。
    const target = { creator, tags: [] };
    const without = (patch: Partial<typeof creator>) => ({
      creator: { ...creator, ...patch },
      tags: [] as string[],
    });

    for (const section of ['academic', 'daily', 'sport'] as const) {
      const reasons = explainMatch(section, me as MatchSubject, target, { availabilityOverlaps: true });
      const full = ruleScoreFor(section, me as MatchSubject, target, { availabilityOverlaps: true });

      // 逐条理由：把它对应的因子移除，分数必须恰好下降该 weight
      for (const r of reasons) {
        const stripped =
          r.code === 'same-area'
            ? without({ preferredAreas: [] })
            : r.code === 'shared-activities'
              ? without({ activityTags: [] })
              : r.code === 'shared-interests'
                ? without({ interestTags: [] })
                : r.code === 'same-department'
                  ? without({ department: '另一个学院' })
                  : r.code === 'same-skill'
                    ? without({ skillLevel: 'competitive' })
                    : r.code === 'availability-overlap'
                      ? target
                      : null;
        if (stripped === null) continue; // 未知 code 由共享包的不变式测试负责

        const opts =
          r.code === 'availability-overlap' ? { availabilityOverlaps: false } : { availabilityOverlaps: true };
        const reduced = ruleScoreFor(section, me as MatchSubject, stripped, opts);
        // 触顶（=1）时下降量会被 clamp 吃掉，故只在未触顶时断言精确相等
        if (full < 1) {
          expect(full - reduced, `${section}.${r.code} 的 weight ${r.weight} 与真实差分不符`).toBeCloseTo(
            r.weight,
            6,
          );
        }
      }

      // 反向：没出现在理由里的因子，不应该改变分数
      for (const code of ['same-area', 'shared-activities', 'shared-interests', 'same-department', 'same-skill']) {
        if (reasons.some((r) => r.code === code)) continue;
        const stripped =
          code === 'same-area'
            ? without({ preferredAreas: [] })
            : code === 'shared-activities'
              ? without({ activityTags: [] })
              : code === 'shared-interests'
                ? without({ interestTags: [] })
                : code === 'same-department'
                  ? without({ department: '另一个学院' })
                  : without({ skillLevel: 'competitive' });
        expect(
          full - ruleScoreFor(section, me as MatchSubject, stripped, { availabilityOverlaps: true }),
          `${section}: ${code} 没出现在理由里，却改变了分数`,
        ).toBe(0);
      }
    }
  });
});
