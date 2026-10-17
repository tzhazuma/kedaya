/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { WildlifeSpotService } from './wildlife.service';
import type { CreateWildlifeSpotInput, UpdateWildlifeSpotInput } from './domain/wildlife.domain';

const createSchema = z.object({
  species: z.string().min(1).max(500),
  place: z.string().min(1).max(500),
  lat: z.number(),
  lng: z.number(),
  note: z.string().max(500).nullish(),
  reportedBy: z.string().max(500).nullish(),
  status: z.string().min(1).max(500).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 列表查询参数（白名单）。
 *
 * 为什么只有 `species` 一个筛选维度：本模块的 `status` 在 domain / create 里都是
 * **自由字符串**（Prisma 默认 `active`，`confirm` 写 `confirmed`，但没有任何地方
 * 声明它只能取这两个值）。给一个没有白名单的字段做筛选，等于把「合法取值」这一
 * 判断偷偷搬到 controller 里 —— 所以这里**不编造状态白名单**，只做物种模糊匹配。
 * 等 status 在 domain 里被收紧成 enum 时，再加一个 `z.enum(...)` 即可。
 */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** 物种模糊匹配（data 层翻译成 `contains` + `mode: 'insensitive'`） */
  species: z.string().trim().min(1).max(500).optional(),
});

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateWildlifeSpotInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateWildlifeSpotInput, z.infer<typeof updateSchema>>;

type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('wildlife · 猫鸟黑天鹅')
@Controller(modulePath('wildlife'))
@UseGuards(OptionalAuthGuard)
export class WildlifeController {
  constructor(@Inject(WildlifeSpotService) private readonly service: WildlifeSpotService) {}

  @Get('items')
  @ApiOperation({
    summary: '观察点列表（游标分页 + 物种模糊筛选，最新在前）',
    description:
      '公开可读，未登录也能看。`species` 为包含匹配（大小写不敏感）。' +
      '排序固定「最新上报在前」，游标翻页由 id 兜底保证不漏读。',
  })
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.service.list({
      limit: normalizeLimit(query.limit),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      /**
       * 筛选值在 service / data 之间只以「白名单标量字典」传递：
       * service 原样透传，data 层显式列字段翻译成 Prisma `where`
       * （见 `PrismaCursorRepository.buildWhere`）。controller 不拼 where。
       */
      filters: { ...(query.species === undefined ? {} : { species: query.species }) },
    });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateWildlifeSpotInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateWildlifeSpotInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/confirm')
  @ApiOperation({ summary: '领域动作：确认为有效活动点（把状态改为 confirmed，不是计数）' })
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }
}
