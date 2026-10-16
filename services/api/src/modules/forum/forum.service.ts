/**
 * 论坛 · forum —— 用例层（契约 §7：只编排，不含 IO）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/forum.domain.ts 顶部）。
 *
 * 覆盖的用例：版块目录 / 发帖（实名+匿名）/ 编辑（JSON Merge Patch）/
 * 软删除 / 详情（含回复数）/ 回复子资源 / 举报（含阈值自动隐藏）/ 版主治理。
 *
 * wire 形状（Lead v1.2 裁决）：`boardId` / `keyword` / 大写状态 / `anonymous` /
 * `authorNickname`；DTO 组装在 `toPostView` / `toReplyView` / `toBoardView`。
 *
 * 硬性约定：
 *   · **匿名 ≠ 未登录**：匿名是"对外不可见实名"，仍需要第一级身份 ——
 *     否则做不到"同帖同人一致"与"作者自助删除"，也无法追责滥用。
 *     实名身份**不落库**（authorId 恒为 null），只落 HMAC handle（契约 §9）。
 *   · 状态流转只走 domain 里的状态机函数（禁止直接写 status）。
 *   · PII 只提示不拦截；敏感词命中则拦截（词表由运维配置，代码不硬编码词库）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from '@kedaya/contracts';
import { slugify } from '@kedaya/shared';
import { ROLE_PORT, type RolePort } from '../../common/auth/role.port';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { ulid } from '../../common/ids/ulid';
import {
  ANONYMOUS_NICKNAME,
  FORUM_BOARD_REPOSITORY,
  FORUM_MODULE_ID,
  FORUM_POST_REPOSITORY,
  FORUM_REPORT_AUTO_HIDE_THRESHOLD,
  FORUM_REPORT_REASONS,
  FORUM_REPORT_REPOSITORY,
  FORUM_USER_DIRECTORY,
  POST_STATUSES_EDITABLE_BY_AUTHOR,
  anonHandleFor,
  anonThreadScope,
  canReplyToPost,
  canTransitionForumPost,
  findBannedKeyword,
  isAnonymousContent,
  normalizePostStatus,
  normalizeReportReason,
  parseKeywordList,
  piiHintFor,
  publicAuthorId,
  requiresModeratorForPostTransition,
  verifyAnonymousHandle,
  type CreateForumBoardInput,
  type CreateForumPostCommand,
  type CreateForumPostInput,
  type CreateForumReplyCommand,
  type CreateForumReplyInput,
  type ForumBoardModel,
  type ForumBoardRepository,
  type ForumBoardView,
  type ForumPostListFilter,
  type ForumPostModel,
  type ForumPostRepository,
  type ForumPostStatus,
  type ForumPostView,
  type ForumPostWithHints,
  type ForumReportListFilter,
  type ForumReportModel,
  type ForumReportRepository,
  type ForumReportStatus,
  type ForumReportView,
  type ForumReplyModel,
  type ForumReplyView,
  type ForumUserDirectoryPort,
  type UpdateForumPostCommand,
  type UpdateForumPostInput,
} from './domain/forum.domain';

/** 标题/正文长度上限（02-domain-model §2.4） */
export const FORUM_TITLE_MAX = 100;
export const FORUM_BODY_MAX = 20000;
export const FORUM_REPLY_BODY_MAX = 5000;
export const FORUM_TAGS_MAX = 5;
export const FORUM_TAG_MAX = 16;

/** 默认列表只暴露"读者可见"的状态；DRAFT/HIDDEN/DELETED 需显式指定或走治理接口 */
export const FORUM_PUBLIC_POST_STATUSES: readonly ForumPostStatus[] = ['PUBLISHED', 'LOCKED'];

export type ForumReplyWithHints = ForumReplyView & { piiWarning: boolean };

export interface ReportPostResult extends ForumReportView {
  /** 同一举报人对同一目标重复举报：不新增记录，直接回放首次结果 */
  duplicate: boolean;
  /** 当前不同举报人总数 */
  reportCount: number;
  /** 本次举报是否触发阈值自动隐藏 */
  autoHidden: boolean;
}

@Injectable()
export class ForumService extends CrudService<ForumPostModel, CreateForumPostInput, UpdateForumPostInput> {
  constructor(
    @Inject(FORUM_POST_REPOSITORY) private readonly posts: ForumPostRepository,
    @Inject(FORUM_BOARD_REPOSITORY) private readonly boards: ForumBoardRepository,
    @Inject(FORUM_REPORT_REPOSITORY) private readonly reports: ForumReportRepository,
    @Inject(FORUM_USER_DIRECTORY) private readonly users: ForumUserDirectoryPort,
    @Inject(ROLE_PORT) private readonly roles: RolePort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super(posts, FORUM_MODULE_ID, '论坛主题');
  }

