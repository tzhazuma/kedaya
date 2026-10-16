/**
 * 找搭子 · 帖子用例（规格 §5.3–§5.6，验收 T20 / T21 / T23 / T24）
 *
 * ## 权限规则（规格 §6.1）
 *
 * | 动作 | 谁能做 | 否则 |
 * | --- | --- | --- |
 * | 详情 / 列表 | 任何已登录用户 | 401（守卫层） |
 * | 创建 | 任何已登录用户 | 401 |
 * | PATCH | **仅发起人** | 403 FORBIDDEN |
 * | DELETE（→ `CANCELLED`） | **仅发起人** | 403 FORBIDDEN |
 * | `close`（→ `CLOSED`） | **仅发起人** | 403 FORBIDDEN |
 *
 * ## `NOT_FOUND` 不区分"不存在"与"不可见"（api-contract §2.1 / 验收 T24）
 *
 * 详情按 id 取，不存在与已删除都返回同一个 404 ——
 * 区分会变成"枚举他人活动 id"的信息泄漏面（规格 §6.4）。
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../common/errors/app-error';
import { canTransition } from '../domain/buddy-post.state';
import { scanContactInfo } from '../domain/content-safety';
import { toPostDetailView, toPostListView, type PostDetailView, type PostListView } from '../domain/views';
import {
  BUDDY_POST_REPOSITORY,
  type BuddyPostRepository,
  type CreateBuddyPostInput,
  type PostListQuery,
  type PostWithCreator,
  type UpdateBuddyPostInput,
} from '../domain/buddy.domain';
import { BuddyMatchingService } from './buddy-matching.service';

export interface PostListResult {
  items: PostListView[];
  nextCursor: string | null;
}

@Injectable()
export class BuddyPostService {
  constructor(
    @Inject(BUDDY_POST_REPOSITORY) private readonly posts: BuddyPostRepository,
    @Inject(BuddyMatchingService) private readonly matching: BuddyMatchingService,
  ) {}

  async list(query: PostListQuery): Promise<PostListResult> {
    const page = await this.posts.list(query);
    return {
      items: page.items.map((item) => toPostListView(item.post, item.creator)),
      nextCursor: page.nextCursor,
    };
  }

  async detail(id: string, viewerId: string): Promise<PostDetailView> {
    const found = await this.posts.findById(id);
    // 不存在 / 已删除 → 同一个 404（不区分，验收 T24）
    if (!found) throw new NotFoundError('活动不存在或已被删除');

    const statuses = await this.posts.findMyApplicationStatuses(viewerId, [id]);
    return toPostDetailView(found.post, found.creator, viewerId, statuses.get(id) ?? null);
  }

  /**
   * 发布活动。
   *
   * **不要求开启匹配资料**（规格 §5.4 错误表最后一行：不报错）。
   * 发帖与匹配是两件事：先能发帖，匹配是增强。
   */
  async create(creatorId: string, input: CreateBuddyPostInput): Promise<PostDetailView> {
    assertNoContactInfo(input.description);
    const created = await this.posts.create(creatorId, input);
    await this.matching.ensurePostEmbedding(created.post);
    return toPostDetailView(created.post, created.creator, creatorId, null);
  }

  /**
   * PATCH（RFC 7396 Merge Patch，验收 T21）。
   *
   * `undefined` = 不动，`null` = 清空 —— Zod schema 保留 `null`，
   * data 层的 `update` 逐字段判断 `!== undefined`。
   */
  async update(id: string, patch: UpdateBuddyPostInput, viewerId: string): Promise<PostDetailView> {
    await this.requireOwnPost(id, viewerId);
    if (patch.description !== undefined) assertNoContactInfo(patch.description);

    const updated = await this.posts.update(id, patch);
    // 内容变了 → hash 向量必须重算，否则推荐会按旧文本召回
    await this.matching.ensurePostEmbedding(updated.post);
    return toPostDetailView(updated.post, updated.creator, viewerId, null);
  }

  /** 发起人关闭活动：`OPEN|FULL → CLOSED`（规格 §5.2，动作名 `close` 对应状态 `CLOSED`） */
  async close(id: string, viewerId: string): Promise<PostDetailView> {
    return this.transition(id, viewerId, 'CLOSED');
  }

  /**
   * 取消活动：`DELETE /items/:id` → `CANCELLED`（规格 §5.2）。
   *
   * 刻意用 `close` 表示 `CLOSED`、用 DELETE 表示 `CANCELLED`，
   * 这样**动作名与状态名一一对应**，无歧义（规格 §5.2 明文）。
   *
   * ⚠️ 冻结状态图里**没有** `FULL → CANCELLED`，所以已满的帖子
   * 无法被取消（返回 409）。这是忠于契约的结果，记入交付说明。
   */
  async cancel(id: string, viewerId: string): Promise<PostDetailView> {
    return this.transition(id, viewerId, 'CANCELLED');
  }

  private async transition(id: string, viewerId: string, target: string): Promise<PostDetailView> {
    const found = await this.requireOwnPost(id, viewerId);

    // 状态流转只走纯函数（契约 `02-domain-model.md:36` 规则 2 / 验收 T3）
    if (!canTransition(found.post.status, target)) {
      throw new ConflictError(`当前状态（${found.post.status}）不能转到 ${target}`, {
        reason: 'INVALID_STATUS_TRANSITION',
        from: found.post.status,
        to: target,
      });
    }

    const updated = await this.posts.setStatus(id, target);
    return toPostDetailView(updated.post, updated.creator, viewerId, null);
  }

  /** 取帖子并断言"我是发起人"。不存在 → 404；不是我发的 → 403（验收 T23） */
  private async requireOwnPost(id: string, viewerId: string): Promise<PostWithCreator> {
    const found = await this.posts.findById(id);
    if (!found) throw new NotFoundError('活动不存在或已被删除');
    if (found.post.creatorId !== viewerId) {
      throw new ForbiddenError('只有发起人可以修改这个活动');
    }
    return found;
  }
}

/**
 * `description` 里的联系方式检测（规格 §6.4 / 验收 T25）。
 *
 * 抛 `VALIDATION_FAILED`，`details.reason = 'CONTACT_INFO_IN_DESCRIPTION'`。
 * **不回显命中的原文** —— 那等于把联系方式又记录进响应与日志。
 */
export function assertNoContactInfo(description: string | null | undefined): void {
  const scan = scanContactInfo(description);
  if (scan.hit) {
    throw new ValidationError(`活动描述里不能写联系方式（${scan.hint}）`, {
      reason: 'CONTACT_INFO_IN_DESCRIPTION',
      kind: scan.kind,
    });
  }
}
