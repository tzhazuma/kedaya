/**
 * 课表 · schedule（契约 §4）
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
import { ValidationError } from '../../common/errors/app-error';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ScheduleCourseService } from './schedule.service';
import type { CreateScheduleCourseInput, UpdateScheduleCourseInput } from './domain/schedule.domain';

const createSchema = z.object({
  userId: z.string().min(1).max(500),
  term: z.string().min(1).max(500),
  courseName: z.string().min(1).max(500),
  teacher: z.string().max(500).nullish(),
  location: z.string().max(500).nullish(),
  weekday: z.number().int(),
  startSlot: z.number().int(),
  endSlot: z.number().int(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateScheduleCourseInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateScheduleCourseInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('schedule · 课表')
@Controller(modulePath('schedule'))
@UseGuards(OptionalAuthGuard)
export class ScheduleController {
  constructor(@Inject(ScheduleCourseService) private readonly service: ScheduleCourseService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateScheduleCourseInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateScheduleCourseInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Get('upcoming')
  @ApiOperation({ summary: '按学期 + 星期查询课表' })
  upcoming(@Query('term') term: string, @Query('weekday') weekday: string) {
    const parsed = Number(weekday);
    if (!term || !Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
      throw new ValidationError('term 必填，weekday 必须是 1..7 的整数', { term, weekday });
    }
    return this.service.listByWeekday(term, parsed);
  }
}