  /* ================= 版块 ================= */

  /** 版块列表（含 `lastPostAt`，一次 groupBy 补齐） */
  async listBoards(params: ListParams): Promise<Page<ForumBoardView>> {
    const [page, lastPostAt] = await Promise.all([
      this.boards.listBoards(params),
      this.boards.latestPostAtByBoard(),
    ]);
    return {
      items: page.items.map((board) => this.toBoardView(board, lastPostAt.get(board.id) ?? null)),
      nextCursor: page.nextCursor,
    };
  }

  /** 版块创建（治理动作：需要 forum_moderator） */
  async createBoard(input: CreateForumBoardInput, actorId?: string): Promise<ForumBoardView> {
    const actor = this.requireActor(actorId);
    await this.requireModerator(actor);
    if (!input.name?.trim()) throw new ValidationError('版块名不能为空', { field: 'name' });

    const slug = (input.slug?.trim() || slugify(input.name) || ulid().toLowerCase()).slice(0, 64);
    const existing = await this.boards.findBoardByIdOrSlug(slug);
    if (existing) throw new ConflictError('版块 slug 已存在', { slug });

    const created = await this.boards.createBoard({
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      visibility: input.visibility === 'campus_only' ? 'campus_only' : 'public',
    });
    return this.toBoardView(created, null);
  }

  /* ================= 主题：列表 / 详情 ================= */

  /**
   * 主题列表（游标分页 + 版块过滤 + 关键词搜索）。
   * 不传 status 时只返回读者可见状态（PUBLISHED/LOCKED）——
   * 草稿、被隐藏、已删除的内容不会从公开列表泄漏出去。
   */
  async listPosts(filter: ForumPostListFilter): Promise<Page<ForumPostView>> {
    const boardId = await this.resolveBoardId(filter.boardId);
    const page = await this.posts.listFiltered({
      ...filter,
      boardId,
      status: filter.status ?? [...FORUM_PUBLIC_POST_STATUSES],
    });
    return this.toPostPage(page);
  }

  /**
   * 主题详情（含回复数 `replyCount`）。
   * 隐藏主题只有作者本人或版主能看到；其他人得到 NOT_FOUND（不确认其存在）。
   */
  override async detail(id: string, viewerId?: string): Promise<ForumPostModel> {
    return (await this.detailView(id, viewerId)) as unknown as ForumPostModel;
  }

  /** 详情（对外 DTO 版本；控制器用这个） */
  async detailView(id: string, viewerId?: string): Promise<ForumPostView> {
    const post = await this.findVisiblePost(id, viewerId);
    return this.toPostView(post, await this.nicknameFor(post));
  }

  /* ================= 主题：发帖 / 编辑 / 删除 ================= */

  /**
   * 发帖。
   *
   * 匿名路径：先取 id（ULID），再 `HMAC(userId, 'thread:'+id)` 得到 handle，
   * `authorId` 写 **null** —— 实名身份根本不落库（契约 §9）。
   */
  async createPost(command: CreateForumPostCommand, actorId?: string): Promise<ForumPostWithHints> {
    const actor = this.requireActor(actorId);
    const boardKey = (command.boardId ?? command.board ?? '').trim();
    if (!boardKey) throw new ValidationError('boardId 必填', { field: 'boardId' });

    const board = await this.boards.findBoardByIdOrSlug(boardKey);
    if (!board) throw new ValidationError('版块不存在', { field: 'boardId', boardId: boardKey });

    const title = this.normalizeTitle(command.title);
    const body = this.normalizeBody(command.body, FORUM_BODY_MAX);
    const tags = this.normalizeTags(command.tags);
    this.assertNoBannedKeyword(`${title}\n${body}`);

    const status = command.status ? normalizePostStatus(command.status) : 'PUBLISHED';
    if (!status) throw new ValidationError('status 不是合法的论坛主题状态', { field: 'status' });
    if (status !== 'DRAFT' && status !== 'PUBLISHED') {
      throw new ValidationError('新主题只能以 DRAFT 或 PUBLISHED 创建', { field: 'status', status });
    }

    const id = ulid();
    const anonymous = command.anonymous === true;
    const created = await this.posts.create({
      id,
      boardId: board.id,
      authorId: anonymous ? null : actor,
      anonHandle: anonymous ? anonHandleFor(actor, anonThreadScope(id), this.anonSecret) : null,
      title,
      body,
      status,
      tags,
    });

    await this.boards.adjustBoardPostCount(board.id, 1);
    const view = this.toPostView(created, anonymous ? ANONYMOUS_NICKNAME : await this.nicknameFor(created));
    return { ...view, piiWarning: piiHintFor(title, body) };
  }

