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
type AssertAssignable<Target, Actual extends Target> = true;
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
}
