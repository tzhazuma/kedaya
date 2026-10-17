import { fenToYuan, formatRelativeTime, yuanToFen } from '@kedaya/shared'

/**
 * 食堂营养（`canteen`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/canteen/` 逐条对齐：
 *   · 列表按食堂**精确**筛选（`?canteen=`）+ 菜名**模糊**搜索（`?q=`），最新在前；
 *   · 营养值一律整数（千卡 / 克），金额一律整数**分**（契约 §6.1，只在展示层转元）；
 *   · 创建是**匿名**的（后端 `POST /canteen/items` 不带归属字段）……
 *
 * …但"匿名"不等于"随便填"：菜品由同学共建，数据质量就是产品本身。
 * 所以这里把**食堂白名单**与营养 / 价格的**数值上界**收敛成同一份规则，
 * 供页面（即时提示）、用例（提交前校验）与 mock 仓储（离线也要挡坏数据）共用，
 * 避免三处各写一遍后悄悄漂移。真实模式下的最终裁决仍在服务端。
 */

/* ------------------------------------------------------------------ *
 * 食堂白名单 —— 与后端 seed 里的真实食堂名对齐
 * ------------------------------------------------------------------ */

/**
 * 支持的食堂。**单一真相**：列表筛选 chip 与创建表单都从这里取，
 * 不允许页面里再写一份（否则新增食堂时必定漏改一处）。
 *
 * 刻意包含 `清真食堂` / `其他` 两个名字：它们在校内真实存在 / 作为兜底，
 * 即便当前种子数据里暂时没有对应菜品，筛选后走到空态也是诚实的结果。
 */
export const CANTEEN_OPTIONS = [
  '第一食堂',
  '第二食堂',
  '第三食堂',
  '清真食堂',
  '教工食堂',
  '咖啡吧',
  '其他',
] as const

export type CanteenName = (typeof CANTEEN_OPTIONS)[number]

