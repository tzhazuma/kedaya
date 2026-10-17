/**
 * 找搭子 · 匹配打分流水线（规格 §3.3 / §3.4 / §3.7，验收 T4 / T5 / T6 / T12 / T13）
 *
 * ## 这个文件里**没有算法**
 *
 * 规则分、融合公式、反馈衰减、理由命中全部来自 `@kedaya/shared/buddy`
 * （`ruleScoreFor` / `fuseScore` / `feedbackAdjustment` / `explainMatch`）。
 * 这里只做**编排**：
 *
 * ```
 * 硬过滤 F1–F7（applyHardFilters）
 *   → 规则分（ruleScoreFor）
 *   → 向量基础分（baseScoreFromCosineDistance）
 *   → 融合（fuseScore，towerScore 恒 undefined）
 *   → 反馈调整（feedbackAdjustment，**调用方已按 section 过滤**）
 *   → MMR 重排
 * ```
 *
 * 为什么不在这里重写一份：客户端要展示"为什么推荐给你"，必须与服务端
 * **同一套算法**，否则用户看到与服务端排序不一致的理由（见 `@kedaya/shared/buddy` 文件头）。
 *
 * ## `towerScore` 恒为 `undefined`（规格 §3.4 明确）
 *
 * 双塔权重是离线训练产物，我们没有训练数据、没有训练管线、
 * 也没有证据表明它可迁移到"组队"任务。因此**不实现权重文件加载** ——
 * 那会造出一个永远读不到的代码路径。公式里保留 0.20 项只是为了将来不必改公式。
 */

import {
  applyHardFilters,
  baseScoreFromCosineDistance,
  explainMatch,
  feedbackAdjustment,
  fuseScore,
  ruleScoreFor,
  type BuddySection,
  type FeedbackRecord,
  type MatchMode,
  type MatchReason,
  type MatchSubject,
  type MatchTarget,
} from '@kedaya/shared';
import { buildReason } from './reason';
import { mmrRerank } from './mmr';

/** 候选帖的匹配视图（由 data 层组装，domain 不 import Prisma） */
export interface MatchCandidate {
  post: {
    id: string;
    title: string;
    activity: string;
    startsAt: Date;
    location: string;
    tags: string[];
    status: string;
    joinedCount: number;
    capacity: number;
    creatorId: string;
    durationMin: number | null;
    /** F6 硬过滤：帖子的最低运动水平要求（仅 sport） */
    minSkillLevel: string | null;
  };
  /** 发起人的匹配特征（来自 BuddyProfile；发起人没开匹配资料时是空对象） */
  creator: MatchSubject;
  /** 向量余弦距离（仅 vector/hash 模式有） */
  distance?: number;
  /** 归一化向量（MMR 用；rule 模式没有） */
  vector?: readonly number[];
  /** F4：我是否已申请过（PENDING/ACCEPTED） */
  alreadyApplied: boolean;
  /** F5：性别准入是否相容 */
  genderCompatible: boolean;
  /** F7：可用时段是否重叠 */
  availabilityOverlaps: boolean;
}

export interface ScoredMatch {
  postId: string;
  score: number;
  /** 中文理由（**兼容字段**：三端都在用，不得删除；永远非空） */
  reason: string;
  /**
   * 结构化理由（跨端 wire 缺口 2）：`{ code, label, weight }[]`，按权重降序。
   *
   * 与 `reason` **同源**：两者由同一次 `explainMatch` 输出派生
   * （字符串是它的中文拼接，数组是它的原样投影）。
   * 客户端要展示"为什么推荐给你"并让理由**可排序/可解释**时用这个字段；
   * 只想要一句中文时用 `reason`。
   *
   * ⚠️ 权重之和**不一定等于** `score`：规则分在融合前会 clamp 到 [0,1]，
   * 且兴趣项本身有上限（academic 的 `min(0.3, 0.1×n)`）。权重表达的是
   * "这条理由命中了哪条规则、该规则值多少分"，不是"它贡献了总分的百分之几"。
   */
  reasons: MatchReason[];
}

