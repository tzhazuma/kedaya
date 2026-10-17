/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 *
 * 装配（ADR 0006）：菜品 CRUD（`CanteenController`，写操作需 AdminGuard）
 * 与营养管家业务（`NutritionController`，全部要求登录）同域，共用同一个
 * `CanteenDishService` —— 营养值为推荐结论的地基，不允许出现第二份菜品读取实现。
 */
import { Module } from '@nestjs/common';
import { CanteenController } from './canteen.controller';
import { CanteenDishService } from './canteen.service';
import { MealService } from './meal.service';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import { CanteenDishPrismaRepository } from './data/canteen.repository';
import { MealRecordPrismaRepository } from './data/meal.prisma-repository';
import { MockDishRecognitionAdapter } from './data/mock-dish-recognition.adapter';
import { NutritionTargetPrismaRepository } from './data/nutrition-target.prisma-repository';
import { CANTEEN_DISH_REPOSITORY } from './domain/canteen.domain';
import { MEAL_RECORD_REPOSITORY } from './domain/meal.domain';
import { NUTRITION_TARGET_REPOSITORY } from './domain/nutrition-target.domain';
import { DISH_RECOGNITION } from './domain/recognition.domain';

@Module({
  controllers: [CanteenController, NutritionController],
  providers: [
    CanteenDishService,
    MealService,
    NutritionService,
    { provide: CANTEEN_DISH_REPOSITORY, useClass: CanteenDishPrismaRepository },
    { provide: MEAL_RECORD_REPOSITORY, useClass: MealRecordPrismaRepository },
    { provide: NUTRITION_TARGET_REPOSITORY, useClass: NutritionTargetPrismaRepository },
    // 演示期用确定性 mock 适配器；接真实视觉 API 时只换这一行的 useClass（端口不变）
    { provide: DISH_RECOGNITION, useClass: MockDishRecognitionAdapter },
  ],
  exports: [CanteenDishService, MealService, NutritionService],
})
export class CanteenModule {}
