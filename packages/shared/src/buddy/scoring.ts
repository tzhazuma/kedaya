/**
 * 找搭子 · 匹配打分（规格 §3.3 规则分 + §3.4 融合公式 + §3.6 反馈衰减）
 *
 * ⚠️ 本文件是**纯函数**，零依赖、无 IO —— 三端都要用它：
 *   - 服务端用它算排序
 *   - 客户端用它展示「为什么推荐给你」（可解释性要求）
 * 两份实现必然漂移，所以只有这一份。
 *
 * 移植自 STUMatch（`tzhazuma/STUMatch`），但按规格 §3.3 做了三处**刻意的适配**：
 *   1. 删掉「同学校」规则 —— 单校部署下恒为真，零信息量却让总分虚高 0.2
 *   2. 「年龄差 ≤3」换成「可用时段重叠」—— 年龄不该用于组队
 *   3. 新增 7 条硬过滤（在打分之前）
 *
 * ## 本文件的结构性约束（这是同一类 bug 修了两次之后的结论）
 *
 * **系数只能写一次。** `ruleScoreFor`（算分）与 `explainMatch`（给理由）
 * 必须从**同一张系数表** `COEFFICIENTS` 派生，且共用同一个 `evaluateRules` 内核。
 *
 * 为什么：早先两者各写各的，于是反复出现
 * **"展示了一条理由，但该理由对分数毫无贡献"** 的不一致：
 *   - 第一轮：`academic`/`sport` 展示「时间能碰上」，但只有 `daily` 给这 0.2 分
 *   - 第二轮（api 实现时发现）：`academic` 展示「常在同一个区域」、`daily` 展示「共同活动 N 项」，
 *     而这两个板块**根本没有对应的分项** —— 贡献恒为 0；
 *     另有量级不符（`daily` 兴趣标 0.1/项、实际 0.15/项；`academic` 活动标 0.15/项、实际固定 0.1）
 *
 * 每次都"补一处"是治不好的 —— 只要还有两份独立的系数，就还会有第三处。
 * 所以现在系数**只有 `COEFFICIENTS` 一份**，理由由它**生成**：
 * 结构上不可能再出现"有理由没分"，也不可能出现"权重标错"。
 *
 * 可解释性的定义就是「**理由必须能解释分数**」。不解释任何分数的理由不是解释，是噪音。
 */

export type BuddySection = 'academic' | 'daily' | 'sport';

/** 参与匹配的用户特征（最小化采集，契约 §9） */
export interface MatchSubject {
  department?: string | null;
  /**
   * ⚠️ 这些数组**必须允许 undefined**：新用户不会填满所有标签，
   * 一个只填了兴趣、没填活动标签的用户是**常态**而非异常。
   * 初版把它们声明为必填，导致 `sharedCount(me.activityTags, undefined)` 抛
   * `TypeError: Cannot read properties of undefined` —— 会让整个推荐端点 500。
   * 类型必须与真实数据一致，否则类型检查反而给出虚假的安全感。
   */
  interestTags?: readonly string[] | null;
  activityTags?: readonly string[] | null;
  preferredAreas?: readonly string[] | null;
  /** 仅 sport 使用 */
  skillLevel?: string | null;
}

/** 被匹配的招募帖特征 */
export interface MatchTarget {
  creator: MatchSubject;
  tags?: readonly string[] | null;
}

/* ------------------------------------------------------------------ *
 * 硬过滤（规格 §3.3 F1–F7）
 * ------------------------------------------------------------------ */

export interface HardFilterInput {
  status: string;
  joinedCount: number;
  capacity: number;
  startsAt: Date;
  creatorId: string;
  viewerId: string;
  alreadyApplied: boolean;
  genderCompatible: boolean;
  minSkillLevel?: string | null;
  viewerSkillLevel?: string | null;
  /** F7：可用时段重叠（由 availability.ts 判定后传入，保持本文件纯函数） */
  availabilityOverlaps: boolean;
  /** 技能等级序（越小越初级）；缺省时不做 F6 判定 */
  skillRank?: (level: string) => number;
}

export interface HardFilterResult {
  pass: boolean;
  /** 未通过的规则编号，便于客户端解释与埋点 */
  failed: string[];
}