export function isCanteenName(value: unknown): value is CanteenName {
  return typeof value === 'string' && (CANTEEN_OPTIONS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * 字段上限（与服务端 createSchema / listQuerySchema 对齐）
 * ------------------------------------------------------------------ */

/** 菜品名称上限：与后端 `listQuerySchema.q` 的 60 对齐 */
export const CANTEEN_DISH_NAME_MAX = 60
/** 单份热量上限（千卡）：一份正餐很难超过 5000，超过基本是录入错误 */
export const CANTEEN_CALORIES_MAX = 5000
/** 单个营养素上限（克） */
export const CANTEEN_MACRO_MAX = 1000
/** 单价上限（分）= 1000 元，与后端字段边界一致 */
export const CANTEEN_PRICE_MAX_FEN = 100_000

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 领域模型：字段与后端 `CanteenDishModel` 一一对应，时间以 ISO 字符串传输 */
export interface CanteenDish {
  id: string
  canteen: string
  name: string
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  /** 整数分（契约 §6.1） */
  priceFen: number
  createdAt: string
  updatedAt: string
}

export interface CreateCanteenDishInput {
  canteen: string
  name: string
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  priceFen: number
}

/** 列表筛选条件（`canteen` 精确 / `q` 菜名模糊），与后端 `listQuerySchema` 同形 */
export interface CanteenDishFilters extends Record<string, unknown> {
  canteen?: string
  q?: string
}

/** 卡片 / 列表直接可读的派生视图 —— UI 不再自己算单位与相对时间 */
export interface CanteenDishSummary {
  id: string
  canteen: string
  name: string
  caloriesKcal: number
  /** 例：`780 千卡` */
  caloriesLabel: string
  /** 例：`¥18.00` */
  priceLabel: string
  /** 例：`蛋白 32g · 脂肪 28g · 碳水 96g` */
  macroSummary: string
  /** 三大营养素克数（卡片要画成三条比例条，不能只给拼好的字符串） */
  proteinG: number
  fatG: number
  carbG: number
  /** 三大营养素的**克数**占比（0–100 整数，三项之和恒为 100） */
  macroShares: MacroShares
  /** 热量档位（列表标签用不同语气） */
  calorieLevel: CalorieLevel
  calorieLevelLabel: string
  createdLabel: string
}

/** 三大营养素的克数占比（百分比整数） */
export interface MacroShares {
  protein: number
  fat: number
  carb: number
}

/** 某食堂的营养汇总（对应 `GET /canteen/calories?canteen=`） */
export interface CanteenCalorieSummary {
  dishes: number
  totalCaloriesKcal: number
  /** 均价，整数分 */
  avgPriceFen: number
}

/* ------------------------------------------------------------------ *
 * 展示标签（UI 与 mock 共用，禁止在各处重算）
 * ------------------------------------------------------------------ */

export type CalorieLevel = 'light' | 'moderate' | 'heavy'

export const CALORIE_LEVEL_LABELS: Readonly<Record<CalorieLevel, string>> = {
  light: '清淡',
  moderate: '适中',
  heavy: '偏高',
}

/** 热量档位：以"一顿正餐"的常见区间划分，纯展示用途 */
export function calorieLevel(kcal: number): CalorieLevel {
  if (kcal < 300) return 'light'
  if (kcal < 700) return 'moderate'
  return 'heavy'
}

export function calorieLevelLabel(kcal: number): string {
  return CALORIE_LEVEL_LABELS[calorieLevel(kcal)]
}

/** 热量文案（含单位，避免 UI 里漏写"千卡"） */
export function caloriesLabel(kcal: number): string {
  return `${kcal} 千卡`
}

/** 营养素文案（克） */
export function macroLabel(grams: number): string {
  return `${grams} g`
}

/** 价格文案：分 → 元（只在展示层换算） */
export function priceLabel(fen: number): string {
  return `¥${fenToYuan(fen)}`
}

/** 共建免责声明 —— 页面底部统一展示，不构成营养建议 */
export const CANTEEN_DISCLAIMER = '数据由同学共建，仅作参考，不构成营养建议'

/** 派生视图：把一行原始数据映射成卡片直接可用的形状 */
/**
 * 三大营养素的**克数**占比。
 *
 * ⚠️ 口径必须说清楚：这是**克数**占比，不是热量占比。热量占比要把蛋白 ×4、
 * 碳水 ×4、脂肪 ×9 —— 同一份菜按克数和按热量算出来的百分比差别很大。
 * 卡片上写的就是「按克数占比」这六个字，不做没有依据的换算。
 *
 * 两项四舍五入 + 第三项取余数，保证三项**恒好加到 100**（否则条形图会缺一小格，
 * 看起来像渲染 bug）。`carb` 用 `Math.max(0, ...)` 兜住极端四舍五入。
 */
export function macroShares(
  dish: Pick<CanteenDish, 'proteinG' | 'fatG' | 'carbG'>,
): MacroShares {
  const total = dish.proteinG + dish.fatG + dish.carbG
  if (!(total > 0)) return { protein: 0, fat: 0, carb: 0 }
  const protein = Math.round((dish.proteinG / total) * 100)
  const fat = Math.round((dish.fatG / total) * 100)
  return { protein, fat, carb: Math.max(0, 100 - protein - fat) }
}

export function summarize(dish: CanteenDish, now: Date): CanteenDishSummary {
  const level = calorieLevel(dish.caloriesKcal)
  return {
    id: dish.id,
    canteen: dish.canteen,
    name: dish.name,
    caloriesKcal: dish.caloriesKcal,
    caloriesLabel: caloriesLabel(dish.caloriesKcal),
    priceLabel: priceLabel(dish.priceFen),
    macroSummary: `蛋白 ${dish.proteinG}g · 脂肪 ${dish.fatG}g · 碳水 ${dish.carbG}g`,
    proteinG: dish.proteinG,
    fatG: dish.fatG,
    carbG: dish.carbG,
    macroShares: macroShares(dish),
    calorieLevel: level,
    calorieLevelLabel: CALORIE_LEVEL_LABELS[level],
    createdLabel: formatRelativeTime(dish.createdAt, now),
  }
}

/* ------------------------------------------------------------------ *
 * 文本解析（表单收字符串，提交前转成整数 / 分）
 * ------------------------------------------------------------------ */

/**
 * 非负整数文本 → 数字。空串 / 负数 / 小数 / 非数字一律返回 null。
 *
 * 不用 `Number(text)`：它会把 `'12abc'` 变成 `NaN`（还好），
 * 但会把 `'1e3'` 当 1000、把 `' 12 '` 当 12、把 `''` 当 0 ——
 * 营养录入要的是"所见即所得"，因此只接受纯数字串。
 */
export function parseIntegerText(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

/** 元文本 → 整数分；非法输入返回 null（复用共享的 `yuanToFen`） */
export function parseYuanText(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    return yuanToFen(trimmed)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数，用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function canteenNameProblem(canteen: string): string | null {
  return isCanteenName(canteen) ? null : '请选择食堂'
}

export function dishNameProblem(name: string): string | null {
  const text = name.trim()
  if (text.length === 0) return '请填写菜品名称'
  if ([...text].length > CANTEEN_DISH_NAME_MAX) return `菜品名称最多 ${CANTEEN_DISH_NAME_MAX} 个字`
  return null
}

/** 整数营养值：必填、非负、不超上界 */
export function integerTextProblem(text: string, label: string, max: number): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return `请填写${label}`
  const value = parseIntegerText(trimmed)
  if (value === null) return `${label}要填非负整数`
  if (value > max) return `${label}不能超过 ${max}`
  return null
}

export function caloriesProblem(text: string): string | null {
  return integerTextProblem(text, '热量', CANTEEN_CALORIES_MAX)
}

export function macroProblem(text: string, label: string): string | null {
  return integerTextProblem(text, label, CANTEEN_MACRO_MAX)
}

/** 价格：元文本 → 分，拒绝负数与超上界 */
export function priceProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return '请填写价格'
  const fen = parseYuanText(trimmed)
  if (fen === null) return '价格请填数字，最多两位小数'
  if (fen < 0) return '价格不能为负数'
  if (fen > CANTEEN_PRICE_MAX_FEN) return `价格不能超过 ${priceLabel(CANTEEN_PRICE_MAX_FEN)}`
  return null
}
