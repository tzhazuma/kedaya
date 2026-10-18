/**
 * 营养管家园 · 个人每日需求的 Prisma 实现
 *
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 一人一份（userId 唯一），写入用 upsert。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { NutritionTarget as NutritionTargetRow } from '@prisma/client';
import type { ActivityLevel, NutritionGoal, Sex } from '@kedaya/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  NutritionTargetModel,
  NutritionTargetRepository,
  UpsertTargetInput,
} from '../domain/nutrition-target.domain';

/** 数据库里身体档案是 string，读出来收敛成领域枚举（非法值当没填） */
const SEXES: readonly Sex[] = ['male', 'female'];
const ACTIVITIES: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'high'];
const GOALS: readonly NutritionGoal[] = ['lose', 'maintain', 'gain'];

function toSex(value: string | null): Sex | null {
  return value !== null && (SEXES as readonly string[]).includes(value) ? (value as Sex) : null;
}

function toActivity(value: string | null): ActivityLevel | null {
  return value !== null && (ACTIVITIES as readonly string[]).includes(value) ? (value as ActivityLevel) : null;
}

function toGoal(value: string | null): NutritionGoal | null {
  return value !== null && (GOALS as readonly string[]).includes(value) ? (value as NutritionGoal) : null;
}

@Injectable()
export class NutritionTargetPrismaRepository implements NutritionTargetRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getByUser(userId: string): Promise<NutritionTargetModel | null> {
    const row = await this.prisma.nutritionTarget.findUnique({ where: { userId } });
    return row ? this.toModel(row) : null;
  }

  async upsert(userId: string, input: UpsertTargetInput): Promise<NutritionTargetModel> {
    const row = await this.prisma.nutritionTarget.upsert({
      where: { userId },
      create: { userId, ...input },
      update: { ...input },
    });
    return this.toModel(row);
  }

  private toModel(row: NutritionTargetRow): NutritionTargetModel {
    return {
      id: row.id,
      userId: row.userId,
      caloriesKcal: row.caloriesKcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbG: row.carbG,
      fiberG: row.fiberG,
      sodiumMg: row.sodiumMg,
      sex: toSex(row.sex),
      age: row.age,
      heightCm: row.heightCm,
      weightKg: row.weightKg,
      activity: toActivity(row.activity),
      goal: toGoal(row.goal),
      avoidAllergens: row.avoidAllergens ?? [],
      updatedAt: row.updatedAt,
    };
  }
}
