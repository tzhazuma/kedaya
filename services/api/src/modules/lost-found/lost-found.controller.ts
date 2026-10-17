import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { optionalImageUrlsSchema } from '../../common/media/image-urls.schema';
import { LostFoundItemService } from './lost-found.service';
import {
  LOST_FOUND_KINDS,
  LOST_FOUND_SORTS,
  LOST_FOUND_STATUSES,
  type CreateLostFoundItemInput,
  type UpdateLostFoundItemInput,
} from './domain/lost-found.domain';

/**
 * 失物招领 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能查；
 *   · 写接口逐个挂 `AuthGuard` —— 必须登录，且主体只能来自 JWT；
 *   · `mine=1` 需要登录：它把 `reporterId` 强制设为当前用户。
 *
 * 本模块**不接受**请求体里的 `reporterId`：发布者只能是自己。
 */

const createSchema = z.object({
  kind: z.enum(LOST_FOUND_KINDS),
  title: z.string().trim().min(1).max(60),
  description: z.string().max(2000).nullish(),
  place: z.string().trim().min(1).max(60),
  happenedAt: z.coerce.date(),
  contactHint: z.string().trim().max(60).nullish(),
  imageUrls: optionalImageUrlsSchema,
});

const updateSchema = z.object({
  kind: z.enum(LOST_FOUND_KINDS).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(2000).nullish(),
  place: z.string().trim().min(1).max(60).optional(),
  happenedAt: z.coerce.date().optional(),
  contactHint: z.string().trim().max(60).nullish(),
  imageUrls: optionalImageUrlsSchema,
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  kind: z.enum(LOST_FOUND_KINDS).optional(),
  status: z.enum(LOST_FOUND_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  place: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(LOST_FOUND_SORTS).optional(),
  /** `mine=1` → 只看自己的发布（需要登录） */
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, __Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateLostFoundItemInput, CreateBody>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateLostFoundItemInput, UpdateBody>;

@ApiTags('lost-found · 失物招领')
@Controller(modulePath('lost-found'))
@UseGuards(OptionalAuthGuard)
export class LostFoundController {
  constructor(@Inject(LostFoundItemService) private readonly service: LostFoundItemService) {}

  @Get('items')
  @ApiOperation({
    summary: '失物招领列表（类型/状态/关键词/地点筛选 + 排序）',
    description: '公开可读。`mine=1` 只看自己的发布，需要登录。',
  })
  list(@OptionalCurrentUser() viewerId: string | undefined, @ZodQuery(listQuerySchema) query: ListQuery) {
    const onlyMine = query.mine === '1' || query.mine === 'true';
    if (onlyMine && !viewerId) throw new UnauthenticatedError('查看「我的发布」需要先登录');

    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { keyword: query.q }),
      ...(query.place === undefined ? {} : { place: query.place }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(onlyMine && viewerId ? { reporterId: viewerId } : {}),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发布失物 / 招领信息（登录用户）' })
  create(@CurrentUser() actorId: string, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '信息详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改信息（仅发布者）' })
  update(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(updateSchema) body: UpdateBody) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除信息（仅发布者）' })
  async remove(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Post('items/:id/resolve')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：标记已找回 / 已归还（仅发布者）' })
  resolve(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.resolve(id, actorId);
  }

  @Post('items/:id/reopen')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：重新开放（仅发布者）' })
  reopen(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.reopen(id, actorId);
  }
}
