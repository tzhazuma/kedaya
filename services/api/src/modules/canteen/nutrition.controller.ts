/**
 * 营养管家园 · API（ADR 0006）
 *
 * 路由挂在 canteen 模块下（modulePath('canteen')），与菜品 CRUD 同域：
 *   GET    /targets            我的每日需求（含身体档案，未设置为 null）
 *   PUT    /targets            设置/更新每日需求
 *   POST   /targets/estimate   估算器预填（纯计算，不落库）
 *   GET    /dashboard          今日汇总 + 需求 + 缺口 + 推荐（首页一次拿全）
 *   GET    /today              今日营养汇总
 *   GET    /meals?date=        某一天餐记录
 *   POST   /meals              记录当餐（支持 Idempotency-Key / clientRequestId）
 *   PATCH  /meals/:id          改餐型 / 备注 / 份数
 *   DELETE /meals/:id          删除（记错了要能撤回）
 *   GET    /stats?days=7       近 N 日趋势 + 连续记录天数
 *   POST   /recognize          拍照识别候选（演示期 mock）
 *   GET    /recommendations    缺口 + 推荐菜品
 *
 * 全部端点面向**登录用户本人**（AuthGuard 必需，不用 Optional）：
 * 餐记录与每日需求都是个人数据。
 */
import {
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { ALLERGENS } from '@kedaya/shared';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { MealService } from './meal.service';
import { NutritionService } from './nutrition.service';
import type { RecordMealInput, UpdateMealInput } from './domain/meal.domain';
import type { UpsertTargetInput } from './domain/nutrition-target.domain';
import type { EstimateTargetsInput } from '@kedaya/shared';

/* ----------------------------------  schema  ---------------------------------- */

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const targetSchema = z.object({
  caloriesKcal: int(1, 10000),
  proteinG: int(0, 2000),
  fatG: int(0, 2000),
  carbG: int(0, 2000),
  fiberG: int(0, 500),
  sodiumMg: int(0, 50000),
  // 身体档案（可选）：随需求一起保存，下次重估不用重填
  sex: z.enum(['male', 'female']).optional(),
  age: int(10, 100).optional(),
  heightCm: int(100, 250).optional(),
  weightKg: int(20, 300).optional(),
  activity: z.enum(['sedentary', 'light', 'moderate', 'high']).optional(),
  goal: z.enum(['lose', 'maintain', 'gain']).optional(),
  // 忌口/过敏原（可选）：推荐阶段硬过滤
  avoidAllergens: z.array(z.enum(ALLERGENS)).max(20).optional(),
});

const estimateSchema = z.object({
  sex: z.enum(['male', 'female']),
  age: int(10, 100),
  heightCm: int(100, 250),
  weightKg: int(20, 300),
  activity: z.enum(['sedentary', 'light', 'moderate', 'high']),
  goal: z.enum(['lose', 'maintain', 'gain']),
});

/** 份数：0.5 步进（食堂的「半份」是常态） */
const servingsSchema = z
  .number()
  .positive()
  .max(20)
  .refine((value) => Math.abs(value * 2 - Math.round(value * 2)) < 1e-9, {
    message: '份数必须是 0.5 的整数倍（如 0.5 / 1 / 1.5）',
  });

const mealSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  source: z.enum(['manual', 'photo']),
  eatenAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  /** 客户端幂等键：弱网重试 / 双击只落一条（也可用 Idempotency-Key 头） */
  clientRequestId: z.string().min(1).max(64).optional(),
  items: z
    .array(
      z.object({
        dishId: z.string().min(1).max(64).optional(),
        dishName: z.string().min(1).max(200),
        servings: servingsSchema.optional(),
      }),
    )
    .min(1)
    .max(30),
});

const updateMealSchema = z
  .object({
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    note: z.string().max(500).nullable().optional(),
    servings: z.array(servingsSchema).min(1).max(30).optional(),
  })
  .refine((value) => value.mealType !== undefined || value.note !== undefined || value.servings !== undefined, {
    message: '至少要修改一项（mealType / note / servings）',
  });