export interface ScoreOptions {
  section: BuddySection;
  me: MatchSubject;
  /** 我的 userId（F3：不推荐自己发的） */
  viewerId: string;
  /** 我的运动水平（F6） */
  viewerSkillLevel?: string | null;
  candidates: readonly MatchCandidate[];
  /** **必须已经按 section 过滤**（规格 §3.6 / 验收 T6） */
  feedbacks: readonly FeedbackRecord[];
  mode: MatchMode;
  now: Date;
  /** MMR λ，默认 0.7；传 1 关闭多样性惩罚（验收 T5 就是这么做的） */
  mmrLambda?: number;
  limit?: number;
  /** 技能等级序函数（缺省不做 F6 判定） */
  skillRank?: (level: string) => number;
}

export interface ScoreResult {
  items: ScoredMatch[];
  /** 被硬过滤掉的候选数（按规则编号分组，便于解释"为什么只推了 3 条"） */
  filteredOut: Record<string, number>;
}

/** 保留 3 位小数（对齐 STUMatch `matching.py:466` 的 `round(score, 3)`） */
export function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

/**
 * 打分 + 硬过滤 + MMR。纯函数：同一输入永远同一输出（便于对照验证）。
 */
export function scoreCandidates(options: ScoreOptions): ScoreResult {
  const { section, me, candidates, feedbacks, mode, now, viewerId } = options;
  const lambda = options.mmrLambda ?? 0.7;

  // 反馈调整量。⚠️ 调用方必须**按 section 过滤后再传**（规格 §3.6 / 验收 T6）——
  // 跨板块的反馈会互相污染，这是最容易写错的地方。
  // 这里刻意不再过滤一次：重复过滤会掩盖调用方漏过滤的缺陷。
  const adjustments = feedbackAdjustment(feedbacks, now);

  const filteredOut: Record<string, number> = {};
  const scored: Array<{ match: ScoredMatch; vector?: readonly number[]; relevance: number }> = [];

  for (const candidate of candidates) {
    const target: MatchTarget = { creator: candidate.creator, tags: candidate.post.tags };

    // —— 硬过滤 F1–F7（规格 §3.3）——
    const filter = applyHardFilters(
      {
        status: candidate.post.status,
        joinedCount: candidate.post.joinedCount,
        capacity: candidate.post.capacity,
        startsAt: candidate.post.startsAt,
        creatorId: candidate.post.creatorId,
        viewerId,
        alreadyApplied: candidate.alreadyApplied,
        genderCompatible: candidate.genderCompatible,
        minSkillLevel: candidate.post.minSkillLevel,
        viewerSkillLevel: options.viewerSkillLevel ?? null,
        availabilityOverlaps: candidate.availabilityOverlaps,
        skillRank: options.skillRank,
      },
      now,
    );

    if (!filter.pass) {
      for (const rule of filter.failed) filteredOut[rule] = (filteredOut[rule] ?? 0) + 1;
      continue;
    }

    const ruleScore = ruleScoreFor(section, me, target, {
      availabilityOverlaps: candidate.availabilityOverlaps,
    });

    const baseScore =
      mode === 'rule' || candidate.distance === undefined
        ? undefined
        : baseScoreFromCosineDistance(candidate.distance);

    const finalScore = fuseScore({
      mode,
      baseScore,
      ruleScore,
      feedbackAdjustment: adjustments.get(candidate.post.id) ?? 0,
      // 规格 §3.4：**恒为 undefined**。不要在这里加载任何权重文件。
      towerScore: undefined,
    });

    // 理由**只算一次**：`reasons`（结构化）与 `reason`（中文串）都从这一次
    // `explainMatch` 输出派生，因此两者不可能互相漂移。
    const reasonOpts = { availabilityOverlaps: candidate.availabilityOverlaps };
    const reasons = explainMatch(section, me, target, reasonOpts);

    scored.push({
      match: {
        postId: candidate.post.id,
        score: roundScore(finalScore),
        reason: buildReason(section, me, target, reasonOpts, reasons),
        reasons,
      },
      vector: candidate.vector,
      relevance: finalScore,
    });
  }

  // —— MMR 多样性重排（规格 §3.1 第 9 步）——
  // 无向量（rule 档）时 mmrRerank 诚实退回相关度排序，不假装做了多样性。
  const reranked = mmrRerank(
    scored.map((entry) => ({ item: entry, relevance: entry.relevance, vector: entry.vector })),
    lambda,
  );

  const limited = options.limit === undefined ? reranked : reranked.slice(0, options.limit);

  return {
    items: limited.map((entry) => entry.item.match),
    filteredOut,
  };
}
