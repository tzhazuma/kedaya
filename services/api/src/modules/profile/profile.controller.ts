/**
 * 我的 · profile（契约 §4）
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
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ProfileSettingService } from './profile.service';
import type { CreateProfileSettingInput, UpdateProfileSettingInput } from './domain/profile.domain';

const createSchema = z.object({
  showRealName: z.boolean().optional(),
  allowAiPortrait: z.boolean().optional(),
  allowWellbeing: z.boolean().optional(),
  allowDormHarmony: z.boolean().optional(),
  themeMode: z.string().min(1).max(500).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateProfileSettingInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateProfileSettingInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('profile · 我的')
@Controller(modulePath('profile'))
@UseGuards(OptionalAuthGuard)
export class ProfileController {
  constructor(@Inject(ProfileSettingService) private readonly service: ProfileSettingService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateProfileSettingInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateProfileSettingInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的资料与隐私开关（不存在则按默认值建档）' })
  me(@CurrentUser() userId: string) {
    return this.service.me(userId);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新我的隐私开关（可随时关闭 AI 画像等）' })
  patchMine(@CurrentUser() userId: string, @ZodBody(updateSchema) body: UpdateProfileSettingInput) {
    return this.service.patchMine(userId, body);
  }

  /* ================================================================ *
   * 同意管理 + 数据导出（契约 §9：同意可撤回、数据可携）
   * ================================================================ */

  @Get('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的同意状态（含未授权的同意门模块）',
    description:
      '返回**全部**需要二次同意的模块及当前状态，让用户一眼看到可以开/关什么。' +
      '不回 IP / UA 等内部审计字段。',
  })
  consents(@CurrentUser() userId: string) {
    return this.service.listConsents(userId);
  }

  @Post('consents/:module')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '授权某敏感模块（幂等；非同意门模块返回 VALIDATION_FAILED）' })
  grantConsent(@CurrentUser() userId: string, @Param('module') moduleId: string) {
    return this.service.grantConsent(userId, moduleId);
  }

  @Delete('consents/:module')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '撤回某敏感模块的同意（幂等；撤回后该模块立即不可用）',
    description: '撤回是"立即生效"的：上游模块每次访问都会重新校验同意（契约 §9 硬规则）。',
  })
  revokeConsent(@CurrentUser() userId: string, @Param('module') moduleId: string) {
    return this.service.revokeConsent(userId, moduleId);
  }

  @Get('export')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '导出我的数据（账号档案 + 隐私开关 + 同意记录 + 内容条数）',
    description:
      '契约 §9 数据可携权。范围如实包含在响应 `note` 里：不含他人数据、' +
      '不含匿名帖映射、不含校园卡逐笔明细正文。导出动作本身会写审计。',
  })
  exportData(@CurrentUser() userId: string) {
    return this.service.exportData(userId);
  }
}
