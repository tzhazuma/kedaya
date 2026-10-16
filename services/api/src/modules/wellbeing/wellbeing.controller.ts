import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { WellbeingService } from './wellbeing.service';
import type {
  UpdateWellbeingAppointmentInput,
  WellbeingAppointmentDraft,
} from './domain/wellbeing.domain';

const createSchema = z.object({
  counselor: z.string().min(1).max(120),
  slotAt: z.coerce.date(),
  mode: z.enum(['online', 'onsite']).optional(),
  // 最小化采集：只收用户主动填写的摘要，且限制长度
  note: z.string().max(1000).nullish(),
});

const updateSchema = createSchema.partial().extend({
  status: z.string().min(1).max(40).optional(),
  crisisFlag: z.boolean().optional(),
});

type AssertAssignable<Target, Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<
  WellbeingAppointmentDraft,
  z.infer<typeof createSchema>
>;

@ApiTags('wellbeing · 心理治疗（最高敏感）')
@Controller(modulePath('wellbeing'))
export class WellbeingController {
  constructor(@Inject(WellbeingService) private readonly service: WellbeingService) {}

  @Get('crisis-line')
  @ApiOperation({
    summary: '危机干预热线（公开：无需登录、无需同意，前端必须首屏可见）',
    description: '契约 §9：不可被埋进二级菜单。返回 prominence=primary 供前端强制渲染。',
  })
  crisisLine() {
    return this.service.crisisLine();
  }

  @Get('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的心理模块同意记录' })
  listConsents(@CurrentUser() userId: string) {
    return this.service.listConsents(userId);
  }

  @Post('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '二次同意（契约 §9：敏感模块独立同意）' })
  grantConsent(@CurrentUser() userId: string) {
    return this.service.grantConsent(userId);
  }

  @Delete('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤回同意（契约 §9：可随时撤回）' })
  revokeConsent(@CurrentUser() userId: string) {
    return this.service.revokeConsent(userId);
  }

  @Get('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的预约列表（无同意 → CONSENT_REQUIRED；写审计）',
  })
  list(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.list(userId, {
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建预约（无同意 → CONSENT_REQUIRED；写审计）' })
  create(
    @CurrentUser() userId: string,
    @ZodBody(createSchema) body: z.infer<typeof createSchema>,
  ) {
    return this.service.create(userId, body);
  }

  @Get('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '预约详情（仅本人可见；写审计）' })
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.detail(userId, id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新预约（写审计）' })
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateWellbeingAppointmentInput,
  ) {
    return this.service.update(userId, id, body);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除预约（写审计）' })
  async remove(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.service.remove(userId, id);
    return { id, deleted: true };
  }

  @Post('items/:id/crisis')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '触发危机干预：标记 + 一并返回热线（契约 §9）' })
  escalateCrisis(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.escalateCrisis(userId, id);
  }
}
