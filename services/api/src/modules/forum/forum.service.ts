/**
 * 论坛 · forum（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  FORUM_POST_REPOSITORY,
  type CreateForumPostInput,
  type ForumPostModel,
  type ForumPostRepository,
  type UpdateForumPostInput,
} from './domain/forum.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ForumPostService extends CrudService<ForumPostModel, CreateForumPostInput, UpdateForumPostInput> {
  constructor(
    @Inject(FORUM_POST_REPOSITORY) private readonly repo: ForumPostRepository,
  ) {
    super(repo, 'forum', '论坛');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateForumPostInput, _actorId?: string): Promise<ForumPostModel> {
    return super.create(input);
  }
  /** 领域动作：回复主题（契约 §9：支持匿名，与实名身份解耦存储） */
  reply(id: string, body: string, actorId?: string, anonHandle?: string) {
    return this.repo.addReply(id, { body, authorId: actorId ?? null, anonHandle: anonHandle ?? null });
  }

  replies(id: string) {
    return this.repo.listReplies(id);
  }}
