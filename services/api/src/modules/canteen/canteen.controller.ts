/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { normalizeLimit } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { CanteenDishService } from './canteen.service';
import type {
  CanteenDishListFilters,
  CreateCanteenDishInput,
  UpdateCanteenDishInput,
} from './domain/canteen.domain';

/**
 * 边界与小程序端 `apps/miniapp/src/domain/models/canteen.ts` 的常量**同值**。
 *
 * 两端不一致的后果很隐蔽：客户端校验通过、服务端照单全收，于是「热量 -500」
 * 「名称 500 字的广告」这类垃圾会静默进库（客户端拦住的正规用户毫无察觉）。
 */
const createSchema = z.object({
  canteen: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  caloriesKcal: z.number().int().min(0).max(5000),
  proteinG: z.number().int().min(0).max(1000),
  fatG: z.number().int().min(0).max(1000),
  carbG: z.number().int().min(0).max(1000),
  priceFen: z.number().int().min(0).max(100_000),
});

const updateSchema = createSchema.partial();

/**
 * 列表查询参数（Zod 白名单）。
 *
 * 与 `@Query()` 直接吞任意键不同，这里只放行已知的两个筛选维度：
 *   · `canteen` —— 食堂名，**精确**匹配（列表页 chip 只产出白名单值）；
 *   · `q` —— 菜名关键词，**模糊**匹配（`contains` + `mode: 'insensitive'`）。
 * 其余字段一律被 `z.object` 剥掉，不会流到 data 层。
 */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  canteen: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateCanteenDishInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateCanteenDishInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('canteen · 食堂营养')
@Controller(modulePath('canteen'))
@UseGuards(OptionalAuthGuard)
export class CanteenController {
  constructor(@Inject(CanteenDishService) private readonly service: CanteenDishService) {}

  @Get('items')
  @ApiOperation({
    summary: '列表（游标分页 + 食堂精确 / 菜名模糊筛选，契约 §6.1 不用 offset）',
    description: '公开可读。筛选与排序都在数据库完成，最新在前。',
  })
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    // 只把白名单内的键放进 filters；data 层再用同样的字段名翻成 Prisma `where`
    const filters: CanteenDishListFilters = {
      ...(query.canteen === undefined ? {} : { canteen: query.canteen }),
      ...(query.q === undefined ? {} : { q: query.q }),
    };

    return this.service.list({
      limit: normalizeLimit(query.limit),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(Object.keys(filters).length === 0 ? {} : { filters }),
    });
  }

  @Post('items')
  @ApiOperation({ summary: '创建' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateCanteenDishInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateCanteenDishInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Get('calories')
  @ApiOperation({ summary: '按食堂汇总热量与均价（整数分）' })
  calories(@Query('canteen') canteen: string) {
    if (!canteen) throw new ValidationError('canteen 必填', { canteen });
    return this.service.calories(canteen);
  }
}
