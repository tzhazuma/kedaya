import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { DormHarmonyService } from './dorm-harmony.service';
import type {
  CreateDormHarmonyCaseInput,
  UpdateDormHarmonyCaseInput,
} from './domain/dorm-harmony.domain';

const createSchema = z.object({
  building: z.string().min(1).max(64),
  topic: z.string().min(1).max(200),
  detail: z.string().max(4000).nullish(),
  // 允许客户端自带 handle（例如小程序本地生成），不传则由服务端生成
  anonHandle: z.string().min(1).max(64).optional(),
});

const updateSchema = z.object({
  topic: z.string().min(1).max(200).optional(),
  detail: z.string().max(4000).nullish(),
  status: z.string().min(1).max(40).optional(),
  mediatorId: z.string().min(1).max(64).nullish(),
});

const mediatorSchema = z.object({ mediatorId: z.string().min(1).max(64) });

type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<
  CreateDormHarmonyCaseInput,
  z.infer<typeof createSchema>
>;

@ApiTags('dorm-harmony · 宿舍矛盾（高敏感 · 匿名）')
@Controller(modulePath('dorm-harmony'))
export class DormHarmonyController {
  constructor(@Inject(DormHarmonyService) private readonly service: DormHarmonyService) {}

  @Get('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的宿舍矛盾模块同意记录' })
  listConsents(@CurrentUser() userId: string) {
    return this.service.listConsents(userId);
  }

  @Post('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '二次同意（契约 §9）' })
  grantConsent(@CurrentUser() userId: string) {
    return this.service.grantConsent(userId);
  }

  @Delete('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤回同意（契约 §9）' })
  revokeConsent(@CurrentUser() userId: string) {
    return this.service.revokeConsent(userId);
  }

  @Get('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '调解申请列表（摘要，不含 detail；无同意 → CONSENT_REQUIRED）',
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
  @ApiOperation({ summary: '提交匿名调解申请（存储层与实名解耦）' })
  create(
    @CurrentUser() userId: string,
    @ZodBody(createSchema) body: CreateDormHarmonyCaseInput,
  ) {
    return this.service.create(userId, body);
  }

  @Get('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '申请详情（写审计）' })
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.detail(userId, id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新申请（写审计）' })
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateDormHarmonyCaseInput,
  ) {
    return this.service.update(userId, id, body);
  }

  @Post('items/:id/mediator')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：调解员介入' })
  assignMediator(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(mediatorSchema) body: z.infer<typeof mediatorSchema>,
  ) {
    return this.service.assignMediator(userId, id, body.mediatorId);
  }
}