  /**
   * 编辑主题（契约 §11.1 JSON Merge Patch）：
   *   · 只改出现的字段；显式 `null` 表示清空（title/body 不允许清空）；
   *   · 正文只有**作者本人**能改，且仅限 DRAFT/PUBLISHED/LOCKED；
   *   · 状态流转走状态机；锁定/隐藏/恢复只有版主能做；
   *   · 置顶（pinnedAt）只有版主能做。
   */
  async patchPost(id: string, patch: UpdateForumPostCommand, actorId?: string): Promise<ForumPostWithHints> {
    const actor = this.requireActor(actorId);
    const post = await this.posts.findById(id);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');

    const isOwner = this.isPostOwner(post, actor);
    const isModerator = await this.roles.hasRole(actor, 'forum_moderator');
    if (!isOwner && !isModerator) throw new ForbiddenError('只有作者本人或版主可以修改该主题');

    const data: UpdateForumPostInput = {};
    let contentTouched = false;

    if ('title' in patch || 'body' in patch || 'tags' in patch) {
      if (!isOwner) throw new ForbiddenError('版主不能改写他人帖子的正文，只能隐藏或删除');
      if (!POST_STATUSES_EDITABLE_BY_AUTHOR.includes(post.status as ForumPostStatus)) {
        throw new ConflictError('该主题当前状态不允许作者再修改正文', { status: post.status });
      }
    }

    if ('title' in patch) {
      if (patch.title === null) throw new ValidationError('title 不能清空', { field: 'title' });
      data.title = this.normalizeTitle(patch.title);
      contentTouched = true;
    }
    if ('body' in patch) {
      if (patch.body === null) throw new ValidationError('body 不能清空', { field: 'body' });
      data.body = this.normalizeBody(patch.body, FORUM_BODY_MAX);
      contentTouched = true;
    }
    if ('tags' in patch) {
      // Merge Patch 语义：null = 清空该字段
      data.tags = patch.tags === null ? [] : this.normalizeTags(patch.tags);
      contentTouched = true;
    }
    if ('pinnedAt' in patch) {
      if (!isModerator) throw new ForbiddenError('置顶只有版主可以操作');
      data.pinnedAt = patch.pinnedAt ? new Date(patch.pinnedAt) : null;
    }

    if ('status' in patch) {
      const raw = patch.status;
      if (raw === null) throw new ValidationError('status 不能清空', { field: 'status' });
      const next = normalizePostStatus(raw);
      if (!next) throw new ValidationError('status 不是合法的论坛主题状态', { field: 'status', status: raw });
      const from = post.status as ForumPostStatus;
      if (!canTransitionForumPost(from, next)) {
        throw new ConflictError(`主题状态不能从 ${from} 变为 ${next}`, { from, to: next });
      }
      if (requiresModeratorForPostTransition(from, next) && !isModerator) {
        throw new ForbiddenError('锁定 / 隐藏 / 恢复主题需要版主权限');
      }
      data.status = next;
    }

    if (Object.keys(data).length === 0) {
      throw new ValidationError('PATCH 请求体没有可修改的字段');
    }

    const updated = await this.posts.update(id, data);

    // 版块冗余计数：postCount 统计"未删除主题数"
    if (data.status === 'DELETED' && post.status !== 'DELETED') {
      await this.boards.adjustBoardPostCount(post.boardId, -1);
    }

    const view = this.toPostView(updated, await this.nicknameFor(updated));
    return { ...view, piiWarning: contentTouched ? piiHintFor(updated.title, updated.body) : false };
  }

  /** CrudService.update 的重写：把通用更新收敛到 patchPost，杜绝绕过状态机的写入路径 */
  override async update(id: string, input: UpdateForumPostInput, actorId?: string): Promise<ForumPostModel> {
    const view = await this.patchPost(id, input, actorId);
    return view as unknown as ForumPostModel;
  }

