/**
 * 论坛 · forum（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ForumPostService } from './forum.service';
import type { CreateForumPostInput, UpdateForumPostInput } from './domain/forum.domain';

const replySchema = z.object({
  body: z.string().min(1).max(5000),
  anonHandle: z.string().min(1).max(64).optional(),
});

const createSchema = z.object({
  board: z.string().min(1).max(500),
  authorId: z.string().max(500).nullish(),
  anonHandle: z.string().max(500).nullish(),
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(500),
  status: z.string().min(1).max(500).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateForumPostInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateForumPostInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('forum · 论坛')
@Controller(modulePath('forum'))
@UseGuards(OptionalAuthGuard)
export class ForumController {
  constructor(@Inject(ForumPostService) private readonly service: ForumPostService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateForumPostInput,
  ) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '更新' })
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateForumPostInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/reply')
  @ApiOperation({ summary: '回复主题（实名或匿名，匿名与实名解耦存储）' })
  reply(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
    @ZodBody(replySchema) body: z.infer<typeof replySchema>,
  ) {
    return this.service.reply(id, body.body, actorId, body.anonHandle);
  }

  @Get('items/:id/replies')
  @ApiOperation({ summary: '主题回复列表' })
  replies(@Param('id') id: string) {
    return this.service.replies(id);
  }
}
