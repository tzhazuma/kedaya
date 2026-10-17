/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { MealService } from './meal.service';
import { NutritionService } from './nutrition.service';
import { MockDishRecognitionAdapter } from './data/mock-dish-recognition.adapter';
import { MealRecordPrismaRepository } from './data/meal.prisma-repository';
import { NutritionTargetPrismaRepository } from './data/nutrition-target.prisma-repository';
import { DISH_RECOGNITION } from './domain/recognition.domain';
import { MEAL_RECORD_REPOSITORY } from './domain/meal.domain';
import { NUTRITION_TARGET_REPOSITORY } from './domain/nutrition-target.domain';
import { CanteenController } from './canteen.controller';
import { CanteenDishService } from './canteen.service';
import { CanteenDishPrismaRepository } from './data/canteen.repository';
import { CANTEEN_DISH_REPOSITORY } from './domain/canteen.domain';

@Module({
  controllers: [CanteenController, NutritionController],
  providers: [CanteenDishService, { provide: CANTEEN_DISH_REPOSITORY, useClass: CanteenDishPrismaRepository },
    MealService,
    NutritionService,
    { provide: DISH_RECOGNITION, useClass: MockDishRecognitionAdapter },
    { provide: MEAL_RECORD_REPOSITORY, useClass: MealRecordPrismaRepository },
    { provide: NUTRITION_TARGET_REPOSITORY, useClass: NutritionTargetPrismaRepository }],
  exports: [CanteenDishService, MealService, NutritionService],
})
export class CanteenModule {}
