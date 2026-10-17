/**
 * 营养管家园 · 个人每日营养需求（ADR 0006）
 *
 * **需求由使用者自行提出**（估算器只负责预填）：一人一份，`userId` 唯一。
 * 字段语义继承 shared 的 NutritionTarget：protein/fat/carb/fiber 为目标值，
 * sodiumMg 为上限值。
 *
 * 同时保存估算器所需的**身体档案**（可空）：否则用户每次重新估算都要
 * 重填性别 / 年龄 / 身高 / 体重，体重变化后也无法一键更新目标。
 */
import type { ActivityLevel, NutritionGoal, NutritionTarget, Sex } from '@kedaya/shared';

/** 估算器的身体档案（全部可空 = 用户没填过） */
export interface BodyProfile {
  sex: Sex | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activity: ActivityLevel | null;
  goal: NutritionGoal | null;
}

export interface NutritionTargetModel extends NutritionTarget, BodyProfile {
  id: string;
  userId: string;
  /** 忌口 / 过敏原（机器值，见 shared 的 ALLERGENS）；推荐阶段硬过滤 */
  avoidAllergens: string[];
  updatedAt: Date;
}

/** 写入输入：六项营养必填；身体档案可选（估算器预填后一起存下来） */
export interface UpsertTargetInput extends NutritionTarget {
  sex?: Sex;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  activity?: ActivityLevel;
  goal?: NutritionGoal;
  /** 忌口 / 过敏原（可选；传空数组表示清空） */
  avoidAllergens?: string[];
}

/** 端口：service 只依赖本类型，实现见 data/nutrition-target.prisma-repository.ts */
export interface NutritionTargetRepository {
  getByUser(userId: string): Promise<NutritionTargetModel | null>;
  upsert(userId: string, input: UpsertTargetInput): Promise<NutritionTargetModel>;
}

export const NUTRITION_TARGET_REPOSITORY = Symbol('KEDAYA_NUTRITION_TARGET_REPOSITORY');
