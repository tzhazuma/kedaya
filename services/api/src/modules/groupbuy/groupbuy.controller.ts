/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { GroupbuyOrderService } from './groupbuy.service';
import type { CreateGroupbuyOrderInput, UpdateGroupbuyOrderInput } from './domain/groupbuy.domain';

const joinSchema = z.object({ quantity: z.number().int().positive().max(99) });

const createSchema = z.object({
  ownerId: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  description: z.string().max(500).nullish(),
  category: z.string().min(1).max(500),
  targetCount: z.number().int(),
  unitPriceFen: z.number().int(),
  status: z.string().min(1).max(500).optional(),
  deadline: z.coerce.date(),
  pickupSpot: z.string().max(500).nullish(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateGroupbuyOrderInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateGroupbuyOrderInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('groupbuy · 拼单')
@Controller(modulePath('groupbuy'))
@UseGuards(OptionalAuthGuard)
export class GroupbuyController {
  constructor(@Inject(GroupbuyOrderService) private readonly service: GroupbuyOrderService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateGroupbuyOrderInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateGroupbuyOrderInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '参团（成团后状态自动推进为 grouped）' })
  join(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(joinSchema) body: z.infer<typeof joinSchema>,
  ) {
    return this.service.join(id, userId, body.quantity);
  }
}