/** 硬过滤：不满足直接不进候选集（规格 §3.3） */
export function applyHardFilters(input: HardFilterInput, now: Date): HardFilterResult {
  const failed: string[] = [];

  if (input.status !== 'OPEN' || input.joinedCount >= input.capacity) failed.push('F1');
  if (input.startsAt.getTime() <= now.getTime()) failed.push('F2');
  if (input.creatorId === input.viewerId) failed.push('F3');
  if (input.alreadyApplied) failed.push('F4');
  if (!input.genderCompatible) failed.push('F5');

  if (input.minSkillLevel && input.viewerSkillLevel && input.skillRank) {
    if (input.skillRank(input.viewerSkillLevel) < input.skillRank(input.minSkillLevel)) failed.push('F6');
  }

  if (!input.availabilityOverlaps) failed.push('F7');

  return { pass: failed.length === 0, failed };
}

/* ------------------------------------------------------------------ *
 * 系数表 —— **唯一来源**
 * ------------------------------------------------------------------ */

/** 一条「按共同标签数计分」的规则：`min(cap, perItem × n)` */
export interface TagCountRule {
  kind: 'tag-count';
  /** 理由 code（客户端展示用） */
  code: string;
  /** 理由文案模板，`{n}` 会替换成共同项数 */
  label: string;
  /** 每命中一项加多少 */
  perItem: number;
  /** 该项总分上限 */
  cap: number;
  /** 用哪一组标签比较 */
  source: 'interests' | 'activities';
}

/** 一条「命中即加分」的规则（不分数量） */
export interface FlatRule {
  kind: 'flat';
  code: string;
  label: string;
  weight: number;
  /** 触发条件 */
  when: 'same-department' | 'same-skill' | 'same-area' | 'availability-overlap';
}

/** 一条「有共同项即加分」（不看数量）的规则 */
export interface PresenceRule {
  kind: 'presence';
  code: string;
  label: string;
  weight: number;
  source: 'activities';
}

export type ScoringRule = TagCountRule | FlatRule | PresenceRule;

/**
 * 三板块的规则表（规格 §3.3 的软打分表）。
 *
 * ⚠️ **这是全模块唯一的系数来源。** `ruleScoreFor` 与 `explainMatch` 都从这里派生 ——
 * 结构上不可能再出现"展示了理由但该理由不加分"。
 *
 * 与 STUMatch 的差异（规格 §3.3）：
 * - `academic` **删掉**「同学校 +0.2」（单校部署恒为真，零信息量）
 * - `daily` 把「年龄差 ≤3」换成「可用时段重叠」；「同城」换成「同区域」
 * - `sport` 用「同水平」替代 dating 的年龄差
 * - `academic` **没有** `same-area` 项、`daily` **没有** `shared-activities` 项
 *   —— 这两条正是之前被错误展示过的理由；现在它们**不在表里**，就不会被展示
 */
