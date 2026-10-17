/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 *
 * 权限边界（2026-10-17 修正）：菜品库是营养管家的**数据地基**，
 * 写操作（POST / PATCH / DELETE）必须是管理员 —— 原先整控制器是
 * `OptionalAuthGuard`，等于任何人都能把「红烧肉」改成 0 kcal 或删空菜品库。
 * 读操作（列表 / 详情 / 检索 / 汇总）保持匿名可用（契约 §9）。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { ALLERGENS } from '@kedaya/shared';
import { z } from 'zod';
import { AdminGuard } from '../../common/auth/admin.guard';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CanteenDishService } from './canteen.service';
import type { CreateCanteenDishInput, UpdateCanteenDishInput } from './domain/canteen.domain';

/** 营养值的合理上界（挡住 999999 kcal 这类明显录错；详细规则在 shared） */
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const createSchema = z.object({
  canteen: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  category: z.string().min(1).max(500).optional(),
  servingG: int(1, 5000).optional(),
  caloriesKcal: int(0, 5000),
  proteinG: int(0, 500),
  fatG: int(0, 500),
  carbG: int(0, 1000),
  fiberG: int(0, 200).optional(),
  sodiumMg: int(0, 20000).optional(),
  priceFen: int(0, 100000),
  /** 营养数据来源与核对时间：让「这个数字凭什么可信」可查（ADR 0006 C2） */
  source: z.string().min(1).max(120).optional(),
  lastVerifiedAt: z
    .string()
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
  /** 过敏原/忌口标签（机器值）；空数组 = 未标注 */
  allergens: z.array(z.enum(ALLERGENS)).max(20).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateCanteenDishInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateCanteenDishInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('canteen · 营养管家 · 菜品库')
@Controller(modulePath('canteen'))
@UseGuards(OptionalAuthGuard)
export class CanteenController {
  constructor(@Inject(CanteenDishService) private readonly service: CanteenDishService) {}

  @Get('items')
  @ApiOperation({ summary: '列表（游标分页，契约 §6.1 不用 offset；已下架的不返回）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('items')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '创建（**管理员**）：营养数据是推荐结论的依据，不接受匿名写入' })
  create(@OptionalCurrentUser() actorId: string | undefined, @ZodBody(createSchema) body: CreateCanteenDishInput) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新（**管理员**）' })
  update(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateCanteenDishInput,
  ) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '下架（**管理员**，软删除：历史餐记录仍可回溯）' })
  async remove(@OptionalCurrentUser() actorId: string | undefined, @Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Get('calories')
  @ApiOperation({ summary: '按食堂汇总热量与均价（整数分）' })
  calories(@Query('canteen') canteen: string) {
    if (!canteen) throw new ValidationError('canteen 必填', { canteen });
    return this.service.calories(canteen);
  }

  @Get('dishes')
  @ApiOperation({ summary: '菜品检索（名称/品类/食堂，营养管家园的菜品选择器）' })
  dishes(@Query() query: Record<string, unknown>) {
    return this.service.searchDishes({
      q: typeof query.q === 'string' ? query.q : undefined,
      category: typeof query.category === 'string' ? query.category : undefined,
      canteen: typeof query.canteen === 'string' ? query.canteen : undefined,
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
    });
  }
}
