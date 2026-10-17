import { Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ForbiddenError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { DormHarmonyService } from './dorm-harmony.service';
import {
  DORM_HARMONY_EXPECTATIONS,
  type SubmitDormHarmonyCaseInput,
} from './domain/dorm-harmony.domain';

/**
 * 宿舍矛盾 HTTP 层（高敏感 · 匿名）。
 *
 * 鉴权策略（本模块与其他模块相反，需要特别说明）：
 *   · 案子读写**全部公开**，只靠一次性**追踪码**授权。这是因为一旦要求登录，
 *     实名身份就会与案件出现在同一个请求里，匿名承诺立刻失效；
 *   · 唯一需要登录的是 `mediator-reply`（调解员是校方工作人员，实名回复是职责）；
 *   · **不提供公开列表**：列表会泄漏全校的议题分布，属隐私事故。
 *
 * 追踪码明文只在 `POST cases` 的响应里出现一次；此后所有读写都必须带上它。
 */

const submitSchema = z.object({
  building: z.string().trim().min(1).max(20),
  topic: z.string().trim().min(1).max(40),
  detail: z.string().max(2000).nullish(),
  expectation: z.enum(DORM_HARMONY_EXPECTATIONS).nullish(),
});

const detailQuerySchema = z.object({
  trackCode: z.string().trim().min(1).max(64).optional(),
});

const messageSchema = z.object({
  trackCode: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(2000),
});

const closeSchema = z.object({
  trackCode: z.string().trim().min(1).max(64),
});

const mediatorReplySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

type SubmitBody = z.infer<typeof submitSchema>;
type DetailQuery = z.infer<typeof detailQuerySchema>;
type MessageBody = z.infer<typeof messageSchema>;
type CloseBody = z.infer<typeof closeSchema>;
type MediatorReplyBody = z.infer<typeof mediatorReplySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, __Actual extends Target> = true;
export type SubmitSchemaMatchesDomain = AssertAssignable<SubmitDormHarmonyCaseInput, SubmitBody>;

@ApiTags('dorm-harmony · 宿舍矛盾（高敏感 · 匿名）')
@Controller(modulePath('dorm-harmony'))
export class DormHarmonyController {
  constructor(@Inject(DormHarmonyService) private readonly service: DormHarmonyService) {}

  /* -------- 二次同意（实名入口，与匿名案子分离） -------- */

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

  /* -------- 匿名案子（追踪码即能力） -------- */

  @Get('cases')
  @ApiOperation({
    summary: '【不提供】公开列表',
    description:
      '出于隐私考虑，本模块不提供公开的调解议题列表（列表会泄漏全校议题分布）。请通过提交时返回的追踪码访问自己的案子。',
  })
  list(): never {
    throw new ForbiddenError(
      '宿舍矛盾议题涉及高度隐私，平台不提供公开列表；请通过提交时返回的追踪码访问你自己的案子',
    );
  }

  @Post('cases')
  @ApiOperation({
    summary: '提交匿名调解申请（公开，无需登录）',
    description: '返回 `{ case, trackCode }`。`trackCode` 仅返回一次，请务必自行保存。',
  })
  submit(@ZodBody(submitSchema) body: SubmitBody) {
    return this.service.submit(body);
  }

  @Get('cases/:id')
  @ApiOperation({ summary: '查看调解申请详情 + 留言（需出示追踪码）' })
  detail(@Param('id') id: string, @ZodQuery(detailQuerySchema) query: DetailQuery) {
    return this.service.detail(id, query.trackCode);
  }

  @Post('cases/:id/messages')
  @ApiOperation({ summary: '学生追加留言（需出示追踪码）' })
  postMessage(@Param('id') id: string, @ZodBody(messageSchema) body: MessageBody) {
    return this.service.postMessage(id, body.trackCode, body.body);
  }

  @Post('cases/:id/close')
  @ApiOperation({ summary: '学生自己结案（需出示追踪码）' })
  close(@Param('id') id: string, @ZodBody(closeSchema) body: CloseBody) {
    return this.service.closeCase(id, body.trackCode);
  }

  @Post('cases/:id/mediator-reply')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '调解员回复（需要登录；唯一实名入口）' })
  mediatorReply(
    @CurrentUser() mediatorId: string,
    @Param('id') id: string,
    @ZodBody(mediatorReplySchema) body: MediatorReplyBody,
  ) {
    return this.service.mediatorReply(id, body.body, mediatorId);
  }
}
