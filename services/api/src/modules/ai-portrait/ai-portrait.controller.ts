import { Controller, Delete, Get, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { AiPortraitService } from './ai-portrait.service';

/**
 * AI 校园画像 HTTP 层（契约 §6.1 统一形状 + §9 敏感模块）。
 *
 * 三条贯穿全文件的规矩：
 *
 *   1. **归属只从 JWT 取**。这里的请求体 / 查询参数里**没有** `userId`，
 *      也没有任何画像 id —— 画像永远按主体寻址（`GET /me`）。
 *      所以"看别人的画像"不是一个可寻址的请求，无需在 403 / 404 之间取舍。
 *   2. **未登录由服务层给 401**。守卫统一用 `OptionalAuthGuard` +
 *      `@OptionalCurrentUser()`（与 `takeout-guard` 一致）：`sources` 是公开端点，
 *      其余端点在服务里 `requireActor` 抛 `UNAUTHENTICATED`，错误码与文案同源。
 *   3. **同意门在服务层**（`ConsentService.requireConsent`）：没有有效同意时
 *      `me` / `items` / `me(PATCH)` 一律返回 `CONSENT_REQUIRED`，
 *      客户端因此不可能"先看到画像再补同意"。
 */

const upsertSchema = z.object({
  /** 画像的数据来源（模块 id）。含 wellbeing / dorm-harmony 会被 FORBIDDEN 拒绝 */
  sources: z.array(z.string().min(1).max(64)).min(1).max(20),
  traits: z.record(z.string(), z.unknown()),
  explain: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

const toggleSchema = z.object({ enabled: z.boolean() });

type UpsertBody = z.infer<typeof upsertSchema>;
type ToggleBody = z.infer<typeof toggleSchema>;

/**
 * 编译期防漂移断言：请求体里**没有** `userId`。
 *
 * `HasNoUserId` 在出现 `userId` 时会变成 `never`（下面两个导出类型随之变化），
 * 提醒 review 者"归属只从 JWT 取"这条规矩不能被悄悄改掉；
 * 服务层还会用登录主体覆盖一切，见 `ai-portrait.service.spec.ts` 的归属用例。
 */
type HasNoUserId<T> = 'userId' extends keyof T ? never : true;
export type UpsertBodyHasNoUserId = HasNoUserId<UpsertBody>;
export type ToggleBodyHasNoUserId = HasNoUserId<ToggleBody>;

@ApiTags('ai-portrait · AI 校园画像（高敏感）')
@Controller(modulePath('ai-portrait'))
@UseGuards(OptionalAuthGuard)
export class AiPortraitController {
  constructor(@Inject(AiPortraitService) private readonly service: AiPortraitService) {}

  @Get('sources')
  @ApiOperation({
    summary: '公开：画像允许/禁止的数据来源与接入现状（契约 §9 数据最小化，可解释性）',
    description:
      '返回白名单、禁读域（wellbeing / dorm-harmony）与**现状**（尚未接入任何数据来源、尚无生成逻辑）。' +
      '客户端据此显示「尚无画像数据」空态，而不是编造标签。',
  })
  sources() {
    return this.service.sources();
  }

  @Get('consents')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的画像模块同意记录（含已撤回的历史条目）',
    description: '只返回 ai-portrait 这一个模块的同意记录；同意门本身由契约决定，不在本模块硬编码。',
  })
  listConsents(@OptionalCurrentUser() actorId: string | undefined) {
    return this.service.listConsents(actorId);
  }

  @Post('consents')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '二次同意（幂等：已同意则刷新授权时间）',
    description: '写入 Consent 表并记审计 ai-portrait.consent.grant；未登录 401。',
  })
  grantConsent(@OptionalCurrentUser() actorId: string | undefined) {
    return this.service.grantConsent(actorId);
  }

  @Delete('consents')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '撤回同意（幂等：重复撤回不报错）',
    description:
      '撤回后 requireConsent 立即开始拒绝读写（CONSENT_REQUIRED）；已有画像行不删除但不可读，' +
      '重新同意后可再次查看。记审计 ai-portrait.consent.revoke。',
  })
  revokeConsent(@OptionalCurrentUser() actorId: string | undefined) {
    return this.service.revokeConsent(actorId);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的画像（无同意 → CONSENT_REQUIRED；写审计）',
    description:
      '按主体寻址：不存在"按 id 看别人画像"的路径。尚未生成画像时返回 null（不是 404），' +
      '客户端据此展示空态。enabled=false 表示用户已关闭，客户端不再展示标签。',
  })
  me(@OptionalCurrentUser() actorId: string | undefined) {
    return this.service.me(actorId);
  }

  @Post('items')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '写入画像（来源含 wellbeing/dorm-harmony 时返回 FORBIDDEN）',
    description:
      '契约 §9：心理与宿舍矛盾数据不得进入通用画像。归属恒为登录主体（请求体里没有 userId）。' +
      '⚠️ 供受信的内部生成流程使用；小程序端只读，不会调用它 —— 客户端不允许编造标签。',
  })
  upsert(@OptionalCurrentUser() actorId: string | undefined, @ZodBody(upsertSchema) body: UpsertBody) {
    return this.service.upsert(actorId, body);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '开启/关闭画像（契约 §9：可关闭）',
    description: '关闭只改 enabled、不删数据；尚无画像行时返回 NOT_FOUND。请求体里只有 enabled。',
  })
  toggle(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(toggleSchema) body: ToggleBody,
  ) {
    return this.service.setEnabled(actorId, body.enabled);
  }
}
