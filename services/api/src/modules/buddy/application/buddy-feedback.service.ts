/**
 * 找搭子 · 反馈用例（规格 §5.8 / §3.6，验收 T6）
 *
 * ## 本文件最容易写错的地方
 *
 * `section` **既是写入维度也是读取维度**，两处必须一致：
 *   - 写入：UPSERT 的唯一键是 `(userId, targetPostId, section)`；
 *   - 读取：`WHERE section = $section`（在 `BuddyFeedbackRepository` 里，
 *     参数是**必填**的）。
 *
 * 跨板块的反馈会互相污染 —— 这正是验收 T6 要钉死的行为
 * （`academic` 的 `dislike` 不得影响该帖在 `daily` 的分数）。
 *
 * ## 为什么反馈目标是**帖子**而不是用户（规格 D10）
 *
 * 对"这个人"表达不喜欢会变成对同学的隐性评价，且会泄漏为"我被某人踩过"；
 * 对"这个活动"表达不感兴趣则是无害的。
 *
 * ## 限流（规格 §5.8：每用户每分钟 ≤ 30 次）
 *
 * ⚠️ **未实现**。本仓没有限流基础设施（`RATE_LIMITED` 错误码存在，
 * 但没有任何模块实现了配额计数；全局也没有 `ThrottlerGuard`）。
 * 引入一个进程内计数器会造出"多实例下不成立"的假限流 —— 那是比没有更糟的
 * 安全错觉。这条依赖记入交付说明，由 Lead 决定是否在 M2 的共享能力里统一做。
 */

import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/app-error';
import type { BuddySection } from '../domain/section';
import {
  BUDDY_FEEDBACK_REPOSITORY,
  BUDDY_POST_REPOSITORY,
  type BuddyFeedbackRepository,
  type BuddyPostRepository,
} from '../domain/buddy.domain';

export interface FeedbackResult {
  action: string;
  section: BuddySection;
  targetPostId: string;
}

@Injectable()
export class BuddyFeedbackService {
  constructor(
    @Inject(BUDDY_FEEDBACK_REPOSITORY) private readonly feedbacks: BuddyFeedbackRepository,
    @Inject(BUDDY_POST_REPOSITORY) private readonly posts: BuddyPostRepository,
  ) {}

  /**
   * 提交 like / dislike / skip（UPSERT）。
   *
   * 副作用（规格 §5.8）：`DEL buddy:rec:{userId}:{section}` 让下次推荐立刻反映反馈。
   * ⚠️ **没有 Redis 缓存可删**（见 `buddy-recommend.service.ts` 文件头）：
   * 推荐每次实时计算，因此"反馈立刻生效"是**天然成立**的，不需要失效动作。
   */
  async submit(
    userId: string,
    targetPostId: string,
    section: BuddySection,
    action: string,
  ): Promise<FeedbackResult> {
    // 帖子不可见/不存在 → 404（不区分，验收 T24）
    const found = await this.posts.findById(targetPostId);
    if (!found) throw new NotFoundError('活动不存在或已被删除');

    await this.feedbacks.upsert({ userId, targetPostId, section, action });

    return { action, section, targetPostId };
  }
}