const recognizeSchema = z.object({
  imageUrl: z.string().min(1).max(2000),
});

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type TargetSchemaMatchesDomain = AssertAssignable<UpsertTargetInput, z.infer<typeof targetSchema>>;
export type EstimateSchemaMatchesDomain = AssertAssignable<EstimateTargetsInput, z.infer<typeof estimateSchema>>;
export type MealSchemaMatchesDomain = AssertAssignable<
  RecordMealInput,
  Omit<z.infer<typeof mealSchema>, 'eatenAt'> & { eatenAt?: Date }
>;
export type UpdateMealSchemaMatchesDomain = AssertAssignable<UpdateMealInput, z.infer<typeof updateMealSchema>>;

/* ----------------------------------  路由  ---------------------------------- */

@ApiTags('canteen · 营养管家')
@Controller(modulePath('canteen'))
@UseGuards(AuthGuard)
export class NutritionController {
  constructor(
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(MealService) private readonly meals: MealService,
  ) {}

  @Get('targets')
  @ApiOperation({ summary: '我的每日营养需求（未设置为 null）' })
  getTarget(@CurrentUser() userId: string) {
    return this.nutrition.getTarget(userId);
  }

  @Put('targets')
  @ApiOperation({ summary: '设置/更新每日营养需求（一人一份；可同时保存身体档案）' })
  upsertTarget(@CurrentUser() userId: string, @ZodBody(targetSchema) body: UpsertTargetInput) {
    return this.nutrition.upsertTarget(userId, body);
  }

  @Post('targets/estimate')
  @ApiOperation({ summary: '估算器：按身体数据预填每日需求（不落库）' })
  estimate(@ZodBody(estimateSchema) body: EstimateTargetsInput) {
    return this.nutrition.estimate(body);
  }

  @Get('dashboard')
  @ApiOperation({ summary: '首页聚合：今日汇总 + 需求 + 缺口 + 推荐（一次往返）' })
  dashboard(@CurrentUser() userId: string) {
    return this.nutrition.dashboard(userId);
  }

  @Get('today')
  @ApiOperation({ summary: '今日营养汇总（项目时区切天）' })
  today(@CurrentUser() userId: string) {
    return this.meals.today(userId);
  }

  @Get('meals')
  @ApiOperation({ summary: '某一天餐记录（默认今天，?date=YYYY-MM-DD）' })
  listMeals(@CurrentUser() userId: string, @Query('date') date?: string) {
    return this.meals.list(userId, date);
  }

  @Post('meals')
  @ApiOperation({ summary: '记录当餐（营养从菜品库快照；支持幂等键防重复提交）' })
  recordMeal(
    @CurrentUser() userId: string,
    @ZodBody(mealSchema) body: RecordMealInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.meals.record(userId, {
      ...body,
      // 请求头优先：契约 §A6 的通用约定，客户端不必再塞进 body
      clientRequestId: idempotencyKey?.trim() || body.clientRequestId,
      eatenAt: body.eatenAt ? new Date(body.eatenAt) : undefined,
    });
  }

  @Patch('meals/:id')
  @ApiOperation({ summary: '修改当餐：餐型 / 备注 / 份数（换菜请删除重记）' })
  updateMeal(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(updateMealSchema) body: UpdateMealInput,
  ) {
    return this.meals.update(userId, id, body);
  }

  @Delete('meals/:id')
  @ApiOperation({ summary: '删除当餐（只能删自己的）' })
  removeMeal(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.meals.remove(userId, id);
  }

  @Get('stats')
  @ApiOperation({ summary: '近 N 日趋势（默认 7 天，含今天）+ 连续记录天数' })
  stats(@CurrentUser() userId: string, @Query('days') days?: string) {
    const parsed = days === undefined ? undefined : Number(days);
    return this.meals.stats(userId, Number.isFinite(parsed) ? parsed : undefined);
  }

  @Post('recognize')
  @ApiOperation({ summary: '拍照识别候选菜品（演示期为 mock，界面须明示）' })
  recognize(@ZodBody(recognizeSchema) body: { imageUrl: string }) {
    return this.meals.recognize(body.imageUrl);
  }

  @Get('recommendations')
  @ApiOperation({ summary: '今日缺口 + 推荐菜品（未设置需求时返回 400 引导设置）' })
  recommendations(@CurrentUser() userId: string) {
    return this.nutrition.recommendations(userId);
  }
}