  /**
   * 删除主题 —— **软删除**（02-domain-model §0.1：业务实体一律软删）。
   * 作者本人或版主可删。
   */
  override async remove(id: string, actorId?: string): Promise<void> {
    const actor = this.requireActor(actorId);
    const post = await this.posts.findById(id);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');

    const isOwner = this.isPostOwner(post, actor);
    if (!isOwner) await this.requireModerator(actor);

    await this.posts.update(id, { status: 'DELETED' });
    await this.boards.adjustBoardPostCount(post.boardId, -1);
  }

  /* ================= 回复 ================= */

  async listReplies(postId: string, params: ListParams, viewerId?: string): Promise<Page<ForumReplyView>> {
    const post = await this.posts.findById(postId);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');
    const includeHidden = viewerId ? await this.isModerator(viewerId) : false;
    const page = await this.posts.listReplies({ postId, includeHidden, ...params });
    return this.toReplyPage(page);
  }

  /** 回复主题（契约 §6.1 的 POST /forum/items/:id/replies） */
  async createReply(
    postId: string,
    command: CreateForumReplyCommand,
    actorId?: string,
  ): Promise<ForumReplyWithHints> {
    const actor = this.requireActor(actorId);
    const post = await this.posts.findById(postId);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');
    if (!canReplyToPost(post.status as ForumPostStatus)) {
      throw new ConflictError('主题已锁定或已隐藏，无法回复', { status: post.status });
    }

    const body = this.normalizeBody(command.body, FORUM_REPLY_BODY_MAX);
    this.assertNoBannedKeyword(body);

    if (command.parentReplyId) {
      const parent = await this.posts.findReplyById(command.parentReplyId);
      if (!parent || parent.postId !== postId || parent.status === 'DELETED') {
        throw new ValidationError('被回复的楼层不存在', { field: 'parentReplyId' });
      }
    }

    const anonymous = command.anonymous === true;
    const input: CreateForumReplyInput = {
      id: ulid(),
      postId,
      parentReplyId: command.parentReplyId ?? null,
      // 匿名回复同样**不落实名**：authorId 为 null，只留主题作用域内的 handle
      authorId: anonymous ? null : actor,
      anonHandle: anonymous ? anonHandleFor(actor, anonThreadScope(postId), this.anonSecret) : null,
      body,
      status: 'PUBLISHED',
    };

    const reply = await this.posts.addReply(input);
    const view = this.toReplyView(reply, anonymous ? ANONYMOUS_NICKNAME : await this.nicknameFor(reply));
    return { ...view, piiWarning: piiHintFor(body) };
  }

  /* ================= 举报与治理 ================= */

  /**
   * 举报主题（契约 §11.2 冻结 action 名 `report`）。
   *
   * 幂等性有两层：
   *   1. `Idempotency-Key`（契约 §11.3）—— 网络重试回放同一响应；
   *   2. 同一举报人重复举报 → 不新增记录（`duplicate: true`），
   *      因此"3 个不同用户"的阈值不会被同一个人刷出来。
   */
  async reportPost(
    postId: string,
    input: { reason: string; detail?: string | null; anonymous?: boolean },
    actorId?: string,
  ): Promise<ReportPostResult> {
    const actor = this.requireActor(actorId);
    const post = await this.posts.findById(postId);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');

    const reason = normalizeReportReason(input.reason ?? '');
    if (!reason) {
      throw new ValidationError('举报原因不在允许的枚举内', {
        field: 'reason',
        allowed: FORUM_REPORT_REASONS,
      });
    }

    // 匿名举报用**独立作用域**（report:<postId>），与作者的 thread:<postId> 不可互推
    const anonymous = input.anonymous === true;
    const reporterKey = anonymous
      ? `anon:${anonHandleFor(actor, `report:${postId}`, this.anonSecret)}`
      : `user:${actor}`;

    const existing = await this.reports.findReportByReporter('POST', postId, reporterKey);
    if (existing) {
      const count = await this.reports.countDistinctReporters('POST', postId);
      return { ...this.toReportView(existing), duplicate: true, reportCount: count, autoHidden: false };
    }

    const report = await this.reports.createReport({
      targetType: 'POST',
      targetId: postId,
      reason,
      detail: input.detail?.trim() || null,
      reporterId: anonymous ? null : actor,
      reporterKey,
    });

    const reportCount = await this.reports.countDistinctReporters('POST', postId);
    let autoHidden = false;
    if (
      reportCount >= FORUM_REPORT_AUTO_HIDE_THRESHOLD &&
      (post.status === 'PUBLISHED' || post.status === 'LOCKED')
    ) {
      await this.posts.update(postId, { status: 'HIDDEN' });
      autoHidden = true;
    }

    return { ...this.toReportView(report), duplicate: false, reportCount, autoHidden };
  }

