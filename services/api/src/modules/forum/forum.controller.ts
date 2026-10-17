import { Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { ForumPostService } from './forum.service';
import {
  FORUM_BOARDS,
  FORUM_REPLIES_PAGE_SIZE,
  FORUM_SORTS,
  FORUM_STATUSES,
  type CreateForumPostInput,
  type CreateForumReplyInput,
} from './domain/forum.domain';

/**
 * 论坛 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（版块 / 列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能逛；
 *   · 写接口（发帖 / 回复 / 关闭 / 删除）逐个挂 `AuthGuard` —— 必须登录；
 *   · `anonymous: true` 只影响**存储形态**（authorId 置 null），不影响鉴权：
 *     发帖人始终必须先登录，只是登录身份不会写进内容里。
 *   · `mine=1` 需要登录，且匿名帖天然不计入（没有 authorId 可匹配）。
 */

const createPostSchema = z.object({
  board: z.enum(FORUM_BOARDS),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(5000),
  /** 匿名发帖：authorId 不落库，改用服务端生成的匿名 handle */
  anonymous: z.boolean().optional(),
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  anonymous: z.boolean().optional(),
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  board: z.enum(FORUM_BOARDS).optional(),
  status: z.enum(FORUM_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(FORUM_SORTS).optional(),
  /** `mine=1` → 我发的（匿名帖不计入，需要登录） */
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
});

const detailQuerySchema = z.object({
  replyCursor: z.string().min(1).max(200).optional(),
  replyLimit: z.coerce.number().int().min(1).max(FORUM_REPLIES_PAGE_SIZE).optional(),
});

type CreatePostBody = z.infer<typeof createPostSchema>;
type ReplyBody = z.infer<typeof replySchema>;
type ListQuery = z.infer<typeof listQuerySchema>;
type DetailQuery = z.infer<typeof detailQuerySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, __Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateForumPostInput, CreatePostBody>;
export type ReplySchemaMatchesDomain = AssertAssignable<CreateForumReplyInput, ReplyBody>;

@ApiTags('forum · 论坛')
@Controller(modulePath('forum'))
@UseGuards(OptionalAuthGuard)
export class ForumController {
  constructor(@Inject(ForumPostService) private readonly service: ForumPostService) {}

  @Get('boards')
  @ApiOperation({ summary: '版块清单 + 每版块帖子数（一次 groupBy 统计）' })
  boards() {
    return this.service.boards();
  }

  @Get('posts')
  @ApiOperation({
    summary: '帖子列表（版块/关键词/状态筛选 + 最新/热度排序）',
    description: '公开可读，默认只返回 published。`mine=1` 需要登录。',
  })
  list(@OptionalCurrentUser() viewerId: string | undefined, @ZodQuery(listQuerySchema) query: ListQuery) {
    const onlyMine = query.mine === '1' || query.mine === 'true';
    if (onlyMine && !viewerId) throw new UnauthenticatedError('查看「我的帖子」需要先登录');

    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.board === undefined ? {} : { board: query.board }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { keyword: query.q }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(onlyMine && viewerId ? { authorId: viewerId } : {}),
    });
  }

  @Post('posts')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发帖（登录用户，可选匿名）' })
  create(@CurrentUser() actorId: string, @ZodBody(createPostSchema) body: CreatePostBody) {
    return this.service.create(body, actorId);
  }

  @Get('posts/:id')
  @ApiOperation({ summary: '帖子详情 + 一页回复（replyCursor / replyLimit）' })
  detail(@Param('id') id: string, @ZodQuery(detailQuerySchema) query: DetailQuery) {
    return this.service.detail(id, {
      ...(query.replyCursor === undefined ? {} : { cursor: query.replyCursor }),
      ...(query.replyLimit === undefined ? {} : { limit: query.replyLimit }),
    });
  }

  @Post('posts/:id/replies')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '回复主题（登录用户，可选匿名；同一事务维护 replyCount）' })
  reply(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(replySchema) body: ReplyBody) {
    return this.service.reply(id, body, actorId);
  }

  @Post('posts/:id/close')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '关闭主题（仅实名作者；匿名帖不可关闭）' })
  close(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.close(id, actorId);
  }

  @Delete('posts/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除主题（仅实名作者；匿名帖不可删除）' })
  async remove(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }
}
