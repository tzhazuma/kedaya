import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { anonymousHandle } from '../auth/domain/verification-code';
import {
  FORUM_BOARDS,
  FORUM_POST_REPOSITORY,
  FORUM_REPLIES_PAGE_SIZE,
  FORUM_SORTS,
  FORUM_STATUS,
  FORUM_STATUSES,
  type CreateForumPostInput,
  type CreateForumReplyInput,
  type ForumBoardStat,
  type ForumPostDetail,
  type ForumPostListQuery,
  type ForumPostModel,
  type ForumPostRepository,
  type ForumReplyListQuery,
  type ForumReplyModel,
  type ForumSort,
} from './domain/forum.domain';

/**
 * 论坛用例层（契约 §7：controller → service → repository）。
 *
 * 匿名是本模块最需要小心的部分：
 *   · `authorId` **只**来自 JWT 主体；请求体里的 `anonymous: true` 决定它是否落库；
 *   · 匿名时 `authorId` 存 null，`anonHandle` 由 `anonymousHandle(帖子/回复 id + userId)`
 *     派生后**补写**（handle 需要数据库生成的 id），库里因此查不到实名关联；
 *   · 匿名帖不存 authorId ⇒ 作者不可辨 ⇒ 关闭 / 删除一律 FORBIDDEN（明确文案）。
 *
 * 依赖用**显式 token** 注入，因此 `new ForumPostService(fakeRepo)` 可直接在 vitest 里测。
 */
@Injectable()
export class ForumPostService {
  constructor(@Inject(FORUM_POST_REPOSITORY) private readonly repo: ForumPostRepository) {}

  /** 版块清单 + 每版块帖子数（按契约顺序补齐 0 的后端计算） */
  async boards(): Promise<ForumBoardStat[]> {
    const counts = new Map((await this.repo.boardCounts()).map((row) => [row.board, row.postCount]));
    return FORUM_BOARDS.map((board) => ({ board, postCount: counts.get(board) ?? 0 }));
  }

  async list(query: Partial<ForumPostListQuery> = {}): Promise<Page<ForumPostModel>> {
    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.board === undefined ? {} : { board: normalizeBoard(query.board) }),
      // 默认只返回 published；关闭的主题要显式带 status 才能看到
      ...(query.status === undefined
        ? { status: FORUM_STATUS.published }
        : { status: normalizeStatus(query.status) }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword.trim().slice(0, 60) }),
      ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
      sort: normalizeSort(query.sort),
    });
  }

  /** 帖子详情 + 一页回复（默认 20，最多 50；用 `replyCursor` 翻页） */
  async detail(id: string, replyQuery: Partial<ForumReplyListQuery> = {}): Promise<ForumPostDetail> {
    const post = await this.requirePost(id);
    const limit = Math.min(replyQuery.limit ?? 20, FORUM_REPLIES_PAGE_SIZE);
    const replies = await this.repo.listReplies({
      postId: id,
      limit,
      ...(replyQuery.cursor === undefined ? {} : { cursor: replyQuery.cursor }),
    });
    return { post, replies };
  }

  async create(input: CreateForumPostInput, actorId?: string): Promise<ForumPostModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发帖');

    const anonymous = input.anonymous === true;
    const created = await this.repo.create({
      board: normalizeBoard(input.board),
      authorId: anonymous ? null : actorId, // 实名身份只能来自 JWT
      anonHandle: null,
      title: normalizeTitle(input.title),
      body: normalizeBody(input.body, 5000, '正文'),
    });

    if (!anonymous) return created;

    // 匿名：handle 需要帖子 id，创建后补写；库里不会出现 userId
    return this.repo.update(created.id, { anonHandle: anonymousHandle(`${created.id}:${actorId}`) });
  }

  /**
   * 回复主题。
   *
   * `replyCount + 1` 与 `lastReplyAt` 由仓储在**同一事务**里维护，
   * 避免「回复写入了但帖子热度没变」的不一致。
   */
  async reply(id: string, input: CreateForumReplyInput, actorId?: string): Promise<ForumReplyModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再回复');

    const post = await this.requirePost(id);
    if (post.status !== FORUM_STATUS.published) {
      throw new ConflictError('该主题已关闭，无法回复');
    }

    const anonymous = input.anonymous === true;
    const reply = await this.repo.addReply({
      postId: id,
      authorId: anonymous ? null : actorId,
      anonHandle: null,
      body: normalizeBody(input.body, 2000, '回复内容'),
    });

    if (!anonymous) return reply;
    return this.repo.updateReply(reply.id, { anonHandle: anonymousHandle(`${reply.id}:${actorId}`) });
  }

  /** 关闭主题（仅实名作者；匿名帖作者不可辨） */
  async close(id: string, actorId?: string): Promise<ForumPostModel> {
    const post = await this.requirePost(id);
    this.assertRealAuthor(post, actorId, '关闭');

    if (post.status === FORUM_STATUS.closed) {
      throw new ConflictError('该主题已经关闭');
    }
    return this.repo.update(id, { status: FORUM_STATUS.closed });
  }

  /** 删除主题（仅实名作者；匿名帖作者不可辨） */
  async remove(id: string, actorId?: string): Promise<void> {
    const post = await this.requirePost(id);
    this.assertRealAuthor(post, actorId, '删除');
    await this.repo.remove(id);
  }

  private async requirePost(id: string): Promise<ForumPostModel> {
    const post = await this.repo.findById(id);
    if (!post) throw new NotFoundError('主题不存在或已被删除');
    return post;
  }

  /**
   * 匿名帖的 `authorId` 是 null：平台**无法**证明请求者就是作者，
   * 因此出于隐私保护直接拒绝，而不是要求提交任何身份线索。
   */
  private assertRealAuthor(post: ForumPostModel, actorId: string | undefined, action: string): void {
    if (!actorId) throw new UnauthenticatedError('请先登录');
    if (post.authorId === null) {
      throw new ForbiddenError(`匿名主题不保存作者身份，出于隐私保护无法${action}`);
    }
    if (post.authorId !== actorId) throw new ForbiddenError(`只能${action}自己发布的内容`);
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeBoard(value: unknown): string {
  if (typeof value !== 'string' || !(FORUM_BOARDS as readonly string[]).includes(value)) {
    throw new ValidationError('版块不在支持范围内', { field: 'board', allowed: FORUM_BOARDS });
  }
  return value;
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string' || !(FORUM_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('主题状态不在支持范围内', {
      field: 'status',
      allowed: FORUM_STATUSES,
    });
  }
  return value;
}

function normalizeSort(value: unknown): ForumSort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(FORUM_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: FORUM_SORTS });
  }
  return value as ForumSort;
}

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写标题', { field: 'title' });
  if ([...title].length > 80) throw new ValidationError('标题最多 80 个字', { field: 'title' });
  return title;
}

function normalizeBody(value: unknown, max: number, label: string): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length === 0) throw new ValidationError(`请填写${label}`, { field: 'body' });
  if ([...body].length > max) throw new ValidationError(`${label}最多 ${max} 个字`, { field: 'body' });
  return body;
}