  /** 治理队列（版主）：按状态列出举报 */
  async listReports(filter: ForumReportListFilter, actorId?: string): Promise<Page<ForumReportView>> {
    const actor = this.requireActor(actorId);
    await this.requireModerator(actor);
    const page = await this.reports.listReports(filter);
    return { items: page.items.map((row) => this.toReportView(row)), nextCursor: page.nextCursor };
  }

  /** 治理裁决（版主）：PENDING → UPHELD / DISMISSED。**不新增 action 名**，走 PATCH。 */
  async setReportStatus(reportId: string, status: string, actorId?: string): Promise<ForumReportView> {
    const actor = this.requireActor(actorId);
    await this.requireModerator(actor);
    if (status !== 'UPHELD' && status !== 'DISMISSED' && status !== 'PENDING') {
      throw new ValidationError('举报状态只能是 PENDING / UPHELD / DISMISSED', { field: 'status' });
    }
    const updated = await this.reports.setReportStatus(reportId, status as ForumReportStatus);
    return this.toReportView(updated);
  }

  /* ================= DTO 组装 ================= */

  private toPostView(row: ForumPostModel, authorNickname: string): ForumPostView {
    return {
      id: row.id,
      boardId: row.boardId,
      title: row.title,
      body: row.body,
      status: (normalizePostStatus(row.status) ?? 'PUBLISHED') as ForumPostStatus,
      anonymous: isAnonymousContent(row),
      authorId: publicAuthorId(row),
      authorNickname,
      tags: row.tags,
      replyCount: row.replyCount,
      likeCount: row.likeCount,
      pinnedAt: row.pinnedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActivityAt: row.updatedAt,
    };
  }

  private toReplyView(row: ForumReplyModel, authorNickname: string): ForumReplyView {
    return {
      id: row.id,
      postId: row.postId,
      parentReplyId: row.parentReplyId,
      body: row.body,
      status: (row.status === 'HIDDEN' || row.status === 'DELETED' ? row.status : 'PUBLISHED') as ForumReplyView['status'],
      anonymous: isAnonymousContent(row),
      authorId: publicAuthorId(row),
      authorNickname,
      likeCount: row.likeCount,
      createdAt: row.createdAt,
    };
  }

