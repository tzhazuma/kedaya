import { Controller, Delete, Get, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { AiPortraitService } from './ai-portrait.service';

const upsertSchema = z.object({
  /** 画像的数据来源（模块 id）。含 wellbeing / dorm-harmony 会被 FORBIDDEN 拒绝 */
  sources: z.array(z.string().min(1).max(64)).min(1).max(20),
  traits: z.record(z.string(), z.unknown()),
  explain: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

const toggleSchema = z.object({ enabled: z.boolean() });

@ApiTags('ai-portrait · AI 校园画像（高敏感）')
@Controller(modulePath('ai-portrait'))
export class AiPortraitController {
  constructor(@Inject(AiPortraitService) private readonly service: AiPortraitService) {}

  @Get('sources')
  @ApiOperation({
    summary: '公开：画像允许/禁止的数据来源（契约 §9 数据最小化，可解释性）',
  })
  sources() {
    return this.service.sources();
  }

  @Get('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的画像模块同意记录' })
  listConsents(@CurrentUser() userId: string) {
    return this.service.listConsents(userId);
  }

  @Post('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '二次同意' })
  grantConsent(@CurrentUser() userId: string) {
    return this.service.grantConsent(userId);
  }

  @Delete('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤回同意' })
  revokeConsent(@CurrentUser() userId: string) {
    return this.service.revokeConsent(userId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的画像（无同意 → CONSENT_REQUIRED；写审计）' })
  me(@CurrentUser() userId: string) {
    return this.service.me(userId);
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '写入画像（来源含 wellbeing/dorm-harmony 时返回 FORBIDDEN）',
    description: '契约 §9：心理与宿舍矛盾数据不得进入通用画像。',
  })
  upsert(@CurrentUser() userId: string, @ZodBody(upsertSchema) body: z.infer<typeof upsertSchema>) {
    return this.service.upsert(userId, body);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '开启/关闭画像（契约 §9：可关闭）' })
  toggle(@CurrentUser() userId: string, @ZodBody(toggleSchema) body: z.infer<typeof toggleSchema>) {
    return this.service.setEnabled(userId, body.enabled);
  }
}
