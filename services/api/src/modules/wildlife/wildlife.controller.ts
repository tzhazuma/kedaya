/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
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
import { WildlifeSpotService } from './wildlife.service';
import type { CreateWildlifeSpotInput, UpdateWildlifeSpotInput } from './domain/wildlife.domain';

const createSchema = z.object({
  species: z.string().min(1).max(500),
  place: z.string().min(1).max(500),
  lat: z.number(),
  lng: z.number(),
  note: z.string().max(500).nullish(),
  reportedBy: z.string().max(500).nullish(),
  status: z.string().min(1).max(500).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateWildlifeSpotInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateWildlifeSpotInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('wildlife · 猫鸟黑天鹅')
@Controller(modulePath('wildlife'))
@UseGuards(OptionalAuthGuard)
export class WildlifeController {
  constructor(@Inject(WildlifeSpotService) private readonly service: WildlifeSpotService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateWildlifeSpotInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateWildlifeSpotInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/confirm')
  @ApiOperation({ summary: '领域动作：确认为有效活动点' })
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }
}