  private toBoardView(row: ForumBoardModel, lastPostAt: Date | null): ForumBoardView {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      postCount: row.postCount,
      lastPostAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toReportView(row: ForumReportModel): ForumReportView {
    return {
      id: row.id,
      targetType: row.targetType as ForumReportView['targetType'],
      targetId: row.targetId,
      reason: (normalizeReportReason(row.reason) ?? 'other') as ForumReportView['reason'],
      status: row.status as ForumReportStatus,
      // 匿名举报人返回不透明 handle（不泄漏实名）
      reporterId: row.reporterId ?? row.reporterKey.replace(/^anon:/, ''),
      anonymous: row.reporterId === null,
      note: row.detail,
      createdAt: row.createdAt,
    };
  }

  /** 一页主题一次性补昵称（避免 N+1） */
  private async toPostPage(page: Page<ForumPostModel>): Promise<Page<ForumPostView>> {
    const names = await this.nicknamesFor(page.items);
    return {
      items: page.items.map((row) =>
        this.toPostView(row, isAnonymousContent(row) ? ANONYMOUS_NICKNAME : (names.get(row.authorId ?? '') ?? '同学')),
      ),
      nextCursor: page.nextCursor,
    };
  }

  private async toReplyPage(page: Page<ForumReplyModel>): Promise<Page<ForumReplyView>> {
    const names = await this.nicknamesFor(page.items);
    return {
      items: page.items.map((row) =>
        this.toReplyView(row, isAnonymousContent(row) ? ANONYMOUS_NICKNAME : (names.get(row.authorId ?? '') ?? '同学')),
      ),
      nextCursor: page.nextCursor,
    };
  }

  private async nicknamesFor(rows: Array<{ authorId: string | null }>): Promise<Map<string, string>> {
    const ids = rows.map((row) => row.authorId).filter((id): id is string => Boolean(id));
    return this.users.displayNamesFor(ids);
  }

  private async nicknameFor(row: { authorId: string | null }): Promise<string> {
    if (!row.authorId) return ANONYMOUS_NICKNAME;
    const names = await this.users.displayNamesFor([row.authorId]);
    return names.get(row.authorId) ?? '同学';
  }

  /* ================= 内部工具 ================= */

  /** 匿名 handle 的密钥：优先专用密钥，退化到 JWT_SECRET（部署必须至少配一个） */
  private get anonSecret(): string {
    const dedicated = this.config.get<string>('ANON_HANDLE_SECRET');
    const fallback = this.config.get<string>('JWT_SECRET');
    return dedicated?.trim() || fallback?.trim() || '';
  }

  private get bannedKeywords(): string[] {
    return parseKeywordList(this.config.get<string>('FORUM_BANNED_KEYWORDS'));
  }

  /** 把 wire 上的 `boardId`（可能是 id，也可能是 slug）解析成版块 id */
  private async resolveBoardId(value?: string): Promise<string | undefined> {
    const key = value?.trim();
    if (!key) return undefined;
    const board = await this.boards.findBoardByIdOrSlug(key);
    return board?.id ?? key;
  }

  private async findVisiblePost(id: string, viewerId?: string): Promise<ForumPostModel> {
    const post = await this.posts.findById(id);
    if (!post || post.status === 'DELETED') throw new NotFoundError('论坛主题不存在或已被删除');
    if (post.status === 'HIDDEN') {
      const allowed = viewerId ? await this.canModeratePost(post, viewerId) : false;
      if (!allowed) throw new NotFoundError('论坛主题不存在或已被删除');
    }
    return post;
  }

  private requireActor(actorId?: string): string {
    if (!actorId) {
      throw new UnauthenticatedError('论坛写操作需要先登录（匿名是"对外不可见实名"，不是未登录）');
    }
    return actorId;
  }

  private async requireModerator(actorId: string): Promise<void> {
    if (!(await this.roles.hasRole(actorId, 'forum_moderator'))) {
      throw new ForbiddenError('该操作需要论坛版主权限');
    }
  }

  private async isModerator(actorId: string): Promise<boolean> {
    return this.roles.hasRole(actorId, 'forum_moderator');
  }

  /** 作者判定：实名比 id；匿名**重算** HMAC handle（不查任何映射表） */
  private isPostOwner(post: Pick<ForumPostModel, 'id' | 'authorId' | 'anonHandle'>, actorId: string): boolean {
    if (post.authorId) return post.authorId === actorId;
    return verifyAnonymousHandle(actorId, post.anonHandle, anonThreadScope(post.id), this.anonSecret);
  }

  private async canModeratePost(
    post: Pick<ForumPostModel, 'id' | 'authorId' | 'anonHandle'>,
    viewerId: string,
  ): Promise<boolean> {
    if (this.isPostOwner(post, viewerId)) return true;
    return this.isModerator(viewerId);
  }

  private normalizeTitle(raw: string | null | undefined): string {
    const title = (raw ?? '').trim();
    if (title.length < 1 || title.length > FORUM_TITLE_MAX) {
      throw new ValidationError(`标题长度必须在 1–${FORUM_TITLE_MAX} 字之间`, { field: 'title' });
    }
    return title;
  }

  private normalizeBody(raw: string | null | undefined, max: number): string {
    const body = raw ?? '';
    if (body.trim().length < 1 || body.length > max) {
      throw new ValidationError(`正文长度必须在 1–${max} 字之间`, { field: 'body' });
    }
    return body;
  }

  private normalizeTags(raw: string[] | null | undefined): string[] {
    if (!raw) return [];
    if (raw.length > FORUM_TAGS_MAX) {
      throw new ValidationError(`标签最多 ${FORUM_TAGS_MAX} 个`, { field: 'tags' });
    }
    const tags = [...new Set(raw.map((tag) => tag.trim()).filter(Boolean))];
    for (const tag of tags) {
      if (tag.length > FORUM_TAG_MAX) {
        throw new ValidationError(`单个标签最多 ${FORUM_TAG_MAX} 字`, { field: 'tags', tag });
      }
    }
    return tags;
  }

  /** 敏感词命中即拦截（**不静默改写**，02-domain-model §2.4） */
  private assertNoBannedKeyword(text: string): void {
    const hit = findBannedKeyword(text, this.bannedKeywords);
    if (hit) {
      throw new ValidationError('内容命中敏感词，请修改后重试', { keyword: hit });
    }
  }
}
