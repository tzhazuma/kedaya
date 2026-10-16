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
 * 规则分（规格 §3.3 的软打分表）
 * ------------------------------------------------------------------ */

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
  const other = target.creator;
  const sharedInterests = sharedCount(me.interestTags, other.interestTags);
  const sharedActivities = sharedCount(me.activityTags, other.activityTags);
  const sameArea =
    (me.preferredAreas ?? []).length > 0 &&
    sharedCount(me.preferredAreas ?? [], other.preferredAreas ?? []) > 0;

  let score = 0;

  switch (section) {
    case 'academic': {
      // 同院系（不是同专业 —— 小程序端填报质量不可控，规格 §3.3）
      if (me.department && other.department && me.department === other.department) score += 0.4;
      score += Math.min(0.3, 0.1 * sharedInterests);
      score += sharedActivities > 0 ? 0.1 : 0;
      // 「同学校」规则**刻意删除**：单校部署下恒为真，零信息量
      break;
    }
    case 'daily': {
      score += Math.min(0.5, 0.15 * sharedInterests);
      if (opts.availabilityOverlaps) score += 0.2; // 替代 STUMatch 的「年龄差 ≤3」
      if (sameArea) score += 0.1; // 替代「同城」，单校部署下同城无意义
      break;
    }
    case 'sport': {
      if (me.skillLevel && other.skillLevel && me.skillLevel === other.skillLevel) score += 0.3;
      score += Math.min(0.4, 0.15 * sharedActivities);
      score += Math.min(0.2, 0.1 * sharedInterests);
      if (sameArea) score += 0.1;
      break;
    }
    default:
      // 穷尽性：新增板块会在这里编译报错
      throw new Error(`ruleScoreFor: 未知板块 ${String(section)}`);
  }

  return clamp01(score);
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

export function explainMatch(
  section: BuddySection,
  me: MatchSubject,
  target: MatchTarget,
  opts: { availabilityOverlaps?: boolean } = {},
): MatchReason[] {
  const other = target.creator;
  const reasons: MatchReason[] = [];
  const si = sharedCount(me.interestTags, other.interestTags);
  const sa = sharedCount(me.activityTags, other.activityTags);
  const sameArea =
    (me.preferredAreas ?? []).length > 0 &&
    sharedCount(me.preferredAreas ?? [], other.preferredAreas ?? []) > 0;

  if (section === 'academic' && me.department && me.department === other.department) {
    reasons.push({ code: 'same-department', label: '同一个院系', weight: 0.4 });
  }
  if (si > 0) {
    reasons.push({ code: 'shared-interests', label: `共同兴趣 ${si} 项`, weight: si * 0.1 });
  }
  if (sa > 0) {
    reasons.push({ code: 'shared-activities', label: `共同活动 ${sa} 项`, weight: sa * 0.15 });
  }
  // ⚠️ **只有 `daily` 板块**才展示"时间能碰上" —— 因为 `ruleScoreFor` 也只在 daily 给这 0.2 分。
  // 早先版本对三个板块都展示该理由，于是 academic/sport 的推荐会出现
  // "时间合适"却**不加分**的矛盾：用户看到的理由解释不了他看到的排序。
  // 可解释性的定义就是"理由必须能解释分数"，所以这里必须与打分表严格一致。
  // （由 api 在实现 `buddy` 时发现并上报，Lead 裁决：改代码，不改规格。）
  if (section === 'daily' && opts.availabilityOverlaps) {
    reasons.push({ code: 'availability-overlap', label: '时间能碰上', weight: 0.2 });
  }
  if (sameArea) {
    reasons.push({ code: 'same-area', label: '常在同一个区域', weight: 0.1 });
  }
  if (
    section === 'sport' &&
    me.skillLevel &&
    other.skillLevel &&
    me.skillLevel === other.skillLevel
  ) {
    reasons.push({ code: 'same-skill', label: '水平接近', weight: 0.3 });
  }

  return reasons.sort((a, b) => b.weight - a.weight);
}
