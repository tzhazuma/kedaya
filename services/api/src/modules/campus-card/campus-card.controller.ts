/**
 * 校园卡 · campus-card（契约 §4）
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
import { ValidationError } from '../../common/errors/app-error';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CampusCardTransactionService } from './campus-card.service';
import type { CreateCampusCardTransactionInput, UpdateCampusCardTransactionInput } from './domain/campus-card.domain';

const createSchema = z.object({
  userId: z.string().min(1).max(500),
  amountFen: z.number().int(),
  direction: z.string().min(1).max(500),
  merchant: z.string().min(1).max(500),
  happenedAt: z.coerce.date(),
  balanceAfterFen: z.number().int(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateCampusCardTransactionInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateCampusCardTransactionInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('campus-card · 校园卡')
@Controller(modulePath('campus-card'))
@UseGuards(OptionalAuthGuard)
export class CampusCardController {
  constructor(@Inject(CampusCardTransactionService) private readonly service: CampusCardTransactionService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateCampusCardTransactionInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateCampusCardTransactionInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Get('summary')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '流水汇总（第二级能力：未绑定返回 CAMPUS_BINDING_REQUIRED）' })
  summary(@CurrentUser() userId: string) {
    return this.service.balanceSummary(userId);
  }

  /* ================================================================ *
   * 领域端点：用户真正会用的两个视图
   * ================================================================ */

  @Get('overview')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '余额总览（余额 + 流水 + 低余额 + 还能撑几天 + 异常扣款）',
    description:
      '上游不可用时**退回本地缓存**并置 `stale: true` + `syncedAt`（绝不把余额显示成 0）。' +
      '连缓存都没有才报 UPSTREAM_UNAVAILABLE（客户端展示重试）。' +
      '`thresholdFen` 可覆盖默认低余额阈值（分）。',
  })
  overview(@CurrentUser() userId: string, @Query('thresholdFen') thresholdFen?: string) {
    return this.service.overview(userId, readThreshold(thresholdFen));
  }

  @Get('lost-report')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '挂失指引（含官方渠道；会写审计）',
    description:
      '**不提供**"一键挂失"：KedaYa 对校园卡系统没有写权限，' +
      '假报成功会在用户最需要冻结卡片时造成损失。这里给最可靠的官方路径。',
  })
  lostReport(@CurrentUser() userId: string, @Query('reason') reason?: string) {
    return this.service.lostReport(userId, reason);
  }
}

/** 低余额阈值：只接受 0..100000 分的整数，防止把 `abc` 之类塞进领域层 */
function readThreshold(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
    throw new ValidationError('thresholdFen 必须是 0..100000 的整数（单位：分）', {
      thresholdFen: raw,
    });
  }
  return parsed;
}
