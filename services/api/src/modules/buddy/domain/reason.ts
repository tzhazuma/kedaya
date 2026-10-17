/**
 * 找搭子 · 推荐理由的中文文案（规格 §5.7，验收 T35）
 *
 * ## 为什么理由由**共享包**决定命中、本文件只决定文案
 *
 * 客户端要展示"为什么推荐给你"，**必须与服务端同一套算法**，否则用户会看到
 * 与服务端排序不一致的理由（这正是 `@kedaya/shared/buddy` 存在的理由）。
 * 所以：
 *
 * - **哪些规则命中** → `explainMatch()`（`@kedaya/shared`，与服务端打分同源）
 * - **命中后写什么中文** → 本文件（规格 §5.7 的文案表）
 *
 * 这个分工保证：`ruleScoreFor` 加了分，`explainMatch` 就会给出对应 code，
 * 本文件就会写出对应文案。三者不可能各自漂移。
 */

import {
  explainMatch,
  type BuddySection,
  type MatchReason,
  type MatchSubject,
  type MatchTarget,
} from '@kedaya/shared';
import { tagLabels } from './tags';

/** 无任何规则命中时的回落文案（对齐 `matching.py:299-301`） */
export const FALLBACK_REASON = '有潜在匹配';

/** 未开启匹配资料、只按时间排序时的文案（规格 §5.7 末尾） */
export const TIME_ORDER_REASON = '按时间排序';

/** 理由最多拼接几条（规格 §5.7："取前 3 条拼接"） */
export const MAX_REASON_PARTS = 3;

/** 共同标签最多列几个（规格 §5.7："最多 3 个"，对齐 `matching.py:282`） */
export const MAX_TAGS_IN_REASON = 3;

function intersect(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): string[] {
  if (!a || !b || a.length === 0 || b.length === 0) return [];
  const setB = new Set(b);
  return a.filter((key) => setB.has(key));
}

/**
 * 构造中文理由。
 *
 * ⚠️ 返回**永远非空**（验收 T35：三种模式的 `GET /recommendations`
 * 都必须返回非空 `reason`）。无命中时回落 `有潜在匹配`。
 *
 * `precomputed` 让调用方把**已经算好的** `explainMatch` 结果传进来，
 * 从而保证 `reason`（字符串）与 `reasons`（结构化数组）来自**同一次**调用 ——
 * 两处各自再算一次也能得到相同结果（纯函数），但"同一次输出"是**可证明**的，
 * 而"两次调用结果相同"要靠纯函数这个约定。缺省时自己算，保持向后兼容。
 */
export function buildReason(
  section: BuddySection,
  me: MatchSubject,
  target: MatchTarget,
  opts: { availabilityOverlaps?: boolean } = {},
  precomputed?: readonly MatchReason[],
): string {
  const reasons = precomputed ?? explainMatch(section, me, target, opts);
  if (reasons.length === 0) return FALLBACK_REASON;

  const sharedInterests = intersect(me.interestTags, target.creator.interestTags);
  const sharedActivities = intersect(me.activityTags, target.creator.activityTags);

  const parts: string[] = [];
  for (const reason of reasons) {
    if (parts.length >= MAX_REASON_PARTS) break;
    switch (reason.code) {
      case 'same-department':
        parts.push('同院系');
        break;
      case 'shared-interests':
        parts.push(`共同兴趣：${tagLabels(sharedInterests.slice(0, MAX_TAGS_IN_REASON)).join('、')}`);
        break;
      case 'shared-activities':
        parts.push(`共同活动：${tagLabels(sharedActivities.slice(0, MAX_TAGS_IN_REASON)).join('、')}`);
        break;
      case 'availability-overlap':
        parts.push('时间合适');
        break;
      case 'same-area':
        parts.push('常去同一区域');
        break;
      case 'same-skill':
        parts.push('运动水平相同');
        break;
      default:
        // 共享包新增了 code 而这里没跟上：宁可少一条理由，也不要写错的中文
        break;
    }
  }

  return parts.length > 0 ? parts.join('、') : FALLBACK_REASON;
}
