import type { CanteenDish, DishCategory } from '../../domain/models/nutrition'
import type { NutritionTarget } from '../../domain/models/nutrition'
import { inferAllergensFromName } from '@kedaya/shared'

/**
 * 营养管家园 Mock 种子数据 —— 「没有后端也能跑通」（契约 §7 硬规则 4）。
 *
 * 设计约束：
 * - 营养值为**每份**口径（与后端 CanteenDish 一致），`servingG` 说明一份多大
 * - 数值参照常见食物成分表量级填写，演示用；真实数据以后台录入为准
 * - 覆盖全部 8 个菜品品类，推荐算法的「品类均衡」因此有戏可看
 * - 演示用户的每日需求：维持体重的成年男生量级（估算器可改）
 */

export const MOCK_NUTRITION_TARGET: NutritionTarget = {
  caloriesKcal: 2200,
  proteinG: 110,
  fatG: 73,
  carbG: 275,
  fiberG: 25,
  sodiumMg: 2000,
}

interface SeedDish {
  id: string
  canteen: string
  name: string
  category: DishCategory
  servingG: number
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
  priceFen: number
}

const SEED: readonly SeedDish[] = [
  // 主食
  { id: 'dish-rice', canteen: '一食堂', name: '米饭', category: 'staple', servingG: 150, caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5, priceFen: 200 },
  { id: 'dish-bun', canteen: '一食堂', name: '肉包', category: 'staple', servingG: 100, caloriesKcal: 230, proteinG: 9, fatG: 9, carbG: 28, fiberG: 1, sodiumMg: 250, priceFen: 200 },
  { id: 'dish-mantou', canteen: '一食堂', name: '馒头', category: 'staple', servingG: 100, caloriesKcal: 220, proteinG: 6, fatG: 1, carbG: 45, fiberG: 2, sodiumMg: 150, priceFen: 100 },
  { id: 'dish-noodle', canteen: '二食堂', name: '红烧牛肉面', category: 'staple', servingG: 500, caloriesKcal: 520, proteinG: 22, fatG: 14, carbG: 74, fiberG: 3, sodiumMg: 1400, priceFen: 1200 },
  { id: 'dish-corn', canteen: '二食堂', name: '蒸玉米', category: 'staple', servingG: 200, caloriesKcal: 110, proteinG: 4, fatG: 2, carbG: 22, fiberG: 3, sodiumMg: 5, priceFen: 300 },
  { id: 'dish-chaomian', canteen: '三食堂', name: '蛋炒饭', category: 'staple', servingG: 300, caloriesKcal: 480, proteinG: 12, fatG: 16, carbG: 70, fiberG: 3, sodiumMg: 900, priceFen: 800 },
  // 荤菜
  { id: 'dish-paigu', canteen: '一食堂', name: '红烧排骨', category: 'meat', servingG: 200, caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900, priceFen: 1400 },
  { id: 'dish-jitui', canteen: '一食堂', name: '香煎鸡腿', category: 'meat', servingG: 180, caloriesKcal: 380, proteinG: 26, fatG: 22, carbG: 2, fiberG: 0, sodiumMg: 500, priceFen: 900 },
  { id: 'dish-tangculiji', canteen: '二食堂', name: '糖醋里脊', category: 'meat', servingG: 200, caloriesKcal: 460, proteinG: 20, fatG: 24, carbG: 40, fiberG: 1, sodiumMg: 700, priceFen: 1200 },
  { id: 'dish-shuizhuyu', canteen: '三食堂', name: '水煮鱼', category: 'meat', servingG: 300, caloriesKcal: 450, proteinG: 30, fatG: 28, carbG: 6, fiberG: 1, sodiumMg: 1000, priceFen: 1600 },
  { id: 'dish-qingjiaoyu', canteen: '三食堂', name: '清蒸鱼', category: 'meat', servingG: 250, caloriesKcal: 220, proteinG: 28, fatG: 9, carbG: 3, fiberG: 0, sodiumMg: 350, priceFen: 1300 },
  // 素菜
  { id: 'dish-fanqiechaodan', canteen: '一食堂', name: '番茄炒蛋', category: 'vegetable', servingG: 200, caloriesKcal: 180, proteinG: 8, fatG: 12, carbG: 6, fiberG: 2, sodiumMg: 300, priceFen: 500 },
  { id: 'dish-bocai', canteen: '一食堂', name: '清炒菠菜', category: 'vegetable', servingG: 200, caloriesKcal: 90, proteinG: 3, fatG: 5, carbG: 4, fiberG: 3, sodiumMg: 200, priceFen: 400 },
  { id: 'dish-mapodoufu', canteen: '二食堂', name: '麻婆豆腐', category: 'vegetable', servingG: 250, caloriesKcal: 210, proteinG: 12, fatG: 14, carbG: 8, fiberG: 2, sodiumMg: 800, priceFen: 600 },
  { id: 'dish-shala', canteen: '二食堂', name: '蔬菜沙拉', category: 'vegetable', servingG: 200, caloriesKcal: 120, proteinG: 3, fatG: 8, carbG: 8, fiberG: 4, sodiumMg: 180, priceFen: 700 },
  // 汤
  { id: 'dish-zicaidantang', canteen: '一食堂', name: '紫菜蛋花汤', category: 'soup', servingG: 300, caloriesKcal: 60, proteinG: 3, fatG: 2, carbG: 5, fiberG: 1, sodiumMg: 350, priceFen: 200 },
  { id: 'dish-dongguapaigutang', canteen: '二食堂', name: '冬瓜排骨汤', category: 'soup', servingG: 400, caloriesKcal: 120, proteinG: 8, fatG: 7, carbG: 5, fiberG: 1, sodiumMg: 400, priceFen: 400 },
  // 饮品
  { id: 'dish-doujiang', canteen: '一食堂', name: '豆浆', category: 'drink', servingG: 300, caloriesKcal: 90, proteinG: 6, fatG: 3, carbG: 8, fiberG: 1, sodiumMg: 40, priceFen: 200 },
  { id: 'dish-naicha', canteen: '三食堂', name: '奶茶', category: 'drink', servingG: 500, caloriesKcal: 300, proteinG: 2, fatG: 10, carbG: 45, fiberG: 0, sodiumMg: 60, priceFen: 800 },
  // 水果
  { id: 'dish-xigua', canteen: '一食堂', name: '西瓜', category: 'fruit', servingG: 300, caloriesKcal: 90, proteinG: 1, fatG: 0, carbG: 21, fiberG: 1, sodiumMg: 5, priceFen: 300 },
  { id: 'dish-xiangjiao', canteen: '一食堂', name: '香蕉', category: 'fruit', servingG: 120, caloriesKcal: 105, proteinG: 1, fatG: 0, carbG: 27, fiberG: 3, sodiumMg: 2, priceFen: 200 },
  // 甜品
  { id: 'dish-hongdoubuding', canteen: '三食堂', name: '红豆布丁', category: 'dessert', servingG: 150, caloriesKcal: 220, proteinG: 4, fatG: 6, carbG: 36, fiberG: 1, sodiumMg: 90, priceFen: 500 },
  { id: 'dish-dangao', canteen: '三食堂', name: '蛋糕', category: 'dessert', servingG: 100, caloriesKcal: 320, proteinG: 5, fatG: 14, carbG: 44, fiberG: 1, sodiumMg: 180, priceFen: 600 },
]

