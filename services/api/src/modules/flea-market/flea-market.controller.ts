import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { FleaItemService } from './flea-market.service';
import {
  FLEA_CATEGORIES,
  FLEA_CONDITIONS,
  FLEA_SORTS,
  FLEA_STATUS,
  type CreateFleaItemInput,
  type UpdateFleaItemInput,
} from './domain/flea-market.domain';

/**
 * 跳蚤市场 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能逛；
 *   · 写接口逐个挂 `AuthGuard` —— 必须登录，且主体只能来自 JWT；
 *   · `mine=1` 需要登录：它把 `sellerId` 强制设为当前用户，
 *     因此不可能用它去列出别人的东西。
 *
 * 本模块**不接受**请求体里的 `sellerId`：发布者只能是自己。
 */

const createSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().max(2000).nullish(),
  /** 单位：分。上限与 domain 的 FLEA_MAX_PRICE_FEN 保持一致 */
  priceFen: z.number().int().min(0).max(100_000_000),
  category: z.enum(FLEA_CATEGORIES),
  condition: z.enum(FLEA_CONDITIONS).optional(),
  campusSpot: z.string().trim().max(60).nullish(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(2000).nullish(),
  priceFen: z.number().int().min(0).max(100_000_000).optional(),
  category: z.enum(FLEA_CATEGORIES).optional(),
  condition: z.enum(FLEA_CONDITIONS).optional(),
  campusSpot: z.string().trim().max(60).nullish(),
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  category: z.enum(FLEA_CATEGORIES).optional(),
  condition: z.enum(FLEA_CONDITIONS).optional(),
  status: z.enum([FLEA_STATUS.onSale, FLEA_STATUS.reserved, FLEA_STATUS.sold]).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(FLEA_SORTS).optional(),
  /** `mine=1` → 只看自己的发布（需要登录） */
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateFleaItemInput, CreateBody>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateFleaItemInput, UpdateBody>;

@ApiTags('flea-market · 跳蚤市场')
@Controller(modulePath('flea-market'))
@UseGuards(OptionalAuthGuard)
export class FleaMarketController {
  constructor(@Inject(FleaItemService) private readonly service: FleaItemService) {}

  @Get('items')
  @ApiOperation({
    summary: '商品列表（游标分页 + 分类/成色/状态/关键词筛选 + 排序）',
    description: '公开可读。`mine=1` 只看自己的发布，需要登录。',
  })
  list(
    @OptionalCurrentUser() viewerId: string | undefined,
    @ZodQuery(listQuerySchema) query: ListQuery,
  ) {
    const onlyMine = query.mine === '1' || query.mine === 'true';
    if (onlyMine && !viewerId) throw new UnauthenticatedError('查看「我的发布」需要先登录');

    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.condition === undefined ? {} : { condition: query.condition }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { keyword: query.q }),
      ...(onlyMine && viewerId ? { sellerId: viewerId } : {}),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发布商品（登录用户）' })
  create(@CurrentUser() actorId: string, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '商品详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改商品（仅发布者）' })
  update(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(updateSchema) body: UpdateBody) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除商品（仅发布者）' })
  async remove(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Post('items/:id/reserve')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：我要了（买家预定）' })
  reserve(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.reserve(id, actorId);
  }

  @Post('items/:id/release')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：解除预定（仅发布者）' })
  release(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.release(id, actorId);
  }

  @Post('items/:id/sold')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：标记已售出（仅发布者，终态）' })
  markSold(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.markSold(id, actorId);
  }
}
