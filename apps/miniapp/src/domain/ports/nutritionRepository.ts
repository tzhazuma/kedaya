import type { DishRecommendation, NutritionGaps, NutritionTotals, Result } from '@kedaya/shared'

import type {
  CanteenDish,
  CreateDishInput,
  DishCategory,
  MealRecord,
  MealTrend,
  NutritionTargetProfile,
  RecognizeCandidate,
  RecordMealInput,
  SaveTargetInput,
  UpdateMealInput,
} from '../models/nutrition'
import type { NutritionTarget } from '../models/nutrition'
import type { RepositoryError } from './errors'

/**
 * 营养管家园仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 */

/** 菜品检索查询（游标分页，契约 §6.1 不用 offset） */
export interface DishSearchQuery {
  q?: string
  category?: DishCategory
  cursor?: string | null
  limit?: number
}

export interface DishPage {
  items: CanteenDish[]
  nextCursor: string | null
}

/** 拍照识别结果 */
export interface RecognizeResult {
  mode: RecognizeCandidate['mode']
  candidates: RecognizeCandidate[]
}

/** 首页聚合（一次往返拿全；没设置需求时 target 为 null，不报错） */
export interface NutritionDashboard {
  date: string
  target: NutritionTarget | null
  consumed: NutritionTotals
  gaps: NutritionGaps | null
  recommendations: DishRecommendation[]
  meals: MealRecord[]
}

export interface NutritionRepository {
  /** 今日营养汇总（项目时区切天） */
  today(): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>>
  /** 首页聚合：今日 + 需求 + 缺口 + 推荐 */
  dashboard(): Promise<Result<NutritionDashboard, RepositoryError>>
  /** 某一天的餐记录（默认今天；YYYY-MM-DD） */
  mealsByDate(date: string): Promise<Result<{ date: string; meals: MealRecord[] }, RepositoryError>>
  /** 记录当餐（拍照确认 / 菜名点选共用） */
  recordMeal(input: RecordMealInput): Promise<Result<MealRecord, RepositoryError>>
  /** 修改当餐：餐型 / 备注 / 份数 */
  updateMeal(id: string, input: UpdateMealInput): Promise<Result<MealRecord, RepositoryError>>
  /** 删除当餐（只能删自己的） */
  deleteMeal(id: string): Promise<Result<{ id: string; deleted: true }, RepositoryError>>
  /** 近 N 日趋势 + 连续记录天数 */
  trend(days?: number): Promise<Result<MealTrend, RepositoryError>>
  /** 菜品检索（名称模糊 + 品类过滤 + 游标分页） */
  listDishes(query?: DishSearchQuery): Promise<Result<DishPage, RepositoryError>>
  /** 录入菜品（演示 / 后台共用同一形状） */
  createDish(input: CreateDishInput): Promise<Result<CanteenDish, RepositoryError>>
  /** 我的每日需求（含身体档案；未设置过为 null） */
  getTarget(): Promise<Result<NutritionTargetProfile | null, RepositoryError>>
  /** 设置/更新每日需求（六项 + 可选身体档案） */
  saveTarget(input: SaveTargetInput): Promise<Result<NutritionTargetProfile, RepositoryError>>
  /** 拍照识别候选（演示期 mock） */
  recognize(imageUrl: string): Promise<Result<RecognizeResult, RepositoryError>>
  /** 今日缺口 + 推荐菜品 */
  recommendations(): Promise<
    Result<
      {
        target: NutritionTarget
        consumed: NutritionTarget
        gaps: NutritionGaps
        recommendations: DishRecommendation[]
      },
      RepositoryError
    >
  >
}