export const COEFFICIENTS: Readonly<Record<BuddySection, readonly ScoringRule[]>> = {
  academic: [
    { kind: 'flat', code: 'same-department', label: '同一个院系', weight: 0.4, when: 'same-department' },
    {
      kind: 'tag-count',
      code: 'shared-interests',
      label: '共同兴趣 {n} 项',
      perItem: 0.1,
      cap: 0.3,
      source: 'interests',
    },
    { kind: 'presence', code: 'shared-activities', label: '共同活动', weight: 0.1, source: 'activities' },
  ],
  daily: [
    {
      kind: 'tag-count',
      code: 'shared-interests',
      label: '共同兴趣 {n} 项',
      perItem: 0.15,
      cap: 0.5,
      source: 'interests',
    },
    {
      kind: 'flat',
      code: 'availability-overlap',
      label: '时间能碰上',
      weight: 0.2,
      when: 'availability-overlap',
    },
    { kind: 'flat', code: 'same-area', label: '常在同一个区域', weight: 0.1, when: 'same-area' },
  ],
  sport: [
    { kind: 'flat', code: 'same-skill', label: '水平接近', weight: 0.3, when: 'same-skill' },
    {
      kind: 'tag-count',
      code: 'shared-activities',
      label: '共同活动 {n} 项',
      perItem: 0.15,
      cap: 0.4,
      source: 'activities',
    },
    {
      kind: 'tag-count',
      code: 'shared-interests',
      label: '共同兴趣 {n} 项',
      perItem: 0.1,
      cap: 0.2,
      source: 'interests',
    },
    { kind: 'flat', code: 'same-area', label: '常在同一个区域', weight: 0.1, when: 'same-area' },
  ],
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * 共同标签数。
 * 对 `undefined` / `null` 一律按"空集合"处理 —— 调用方不必先做存在性判断，
 * 也就不会有人漏判。这是本模块唯一的标签比较入口。
 */
function sharedCount(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let n = 0;
  for (const x of a) if (setB.has(x)) n += 1;
  return n;
}

/** 判定一条 flat 规则的触发条件是否成立 */
function flatConditionHolds(
  when: FlatRule['when'],
  me: MatchSubject,
  other: MatchSubject,
  opts: { availabilityOverlaps?: boolean },
): boolean {
  switch (when) {
    case 'same-department':
      return Boolean(me.department && other.department && me.department === other.department);
    case 'same-skill':
      return Boolean(me.skillLevel && other.skillLevel && me.skillLevel === other.skillLevel);
    case 'same-area':
      return (
        (me.preferredAreas ?? []).length > 0 &&
        sharedCount(me.preferredAreas ?? [], other.preferredAreas ?? []) > 0
      );
    case 'availability-overlap':
      return opts.availabilityOverlaps === true;
    default:
      return false;
  }
}

/** 一条规则的实际得分与命中数量 */
interface RuleHit {
  rule: ScoringRule;
  /** 实际得分（已应用 cap） */
  score: number;
  /** 命中的共同项数（flat 规则命中时为 1；未命中为 0） */
  count: number;
  /** 该规则是否命中（决定是否展示理由） */
  hit: boolean;
}

/**
 * 评估一个板块的全部规则 —— `ruleScoreFor` 与 `explainMatch` 的**共同内核**。
 *
 * 两者关系：`ruleScoreFor = Σ hits.score`；
 * `explainMatch = hits.filter(hit).map(→ MatchReason)`。
 * 因此**任何被展示的理由，其 weight 一定真的进了分数** —— 这是结构保证，不是约定。
 */
function evaluateRules(
  section: BuddySection,
  me: MatchSubject,
  target: MatchTarget,
  opts: { availabilityOverlaps?: boolean } = {},
): RuleHit[] {
  const other = target.creator;
  const rules = COEFFICIENTS[section];

  return rules.map((rule): RuleHit => {
    switch (rule.kind) {
      case 'tag-count': {
        const a = rule.source === 'interests' ? me.interestTags : me.activityTags;
        const b = rule.source === 'interests' ? other.interestTags : other.activityTags;
        const n = sharedCount(a, b);
        return {
          rule,
          count: n,
          hit: n > 0,
          score: n > 0 ? Math.min(rule.cap, rule.perItem * n) : 0,
        };
      }
      case 'presence': {
        const n = sharedCount(me.activityTags, other.activityTags);
        return { rule, count: n, hit: n > 0, score: n > 0 ? rule.weight : 0 };
      }
      case 'flat': {
        const ok = flatConditionHolds(rule.when, me, other, opts);
        return { rule, count: ok ? 1 : 0, hit: ok, score: ok ? rule.weight : 0 };
      }
      default:
        // 穷尽性：新增规则种类会在这里编译报错
        throw new Error(`evaluateRules: 未知规则种类 ${JSON.stringify(rule)}`);
    }
  });
}

/**
 * 规则分。**融合前必须 clamp 到 [0,1]** —— 各板块之和可能超过 1
 * （academic 最高 0.8 / daily 0.8 / sport 1.0），不 clamp 会把 0.30 的权重放大。
 */
export function ruleScoreFor(
  section: BuddySection,
  me: MatchSubject,
  target: MatchTarget,
  opts: { availabilityOverlaps?: boolean } = {},
): number {
  const total = evaluateRules(section, me, target, opts).reduce((sum, h) => sum + h.score, 0);
  return clamp01(total);
}

/* ------------------------------------------------------------------ *
 * 反馈与衰减（规格 §3.6，移植 STUMatch matching.py:379）
 * ------------------------------------------------------------------ */

export type FeedbackAction = 'like' | 'dislike' | 'skip';

export const FEEDBACK_ACTION_WEIGHTS: Readonly<Record<FeedbackAction, number>> = {
  like: 0.2,
  dislike: -0.3,
  skip: -0.05,
};

/**
 * ⚠️ 命名诚实性说明：规格里这个常量叫 `HALFLIFE_DAYS`，但公式是 `exp(-days/30)`。
 * `exp(-days/30)` 是**时间常数**（time constant）为 30 天，不是半衰期 ——
 * 真正的 30 天半衰期应该是 `exp(-ln2 · days/30)`；`exp(-1) ≈ 0.368 ≠ 0.5`。
 *
 * 我们**保持 STUMatch 的实际行为**（`matching.py:379` 就是 `exp(-days/30)`），
 * 以便与参考实现对照验证；但把常量名改成诚实的 `DECAY_TIME_CONSTANT_DAYS`，
 * 并在此显式记录这个命名差异，避免后人以为衰减到 30 天时还剩一半。
 */
export const DECAY_TIME_CONSTANT_DAYS = 30;

export interface FeedbackRecord {
  targetPostId: string;
  action: FeedbackAction;
  createdAt: Date;
}

/**
 * 反馈调整量。同一帖子多次反馈**取最后一次**（由 (userId, postId, section) 唯一约束保证）。
 *
 * ⚠️ 调用方必须按 `section` 过滤后再传入（`matching.py:357-362`）——
 * 跨板块的反馈会互相污染，这是最容易写错的地方（对应验收 T4）。
 */
export function feedbackAdjustment(
  feedbacks: readonly FeedbackRecord[],
  now: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const fb of feedbacks) {
    const delta = FEEDBACK_ACTION_WEIGHTS[fb.action];
    const days = Math.max(0, (now.getTime() - fb.createdAt.getTime()) / 86_400_000);
    const decay = Math.exp(-days / DECAY_TIME_CONSTANT_DAYS);
    // 后出现的覆盖先出现的（调用方应按 createdAt 升序传入；Map 语义即「最后一次生效」）
    out.set(fb.targetPostId, delta * decay);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 融合（规格 §3.4）
 * ------------------------------------------------------------------ */

export type MatchMode = 'vector' | 'hash' | 'rule';

export interface FuseInput {
  mode: MatchMode;
  /** 向量余弦相似度导出的基础分 `max(0, 1 - cosineDistance)`；rule 模式下忽略 */
  baseScore?: number;
  ruleScore: number;
  feedbackAdjustment?: number;
  /**
   * 双塔分。**规格 §3.4 明确：我们不做双塔**（无训练数据、无管线、
   * 且无证据表明该权重可迁移到组队任务），因此恒为 undefined。
   * 公式里保留这一项只是为了将来接入时不必改公式。
   */
  towerScore?: number;
}

/**
 * 融合公式。
 *
 * - `vector` / `hash`（有向量）：`base × 0.50 + rule × 0.30 + tower × 0.20 + feedback`
 *   由于我们 `towerScore` 恒为 undefined，实际生效 `base × 0.70 + rule × 0.30`，
 *   与 STUMatch 的 "no tower" 分支（`matching.py:441`）**逐字一致**（刻意对齐便于对照验证）。
 * - `rule`（无 pgvector / 无 embedding 列）：`rule × 1.0 + feedback`
 *   —— 最重要的降级档，在纯 PostgreSQL 上就能工作。
 */
export function fuseScore(input: FuseInput): number {
  const rule = clamp01(input.ruleScore);
  const fb = input.feedbackAdjustment ?? 0;

  if (input.mode === 'rule') {
    return clamp01(rule + fb);
  }

  const base = clamp01(input.baseScore ?? 0);
  if (input.towerScore === undefined) {
    return clamp01(base * 0.7 + rule * 0.3 + fb);
  }
  return clamp01(base * 0.5 + rule * 0.3 + clamp01(input.towerScore) * 0.2 + fb);
}

/** 余弦距离 → 基础分（`matching.py:434` 同款） */
export function baseScoreFromCosineDistance(distance: number): number {
  return clamp01(Math.max(0, 1 - distance));
}

/** 供客户端展示的「为什么推荐」理由 */
export interface MatchReason {
  code: string;
  label: string;
  weight: number;
}

/**
 * 可解释理由 —— **由 `COEFFICIENTS` 生成，与 `ruleScoreFor` 同源**。
 *
 * 因此：**每一条理由的 `weight` 都真的进了 `ruleScoreFor`**，
 * 且**没进分数的规则不会出现在理由里**。这是结构保证：
 * 两者读同一张表、跑同一个 `evaluateRules`。
 *
 * `weight` 用的是**实际得分**（已应用 cap / 已乘数量），不是"名义权重" ——
 * 这样界面上的数字与排序依据永远一致。
 */
export function explainMatch(
  section: BuddySection,
  me: MatchSubject,
  target: MatchTarget,
  opts: { availabilityOverlaps?: boolean } = {},
): MatchReason[] {
  return evaluateRules(section, me, target, opts)
    .filter((h) => h.hit && h.score > 0)
    .map((h) => ({
      code: h.rule.code,
      label: h.rule.kind === 'tag-count' ? h.rule.label.replace('{n}', String(h.count)) : h.rule.label,
      weight: h.score,
    }))
    .sort((a, b) => b.weight - a.weight);
}
