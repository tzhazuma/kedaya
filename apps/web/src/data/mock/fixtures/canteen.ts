import type { CanteenDish } from '@/domain/models/canteen';

/**
 * 菜品库 mock 种子 —— 与小程序 mock 同源同口径（每份营养）。
 * 后台演示用：无后端也能做增删改查。
 */

function dish(
  id: string,
  canteen: string,
  name: string,
  category: CanteenDish['category'],
  servingG: number,
  caloriesKcal: number,
  proteinG: number,
  fatG: number,
  carbG: number,
  fiberG: number,
  sodiumMg: number,
  priceFen: number,
): CanteenDish {
  return {
    id,
    canteen,
    name,
    category,
    servingG,
    caloriesKcal,
    proteinG,
    fatG,
    carbG,
    fiberG,
    sodiumMg,
    priceFen,
  };
}

export function createDishSeed(now: Date): CanteenDish[] {
  const stamp = now.toISOString();
  return [
    dish('dish-rice', '一食堂', '米饭', 'staple', 150, 174, 4, 1, 38, 1, 5, 200),
    dish('dish-bun', '一食堂', '肉包', 'staple', 100, 230, 9, 9, 28, 1, 250, 200),
    dish('dish-noodle', '二食堂', '红烧牛肉面', 'staple', 500, 520, 22, 14, 74, 3, 1400, 1200),
    dish('dish-paigu', '一食堂', '红烧排骨', 'meat', 200, 520, 28, 38, 10, 0, 900, 1400),
    dish('dish-jitui', '一食堂', '香煎鸡腿', 'meat', 180, 380, 26, 22, 2, 0, 500, 900),
    dish('dish-fanqiechaodan', '一食堂', '番茄炒蛋', 'vegetable', 200, 180, 8, 12, 6, 2, 300, 500),
    dish('dish-bocai', '一食堂', '清炒菠菜', 'vegetable', 200, 90, 3, 5, 4, 3, 200, 400),
    dish('dish-mapodoufu', '二食堂', '麻婆豆腐', 'vegetable', 250, 210, 12, 14, 8, 2, 800, 600),
    dish('dish-zicaidantang', '一食堂', '紫菜蛋花汤', 'soup', 300, 60, 3, 2, 5, 1, 350, 200),
    dish('dish-doujiang', '一食堂', '豆浆', 'drink', 300, 90, 6, 3, 8, 1, 40, 200),
    dish('dish-xigua', '一食堂', '西瓜', 'fruit', 300, 90, 1, 0, 21, 1, 5, 300),
    dish('dish-hongdoubuding', '三食堂', '红豆布丁', 'dessert', 150, 220, 4, 6, 36, 1, 90, 500),
  ].map((item) => ({ ...item, createdAt: stamp, updatedAt: stamp }));
}
