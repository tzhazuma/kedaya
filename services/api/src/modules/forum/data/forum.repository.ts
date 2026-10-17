/**
 * 论坛 · forum（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ForumPost } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateForumPostInput,
  ForumPostModel,
  ForumPostRepository,
  UpdateForumPostInput,
} from '../domain/forum.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class ForumPostPrismaRepository
  extends PrismaCursorRepository<ForumPost, ForumPostModel, CreateForumPostInput, UpdateForumPostInput>
  implements ForumPostRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.forumPost);
  }

  /** 回复主题（真实写入 ForumReply 关联表） */
  async addReply(
    postId: string,
    input: { body: string; authorId?: string | null; anonHandle?: string | null },
  ): Promise<{ id: string; postId: string; body: string; createdAt: Date }> {
    return this.prisma.forumReply.create({
      data: {
        postId,
        body: input.body,
        authorId: input.authorId ?? null,
        anonHandle: input.anonHandle ?? null,
      },
      select: { id: true, postId: true, body: true, createdAt: true },
    });
  }

  listReplies(postId: string) {
    return this.prisma.forumReply.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }}
