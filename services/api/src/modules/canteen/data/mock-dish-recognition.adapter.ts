/**
 * 营养管家园 · 演示期识别适配器（ADR 0006）
 *
 * **明确不是真实视觉识别**：按图片 URL 的哈希确定性地返回一组常见
 * 食堂菜品候选，confidence 是演出值。这样做的好处：
 *   · 不依赖外部服务，离线可演示、可单测
 *   · 同一张图永远返回同一组候选，演示不翻车
 *   · 界面会标注「演示识别」，不假装可用（项目诚实原则）
 *
 * 接真实视觉 API 时新增一个实现 DishRecognitionPort 的 adapter，
 * 在 canteen.module.ts 把 DISH_RECOGNITION 的 useClass 换掉即可。
 */
import { Injectable } from '@nestjs/common';
import type { DishRecognitionCandidate, DishRecognitionPort } from '../domain/recognition.domain';

/** 演示菜品池：校园食堂常见菜（识别只产名字，营养一律来自菜品库） */
const MOCK_POOL: ReadonlyArray<{ name: string; category: string }> = [
  { name: '米饭', category: 'staple' },
  { name: '番茄炒蛋', category: 'vegetable' },
  { name: '红烧排骨', category: 'meat' },
  { name: '清炒菠菜', category: 'vegetable' },
  { name: '紫菜蛋花汤', category: 'soup' },
  { name: '红烧牛肉面', category: 'staple' },
  { name: '香煎鸡腿', category: 'meat' },
  { name: '麻婆豆腐', category: 'vegetable' },
  { name: '蒸玉米', category: 'staple' },
  { name: '西瓜', category: 'fruit' },
  { name: '豆浆', category: 'drink' },
  { name: '肉包', category: 'staple' },
  { name: '蔬菜沙拉', category: 'vegetable' },
  { name: '红豆布丁', category: 'dessert' },
];

/** 稳定字符串哈希（djb2），保证同一 URL 永远选到同一组候选 */
function hashOf(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

@Injectable()
export class MockDishRecognitionAdapter implements DishRecognitionPort {
  async recognize(imageUrl: string): Promise<DishRecognitionCandidate[]> {
    const seed = hashOf(imageUrl);
    const count = 3 + (seed % 3); // 3-5 个候选
    const offset = seed % MOCK_POOL.length;

    const candidates: DishRecognitionCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      const pick = MOCK_POOL[(offset + i * 3) % MOCK_POOL.length];
      // 索引恒在界内；undefined 分支不可达，仅为满足 noUncheckedIndexedAccess
      if (pick === undefined) continue;
      candidates.push({
        dishId: null,
        name: pick.name,
        category: pick.category,
        // 置信度随名次衰减：0.95 → 0.62 左右（演出值）
        confidence: Math.round((0.95 - i * 0.11) * 100) / 100,
        mode: 'mock' as const,
      });
    }
    return candidates;
  }
}
