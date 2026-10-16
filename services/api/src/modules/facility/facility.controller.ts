/**
 * 场馆预约 · facility（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 14 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { FacilityBookingService } from './facility.service';
import type { CreateFacilityBookingInput, UpdateFacilityBookingInput } from './domain/facility.domain';

const createSchema = z.object({
  ownerId: z.string().min(1).max(500),
  kind: z.string().min(1).max(500),
  facilityName: z.string().max(500).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.string().min(1).max(500).optional(),
  feeFen: z.number().int(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateFacilityBookingInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateFacilityBookingInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('facility · 场馆预约')
@Controller(modulePath('facility'))
@UseGuards(OptionalAuthGuard)
export class FacilityController {
  constructor(@Inject(FacilityBookingService) private readonly service: FacilityBookingService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateFacilityBookingInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateFacilityBookingInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消预约（契约 §11.10-C 的领域动作；仅发起人）' })
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }
}
