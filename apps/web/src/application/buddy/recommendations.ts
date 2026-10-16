/**
 * 用例：主动推荐 + 匹配反馈（契约 §7：application 层编排，不含 IO）。
 *
 * 本文件是「推荐必须**可解释**」这条要求的落点（规格 §1.1 G3）：
 * 每条推荐都带 `reasons` —— **就是 `@kedaya/shared` 的 `explainMatch` 输出**
 * （`同一个院系` / `共同兴趣 3 项` / `时间能碰上` / `水平接近` / `常在同一个区域`）。
 * 一条命中都没有时回落为 `有潜在匹配`，`reason` 字段**永不为空**（规格 §5.7）。
 *
 * 诚实性要求（规格 §5.7）：`matchMode` 必须暴露给用户 ——
 * `rule` 模式下**不得**说"为你智能推荐"（那是按发布时间排序），
 * `hash` 模式下**不得**说"语义相似"（那只是字符袋哈希，规格 §3.5）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type MatchReason, type Result } from '@kedaya/shared';

import {
  BUDDY_FEEDBACK_ACTION_LABELS,
  BUDDY_SECTION_LABELS,
  sectionOf,
  type BuddyFeedbackAction,
  type BuddySection,
} from '@/domain/models/buddy';
import type {
  BuddyRecommendation,
  BuddyRecommendationQuery,
  BuddyRepository,
} from '@/domain/ports/buddy';

import { deriveViewState, type ViewState } from '../viewState';
import { newIdempotencyKey } from './ids';
import { toBuddyPostCardVM, type BuddyPostCardVM } from './listBuddyPosts';

export const MATCH_MODE_LABELS: Record<'vector' | 'hash' | 'rule', string> = {
  vector: '向量匹配',
  hash: '标签 + 本地降级打分',
  rule: '按时间排序（未开启匹配资料）',
};

/** 每种模式的**诚实说明**（UI 必须原样展示，不得只写"智能推荐"） */
export const MATCH_MODE_NOTICES: Record<'vector' | 'hash' | 'rule', string> = {
  vector: '已接入语义向量模型：相似度来自真实 embedding，理由与排序都由同一套算法给出。',
  hash:
    '当前是降级档：没有 embedding 模型时用确定性哈希向量 + 封闭标签规则分。它不是语义相似 —— 用词不同但意思相近的文本不会被识别为相似。',
  rule:
    '你还没有开启匹配资料（或资料为空），所以这里是按活动时间排序的开放活动，不是个性化推荐。开启「我的匹配资料」后才会出现基于兴趣与时间的理由。',
};

/** 一条规则都没命中时的回落（规格 §5.7） */
export const FALLBACK_REASON: MatchReason = {
  code: 'potential',
  label: '有潜在匹配',
  weight: 0,
};

export interface BuddyReasonVM {
  code: string;
  label: string;
  weight: number;
}

export interface BuddyRecommendationVM {
  post: BuddyPostCardVM;
  section: BuddySection;
  sectionLabel: string;
  score: number;
  scoreLabel: string;
  scorePercentLabel: string;
  /** 结构化理由（`explainMatch` 输出，逐条展示） */
  reasons: BuddyReasonVM[];
  /** 服务端拼好的中文理由，**必须非空** */
  reasonLabel: string;
  matchMode: 'vector' | 'hash' | 'rule';
  matchModeLabel: string;
  matchModeNotice: string;
  feedback: BuddyFeedbackAction | null;
  feedbackLabel: string | null;
}

export interface BuddyRecommendationListVM {
  items: BuddyRecommendationVM[];
  section: BuddySection;
  sectionLabel: string;
  matchMode: 'vector' | 'hash' | 'rule';
  matchModeLabel: string;
  matchModeNotice: string;
  nextCursor: string | null;
  isEmpty: boolean;
  /** 至少有一条带结构化理由 —— 用于断言"不是只给分数" */
  explainedCount: number;
  state: ViewState;
}

export interface BuddyFeedbackEntry {
  targetPostId: string;
  section: BuddySection;
  action: BuddyFeedbackAction;
}

export function toBuddyRecommendationVM(
  recommendation: BuddyRecommendation,
  options: {
    now: Date;
    viewerId: string;
    matchMode: 'vector' | 'hash' | 'rule';
    feedback?: BuddyFeedbackEntry | null;
  },
): BuddyRecommendationVM {
  const reasons = recommendation.reasons.length > 0 ? recommendation.reasons : [FALLBACK_REASON];
  const score = Math.round(recommendation.score * 1000) / 1000;
  // 板块由 activity 派生（规格 §2.3），不依赖服务端多下发一个字段
  const section = sectionOf(recommendation.post.activity);

  return {
    post: toBuddyPostCardVM(recommendation.post, {
      now: options.now,
      viewerId: options.viewerId,
      myApplicationStatus: null,
    }),
    section,
    sectionLabel: BUDDY_SECTION_LABELS[section],
    score,
    scoreLabel: score.toFixed(3),
    scorePercentLabel: `${Math.round(score * 100)}%`,
    reasons: reasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
      weight: reason.weight,
    })),
    reasonLabel: recommendation.reason.trim() || reasons.map((r) => r.label).join('、'),
    matchMode: options.matchMode,
    matchModeLabel: MATCH_MODE_LABELS[options.matchMode],
    matchModeNotice: MATCH_MODE_NOTICES[options.matchMode],
    feedback: options.feedback?.action ?? null,
    feedbackLabel: options.feedback ? BUDDY_FEEDBACK_ACTION_LABELS[options.feedback.action] : null,
  };
}

export async function loadBuddyRecommendations(
  repository: BuddyRepository,
  query: BuddyRecommendationQuery,
  options: { now?: Date; viewerId: string; feedbacks?: readonly BuddyFeedbackEntry[] },
): Promise<Result<BuddyRecommendationListVM, ApiError>> {
  const now = options.now ?? new Date();
  const result = await repository.recommendations(query);
  if (!result.ok) return err(result.error);

  const feedbackByPost = new Map<string, BuddyFeedbackEntry>();
  for (const entry of options.feedbacks ?? []) {
    if (entry.section === query.section) feedbackByPost.set(entry.targetPostId, entry);
  }

  const items = result.value.items.map((item) =>
    toBuddyRecommendationVM(item, {
      now,
      viewerId: options.viewerId,
      matchMode: result.value.matchMode,
      feedback: feedbackByPost.get(item.post.id) ?? null,
    }),
  );

  return ok({
    items,
    section: query.section,
    sectionLabel: BUDDY_SECTION_LABELS[query.section],
    matchMode: result.value.matchMode,
    matchModeLabel: MATCH_MODE_LABELS[result.value.matchMode],
    matchModeNotice: MATCH_MODE_NOTICES[result.value.matchMode],
    nextCursor: result.value.nextCursor,
    isEmpty: items.length === 0,
    explainedCount: items.filter((item) => item.reasons.some((r) => r.code !== 'potential')).length,
    state: deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  });
}

/** 已冻结动作 `feedback`：like / dislike / skip（按板块隔离，UPSERT） */
export async function submitBuddyFeedback(
  repository: BuddyRepository,
  input: {
    postId: string;
    section: BuddySection;
    action: BuddyFeedbackAction;
    userId: string;
  },
): Promise<Result<BuddyFeedbackEntry, ApiError>> {
  const result = await repository.feedback({
    postId: input.postId,
    userId: input.userId,
    section: input.section,
    action: input.action,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!result.ok) return err(result.error);
  return ok({
    targetPostId: result.value.targetPostId,
    section: result.value.section,
    action: result.value.action,
  });
}

export function buddyRecommendationState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}
