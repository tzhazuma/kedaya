/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { CampusBindingGuard, RequireCampusBinding } from '../techpie/data/campus-binding.guard';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
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
// ⚠️ 契约 §11.4 **I4**：课表属校园系统数据，必须「已登录 **且** 已绑定 cpdaily」。
// 顺序不能反 —— AuthGuard 先解出身份，CampusBindingGuard 才能判断绑定。
// 曾用 `OptionalAuthGuard`（未登录也放行）：那会让「未登录」与「未绑定」
// 两种状态**无法区分**，而它们对用户的出路完全不同（去登录 / 去绑定）。
@UseGuards(AuthGuard, CampusBindingGuard)
@RequireCampusBinding('cpdaily')
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

  /* ================================================================ *
   * 领域端点：用户真正会用的四个视图
   *
   * 这些都必须登录（class 级 OptionalAuthGuard + 方法级 AuthGuard 叠加，
   * 未带 token 会在方法级被拦下），因为它们回答的都是"**我**的课"。
   * ================================================================ */

  @Get('today')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '今日课表 + 「正在上 / 下一节 / 还有几分钟」',
    description:
      '时间信息由服务端按自身时钟算好下发（客户端时钟不准也不会显示错误的倒计时）。' +
      '`term` 缺省为当前学期。',
  })
  today(@CurrentUser() userId: string, @Query('term') term?: string) {
    return this.service.today(userId, readTerm(term));
  }

  @Get('week')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '本周课表（7 天一次拉齐 + 时间冲突 + 可切换学期）',
    description: '移动端一次请求渲染整屏，避免按天请求 7 次造成的"部分加载"观感。',
  })
  week(@CurrentUser() userId: string, @Query('term') term?: string) {
    return this.service.week(userId, readTerm(term));
  }

  @Get('next')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '下一节课（供可达鸭 agent / 桌面组件复用）' })
  next(@CurrentUser() userId: string) {
    return this.service.nextClass(userId);
  }

  @Post('sync')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '从教务系统（JWC）同步课表',
    description:
      '未绑定 JWC → CAMPUS_BINDING_REQUIRED（客户端展示"去绑定"引导）。' +
      '上游失败时**不清空**本地课表，用户看到的仍是上次同步成功的结果。',
  })
  sync(@CurrentUser() userId: string, @Query('term') term?: string) {
    return this.service.syncFromCampus(userId, readTerm(term));
  }
}

/** 学期参数只允许 `YYYY-YYYY-1|2` 形状，避免把任意字符串拼进查询 */
function readTerm(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{4}-\d{4}-[12]$/.test(raw)) {
    throw new ValidationError('term 形状应为 2026-2027-1', { term: raw });
  }
  return raw;
}
