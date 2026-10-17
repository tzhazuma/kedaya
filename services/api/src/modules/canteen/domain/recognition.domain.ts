/**
 * 营养管家园 · 菜品识别端口（ADR 0006）
 *
 * 拍照识别走本端口 + 可替换适配器：
 *   · 演示期：MockDishRecognitionAdapter（确定性假数据，mode 恒为 'mock'）
 *   · 生产期：实现同一端口接真实视觉 API（百度/阿里/兼容 OpenAI vision），
 *     模块装配处换 useClass 即可，业务代码零改动
 *
 * 端口只负责「这张图像里可能有什么菜」；营养成分一律来自菜品库
 * （识别不产营养，避免两个真相源）。
 */

/** 单个识别候选 */
export interface DishRecognitionCandidate {
  /** 命中的菜品库 id；端口不查库，恒为 null，由 service 匹配后回填 */
  dishId: string | null;
  name: string;
  category: string;
  /** 置信度 0-1（演示值为演出数据） */
  confidence: number;
  /** 识别实现标识，UI 必须向用户明示「演示识别」 */
  mode: 'mock' | 'vision-api';
}

/** 识别端口 */
export interface DishRecognitionPort {
  recognize(imageUrl: string): Promise<DishRecognitionCandidate[]>;
}

export const DISH_RECOGNITION = Symbol('KEDAYA_DISH_RECOGNITION');
