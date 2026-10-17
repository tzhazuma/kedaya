import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { TakeoutReportService } from './takeout-guard.service';
import {
  TAKEOUT_DETAIL_MAX,
  TAKEOUT_ORDER_NO_MAX,
  TAKEOUT_PLACE_MAX,
  TAKEOUT_REPORT_STATUSES,
  type CreateTakeoutReportInput,
  type UpdateTakeoutReportInput,
} from './domain/takeout-guard.domain';

/**
 * 偷外卖 HTTP 层（契约 §6.1 统一形状）。
 *
 * 与一般 CRUD 模块不同，这里**没有公开可读的接口**：
 *   · 列表 / 详情 / 改 / 删 / 领域动作**全部**要求登录，主体只来自 JWT；
 *   · 列表没有 `mine` 开关 —— 它永远只看自己（见 service.list 的注释）；
 *   · 请求体里**没有** `reporterId` / `anonHandle` / `status`，归属与状态都由服务层决定。
 *
 * 守卫仍用 `OptionalAuthGuard` + `@OptionalCurrentUser()`（而不是 `AuthGuard`）：
 * 这样"未登录"由服务层的 `UnauthenticatedError` 统一给出 401 与可读文案，
 * 与其它模块的 `create` 行为保持一致。
 */

const createSchema = z.object({
  orderNo: z.string().trim().min(1).max(TAKEOUT_ORDER_NO_MAX),
  place: z.string().trim().min(1).max(TAKEOUT_PLACE_MAX),
  happenedAt: z.coerce.date(),
  /** 经过描述必填：说不清楚发生了什么，后面就没法跟对方或辅导员对齐 */
  detail: z.string().trim().min(1).max(TAKEOUT_DETAIL_MAX),
  /**
   * 证据图只留一列（`evidenceUrl`），因此这里只接**单张**地址；
   * 「地址是否真的来自本平台」由服务层的 `MediaUrlPolicy` 判定（那是业务规则）。
   */
  evidenceUrl: z.string().trim().min(1).max(512).nullish(),
});

/** 只能改"经过"类字段：`status` / 归属不在 schema 里，PATCH 无法绕过状态机 */
const updateSchema = z.object({
  orderNo: z.string().trim().min(1).max(TAKEOUT_ORDER_NO_MAX).optional(),
  place: z.string().trim().min(1).max(TAKEOUT_PLACE_MAX).optional(),
  happenedAt: z.coerce.date().optional(),
  detail: z.string().trim().min(1).max(TAKEOUT_DETAIL_MAX).optional(),
  evidenceUrl: z.string().trim().min(1).max(512).nullish(),
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** 状态白名单；旧的自由字符串（如 'reported'）在这里就会被拒 */
  status: z.enum(TAKEOUT_REPORT_STATUSES).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 这里同时锁住一条安全性质 —— 请求体类型里**没有** `reporterId` / `status`，
 * 若有人往 schema 里加回去，这个断言不会失败，但 service 会把它们覆盖掉（见单测）。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateTakeoutReportInput, CreateBody>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateTakeoutReportInput, UpdateBody>;

@ApiTags('takeout-guard · 偷外卖')
@Controller(modulePath('takeout-guard'))
@UseGuards(OptionalAuthGuard)
export class TakeoutGuardController {
  constructor(@Inject(TakeoutReportService) private readonly service: TakeoutReportService) {}

  @Get('items')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我自己记录的外卖被拿错（游标分页 + 状态筛选）',
    description:
      '**只返回当前登录用户的记录**（强制 `reporterId = 主体`，没有 mine 开关）。未登录返回 401。',
  })
  list(@OptionalCurrentUser() actorId: string | undefined, @ZodQuery(listQuerySchema) query: ListQuery) {
    return this.service.list(
      {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      actorId,
    );
  }

  @Post('items')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '记录一次外卖被拿错（登录用户）',
    description: '归属与初始状态（pending）由服务端决定，请求体里没有 reporterId / status。',
  })
  create(@OptionalCurrentUser() actorId: string | undefined, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '记录详情（仅记录人本人；非本人返回 404）' })
  detail(@OptionalCurrentUser() actorId: string | undefined, @Param('id') id: string) {
    return this.service.detail(id, actorId);
  }

  @Patch('items/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '补充 / 修正经过（仅记录人本人，不能改状态与归属）' })
  update(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateBody,
  ) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除记录（仅记录人本人）' })
  async remove(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Post('items/:id/escalate')
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：升级处理（仅记录人本人，pending → escalated）' })
  escalate(@OptionalCurrentUser() actorId: string | undefined, @Param('id') id: string) {
    return this.service.escalate(id, actorId);
  }

  @Post('items/:id/resolve')
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：标记已解决（仅记录人本人，pending / escalated → resolved）' })
  resolve(@OptionalCurrentUser() actorId: string | undefined, @Param('id') id: string) {
    return this.service.resolve(id, actorId);
  }
}