/**
 * 每道菜的营养数据来源（演示期按食堂给一个合理来源 + 核对日期）。
 *
 * 真实项目里这两列由后台录入（`POST/PATCH /canteen/items` 的 `source` / `lastVerifiedAt`），
 * 这里只为 mock 数据补一份，让「数据来源」这一层在演示时也看得见。
 */
const CANTEEN_SOURCE: Readonly<Record<string, string>> = {
  一食堂: '一食堂公告栏公示',
  二食堂: '二食堂公告栏公示',
  三食堂: '人工录入（营养社整理）',
}

export const MOCK_DISHES: readonly CanteenDish[] = SEED.map((dish) => ({
  ...dish,
  source: CANTEEN_SOURCE[dish.canteen] ?? '人工录入',
  lastVerifiedAt: '2026-10-12T00:00:00.000Z',
  // 过敏原按菜名启发式推断（真实项目由后台录入 / 管理员修正）
  allergens: inferAllergensFromName(dish.name),
}))

/**
 * 演示识别池里**不在菜品库**的菜 —— 用来真实演示「识别到但菜品库
 * 还没有它」的诚实提示（项目原则：不假装可用）。
 */
export const MOCK_UNMATCHED_DISHES: readonly { name: string; category: DishCategory }[] = [
  { name: '惠灵顿牛排', category: 'meat' },
  { name: '法式鹅肝', category: 'meat' },
  { name: '寿司拼盘', category: 'other' },
]
