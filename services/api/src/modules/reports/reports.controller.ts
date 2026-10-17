import { Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { REPORT_TARGET_TYPES, REPORT_REASONS } from './domain/reports.domain';
import { ReportService } from './reports.service';

/**
 * 内容举报 HTTP 层。
 *
 * ## 为什么路由是 `/reports` 而不是 `modulePath('reports')`
 *
 * 与 `telemetry` 同理：举报是**跨模块的治理能力**，不是一个用户可见的业务模块。
 * 契约 §4 把模块清单冻结为 19 个，往里加一个会同时打破
 * `apps/web` 的交付状态断言与首页宫格。
 *
 * ## 为什么整个控制器都要登录
 *
 * 举报天然是"实名的"（`reporterId` 落库）：匿名举报在治理上几乎无法使用 ——
 * 无法判断是否为同一人刷量、无法在误报时回访、也无法实现"同一个人只算一票"。
 * 未登录用户看到的是"登录后才能举报"的引导（客户端处理），而不是一个静默失败的按钮。
 */
const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().trim().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(300).optional(),
});

type CreateReportBody = z.infer<typeof createReportSchema>;

@ApiTags('reports · 内容举报')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportController {
  constructor(@Inject(ReportService) private readonly service: ReportService) {}

  @Post()
  @ApiOperation({
    summary: '举报一条内容（重复举报返回 409；不能举报自己的内容）',
    description:
      '举报不会自动下架内容 —— 只做记录、去重与阈值升级，' +
      '下架是人工复核后的动作（理由见 modules/reports/domain 的注释）。',
  })
  create(@CurrentUser() userId: string, @ZodBody(createReportSchema) body: CreateReportBody) {
    return this.service.create(userId, body);
  }

  @Get('mine')
  @ApiOperation({ summary: '我举报过的内容（客户端用来显示「已举报」状态）' })
  listMine(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    const raw = Number(query.limit ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;
    return this.service.listMine(userId, limit);
  }
}
