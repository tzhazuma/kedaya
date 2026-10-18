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
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const createSchema = z.object({
  canteen: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  /** 菜的种类（机器值）；缺省时由 shared 的 validateDishInput 兜底为「其他」 */
  category: z.string().min(1).max(40).optional(),
  servingG: int(1, 5000).optional(),
  caloriesKcal: int(0, 5000),
  proteinG: int(0, 1000),
  fatG: int(0, 1000),
  carbG: int(0, 1000),
  fiberG: int(0, 200).optional(),
  sodiumMg: int(0, 20000).optional(),
  priceFen: int(0, 100_000),
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
 * 列表查询参数（Zod 白名单）。
 *
 * 与 `@Query()` 直接吞任意键不同，这里只放行已知的三个筛选维度：
 *   · `canteen`  —— 食堂名，**精确**匹配（列表页 chip 只产出白名单值）；
 *   · `q`        —— 菜名关键词，**模糊**匹配（`contains` + `mode: 'insensitive'`）；
 *   · `category` —— 菜的种类，**精确**匹配（营养管家菜品选择器的品类 chip）。
 * 其余字段一律被 `z.object` 剥掉，不会流到 data 层。
 */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  canteen: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().min(1).max(40).optional(),
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
@ApiTags('canteen · 营养管家 · 菜品库')
@Controller(modulePath('canteen'))
@UseGuards(OptionalAuthGuard)
export class CanteenController {
  constructor(@Inject(CanteenDishService) private readonly service: CanteenDishService) {}

  @Get('items')
  @ApiOperation({
    summary: '列表（游标分页 + 食堂/品类精确、菜名模糊筛选，契约 §6.1 不用 offset；已下架的不返回）',
    description: '公开可读。筛选与排序都在数据库完成，最新在前。',
  })
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    // 只把白名单内的键放进 filters；data 层再用同样的字段名翻成 Prisma `where`
    const filters: CanteenDishListFilters = {
      ...(query.canteen === undefined ? {} : { canteen: query.canteen }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.category === undefined ? {} : { category: query.category }),
    };

    return this.service.list({
      limit: normalizeLimit(query.limit),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(Object.keys(filters).length === 0 ? {} : { filters }),
    });
  }

  @Post('items')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '创建（**管理员**）：营养数据是推荐结论的依据，不接受匿名写入' })
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
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新（**管理员**）：只影响之后的记录，历史快照不变' })
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
  async remove(
    @OptionalCurrentUser() actorId: string | undefined,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
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
  dishes(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.service.searchDishes({
      limit: normalizeLimit(query.limit),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.canteen === undefined ? {} : { canteen: query.canteen }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
  }
}
