/**
 * 可达鸭 · 数据种子（营养管家的菜品库 + 一个可登录的演示账号）
 *
 * 为什么需要它：没有种子数据的「真后端」是一个空菜品库 ——
 * 搜索空、推荐空、拍照候选全是 `dish: null`，于是演示只能跑 mock，
 * 等于这套真后端从来没有被证明能用（ADR 0006 C2 的一半答案就在这里）。
 *
 * 用法（在 `services/api` 下，先 `docker compose up -d` 起 Postgres）：
 *   npm run prisma:migrate      # 首次：建表
 *   npm run prisma:seed         # 本文件：灌菜品 + 演示账号
 *
 * 幂等：菜品按 (canteen, name) 查重后 create/update，重复运行不会产生副本。
 *
 * 口径（ADR 0006 D5）：营养值一律**每份**（= `servingG` 克），不是每 100 g。
 * 数值参考《中国食物成分表》常见档口的量级，属于**演示量级**的合理估算，
 * 不是食堂公示数据；真实上线应换成食堂公示值（README「数据来源」）。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

try {
  // Prisma 7 不再自动读 .env；与 prisma.config.ts 保持同一套加载方式
  process.loadEnvFile('.env');
} catch {
  // 没有 .env（CI / 容器）时用环境变量注入
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://kedaya:kedaya@localhost:5432/kedaya?schema=public';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** 与服务端一致的「一天」口径（分钟），用于把演示餐落在今天 */
const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? 480);

interface SeedDish {
  canteen: string;
  name: string;
  category: string;
  servingG: number;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  sodiumMg: number;
  priceFen: number;
}

/** 72 道菜，覆盖四个食堂与八种品类（推荐要能做出「品类均衡」才看得出效果） */
const DISHES: SeedDish[] = [
  // ---------------- 一食堂 · 本帮家常 ----------------
  { canteen: '一食堂', name: '米饭', category: 'staple', servingG: 150, caloriesKcal: 174, proteinG: 4, fatG: 1, carbG: 38, fiberG: 1, sodiumMg: 5, priceFen: 200 },
  { canteen: '一食堂', name: '二两馒头', category: 'staple', servingG: 100, caloriesKcal: 230, proteinG: 7, fatG: 1, carbG: 48, fiberG: 2, sodiumMg: 150, priceFen: 100 },
  { canteen: '一食堂', name: '红烧排骨', category: 'meat', servingG: 200, caloriesKcal: 520, proteinG: 28, fatG: 38, carbG: 10, fiberG: 0, sodiumMg: 900, priceFen: 1400 },
  { canteen: '一食堂', name: '红烧肉', category: 'meat', servingG: 150, caloriesKcal: 480, proteinG: 20, fatG: 40, carbG: 8, fiberG: 0, sodiumMg: 850, priceFen: 1300 },
  { canteen: '一食堂', name: '番茄炒蛋', category: 'meat', servingG: 180, caloriesKcal: 180, proteinG: 8, fatG: 12, carbG: 6, fiberG: 2, sodiumMg: 300, priceFen: 800 },
  { canteen: '一食堂', name: '清炒菠菜', category: 'vegetable', servingG: 150, caloriesKcal: 90, proteinG: 3, fatG: 5, carbG: 4, fiberG: 3, sodiumMg: 200, priceFen: 500 },
  { canteen: '一食堂', name: '蒜蓉西兰花', category: 'vegetable', servingG: 150, caloriesKcal: 85, proteinG: 4, fatG: 4, carbG: 7, fiberG: 4, sodiumMg: 180, priceFen: 600 },
  { canteen: '一食堂', name: '上汤娃娃菜', category: 'vegetable', servingG: 200, caloriesKcal: 70, proteinG: 3, fatG: 4, carbG: 5, fiberG: 3, sodiumMg: 380, priceFen: 600 },
  { canteen: '一食堂', name: '紫菜蛋花汤', category: 'soup', servingG: 300, caloriesKcal: 60, proteinG: 4, fatG: 3, carbG: 4, fiberG: 1, sodiumMg: 600, priceFen: 300 },
  { canteen: '一食堂', name: '玉米排骨汤', category: 'soup', servingG: 300, caloriesKcal: 180, proteinG: 10, fatG: 12, carbG: 8, fiberG: 2, sodiumMg: 700, priceFen: 500 },
  { canteen: '一食堂', name: '麻婆豆腐', category: 'vegetable', servingG: 180, caloriesKcal: 220, proteinG: 12, fatG: 15, carbG: 10, fiberG: 2, sodiumMg: 780, priceFen: 900 },
  { canteen: '一食堂', name: '鱼香肉丝', category: 'meat', servingG: 180, caloriesKcal: 320, proteinG: 16, fatG: 22, carbG: 14, fiberG: 1, sodiumMg: 750, priceFen: 1200 },
  { canteen: '一食堂', name: '宫保鸡丁', category: 'meat', servingG: 180, caloriesKcal: 340, proteinG: 22, fatG: 20, carbG: 15, fiberG: 2, sodiumMg: 820, priceFen: 1300 },
  { canteen: '一食堂', name: '清蒸鲈鱼', category: 'meat', servingG: 200, caloriesKcal: 200, proteinG: 26, fatG: 8, carbG: 2, fiberG: 0, sodiumMg: 420, priceFen: 1800 },
  { canteen: '一食堂', name: '香煎鸡腿', category: 'meat', servingG: 150, caloriesKcal: 330, proteinG: 25, fatG: 22, carbG: 6, fiberG: 0, sodiumMg: 700, priceFen: 1200 },
  { canteen: '一食堂', name: '蒸玉米', category: 'staple', servingG: 150, caloriesKcal: 130, proteinG: 4, fatG: 1, carbG: 28, fiberG: 3, sodiumMg: 5, priceFen: 300 },
  { canteen: '一食堂', name: '红薯', category: 'staple', servingG: 150, caloriesKcal: 130, proteinG: 2, fatG: 0, carbG: 30, fiberG: 3, sodiumMg: 10, priceFen: 300 },
  { canteen: '一食堂', name: '白米粥', category: 'staple', servingG: 300, caloriesKcal: 110, proteinG: 3, fatG: 0, carbG: 24, fiberG: 1, sodiumMg: 20, priceFen: 200 },
  { canteen: '一食堂', name: '豆浆', category: 'drink', servingG: 300, caloriesKcal: 90, proteinG: 6, fatG: 4, carbG: 7, fiberG: 0, sodiumMg: 40, priceFen: 200 },
  { canteen: '一食堂', name: '西瓜', category: 'fruit', servingG: 200, caloriesKcal: 60, proteinG: 1, fatG: 0, carbG: 15, fiberG: 1, sodiumMg: 5, priceFen: 500 },
  { canteen: '一食堂', name: '苹果', category: 'fruit', servingG: 150, caloriesKcal: 80, proteinG: 0, fatG: 0, carbG: 20, fiberG: 2, sodiumMg: 2, priceFen: 400 },
  { canteen: '一食堂', name: '红豆布丁', category: 'dessert', servingG: 120, caloriesKcal: 180, proteinG: 3, fatG: 5, carbG: 30, fiberG: 1, sodiumMg: 60, priceFen: 600 },
  { canteen: '一食堂', name: '茶叶蛋', category: 'other', servingG: 60, caloriesKcal: 80, proteinG: 7, fatG: 5, carbG: 1, fiberG: 0, sodiumMg: 300, priceFen: 200 },
  { canteen: '一食堂', name: '可乐', category: 'drink', servingG: 330, caloriesKcal: 140, proteinG: 0, fatG: 0, carbG: 35, fiberG: 0, sodiumMg: 10, priceFen: 350 },

  // ---------------- 二食堂 · 川湘面食 ----------------
  { canteen: '二食堂', name: '牛肉面', category: 'staple', servingG: 450, caloriesKcal: 560, proteinG: 28, fatG: 16, carbG: 72, fiberG: 3, sodiumMg: 1200, priceFen: 1500 },
  { canteen: '二食堂', name: '重庆小面', category: 'staple', servingG: 400, caloriesKcal: 520, proteinG: 18, fatG: 18, carbG: 68, fiberG: 3, sodiumMg: 1400, priceFen: 1200 },
  { canteen: '二食堂', name: '水煮肉片', category: 'meat', servingG: 250, caloriesKcal: 480, proteinG: 28, fatG: 34, carbG: 14, fiberG: 2, sodiumMg: 1600, priceFen: 1600 },
  { canteen: '二食堂', name: '剁椒鱼头', category: 'meat', servingG: 250, caloriesKcal: 300, proteinG: 30, fatG: 18, carbG: 6, fiberG: 1, sodiumMg: 1300, priceFen: 1800 },
  { canteen: '二食堂', name: '辣子鸡', category: 'meat', servingG: 200, caloriesKcal: 420, proteinG: 26, fatG: 30, carbG: 10, fiberG: 1, sodiumMg: 1100, priceFen: 1500 },
  { canteen: '二食堂', name: '干煸四季豆', category: 'vegetable', servingG: 200, caloriesKcal: 240, proteinG: 7, fatG: 18, carbG: 14, fiberG: 5, sodiumMg: 700, priceFen: 900 },
  { canteen: '二食堂', name: '酸辣土豆丝', category: 'vegetable', servingG: 180, caloriesKcal: 180, proteinG: 3, fatG: 10, carbG: 20, fiberG: 2, sodiumMg: 500, priceFen: 600 },
  { canteen: '二食堂', name: '手撕包菜', category: 'vegetable', servingG: 180, caloriesKcal: 120, proteinG: 3, fatG: 7, carbG: 12, fiberG: 3, sodiumMg: 450, priceFen: 600 },
  { canteen: '二食堂', name: '酸辣汤', category: 'soup', servingG: 300, caloriesKcal: 90, proteinG: 5, fatG: 4, carbG: 10, fiberG: 1, sodiumMg: 900, priceFen: 400 },
  { canteen: '二食堂', name: '番茄牛腩', category: 'soup', servingG: 300, caloriesKcal: 260, proteinG: 18, fatG: 14, carbG: 16, fiberG: 2, sodiumMg: 800, priceFen: 1200 },
  { canteen: '二食堂', name: '卤肉饭', category: 'staple', servingG: 400, caloriesKcal: 620, proteinG: 24, fatG: 22, carbG: 80, fiberG: 2, sodiumMg: 1300, priceFen: 1400 },
  { canteen: '二食堂', name: '蛋炒饭', category: 'staple', servingG: 350, caloriesKcal: 560, proteinG: 16, fatG: 18, carbG: 78, fiberG: 2, sodiumMg: 900, priceFen: 1000 },
  { canteen: '二食堂', name: '烤鸭饭', category: 'staple', servingG: 400, caloriesKcal: 700, proteinG: 32, fatG: 30, carbG: 78, fiberG: 1, sodiumMg: 1400, priceFen: 1800 },
  { canteen: '二食堂', name: '凉皮', category: 'staple', servingG: 250, caloriesKcal: 330, proteinG: 8, fatG: 8, carbG: 58, fiberG: 1, sodiumMg: 800, priceFen: 800 },
  { canteen: '二食堂', name: '煎饺', category: 'staple', servingG: 200, caloriesKcal: 420, proteinG: 14, fatG: 18, carbG: 48, fiberG: 2, sodiumMg: 700, priceFen: 900 },
  { canteen: '二食堂', name: '小笼包', category: 'staple', servingG: 200, caloriesKcal: 380, proteinG: 16, fatG: 16, carbG: 42, fiberG: 1, sodiumMg: 600, priceFen: 900 },
  { canteen: '二食堂', name: '皮蛋瘦肉粥', category: 'staple', servingG: 350, caloriesKcal: 200, proteinG: 10, fatG: 4, carbG: 32, fiberG: 1, sodiumMg: 800, priceFen: 600 },
  { canteen: '二食堂', name: '酸奶', category: 'drink', servingG: 200, caloriesKcal: 140, proteinG: 6, fatG: 5, carbG: 18, fiberG: 0, sodiumMg: 80, priceFen: 500 },
  { canteen: '二食堂', name: '橙子', category: 'fruit', servingG: 200, caloriesKcal: 90, proteinG: 1, fatG: 0, carbG: 22, fiberG: 2, sodiumMg: 3, priceFen: 400 },
  { canteen: '二食堂', name: '香蕉', category: 'fruit', servingG: 150, caloriesKcal: 130, proteinG: 2, fatG: 0, carbG: 33, fiberG: 2, sodiumMg: 2, priceFen: 300 },
  { canteen: '二食堂', name: '绿豆汤', category: 'drink', servingG: 300, caloriesKcal: 150, proteinG: 2, fatG: 0, carbG: 36, fiberG: 3, sodiumMg: 20, priceFen: 300 },
  { canteen: '二食堂', name: '麻辣烫', category: 'other', servingG: 400, caloriesKcal: 450, proteinG: 20, fatG: 26, carbG: 36, fiberG: 4, sodiumMg: 1800, priceFen: 1500 },
  { canteen: '二食堂', name: '炸鸡腿', category: 'meat', servingG: 150, caloriesKcal: 400, proteinG: 24, fatG: 26, carbG: 16, fiberG: 0, sodiumMg: 900, priceFen: 1200 },
  { canteen: '二食堂', name: '关东煮', category: 'other', servingG: 250, caloriesKcal: 180, proteinG: 10, fatG: 6, carbG: 22, fiberG: 2, sodiumMg: 1200, priceFen: 800 },

  // ---------------- 三食堂 · 面档 / 轻食 ----------------
  { canteen: '三食堂', name: '兰州拉面', category: 'staple', servingG: 450, caloriesKcal: 540, proteinG: 26, fatG: 14, carbG: 76, fiberG: 3, sodiumMg: 1100, priceFen: 1400 },
  { canteen: '三食堂', name: '牛肉炒面', category: 'staple', servingG: 400, caloriesKcal: 620, proteinG: 24, fatG: 22, carbG: 80, fiberG: 2, sodiumMg: 1300, priceFen: 1500 },
  { canteen: '三食堂', name: '鸡丝凉面', category: 'staple', servingG: 350, caloriesKcal: 480, proteinG: 20, fatG: 14, carbG: 68, fiberG: 2, sodiumMg: 1000, priceFen: 1200 },
  { canteen: '三食堂', name: '手抓饭', category: 'staple', servingG: 400, caloriesKcal: 600, proteinG: 22, fatG: 20, carbG: 82, fiberG: 2, sodiumMg: 900, priceFen: 1600 },
  { canteen: '三食堂', name: '烤鸡胸肉沙拉', category: 'other', servingG: 250, caloriesKcal: 220, proteinG: 28, fatG: 8, carbG: 8, fiberG: 4, sodiumMg: 400, priceFen: 1600 },
  { canteen: '三食堂', name: '藜麦鸡胸碗', category: 'other', servingG: 350, caloriesKcal: 400, proteinG: 32, fatG: 10, carbG: 46, fiberG: 6, sodiumMg: 500, priceFen: 2000 },
  { canteen: '三食堂', name: '清炒芦笋', category: 'vegetable', servingG: 150, caloriesKcal: 80, proteinG: 3, fatG: 4, carbG: 6, fiberG: 3, sodiumMg: 200, priceFen: 800 },
  { canteen: '三食堂', name: '冬瓜排骨汤', category: 'soup', servingG: 300, caloriesKcal: 150, proteinG: 8, fatG: 10, carbG: 6, fiberG: 1, sodiumMg: 650, priceFen: 600 },
  { canteen: '三食堂', name: '蒸南瓜', category: 'staple', servingG: 200, caloriesKcal: 90, proteinG: 2, fatG: 0, carbG: 20, fiberG: 2, sodiumMg: 5, priceFen: 300 },
  { canteen: '三食堂', name: '无糖酸奶', category: 'drink', servingG: 200, caloriesKcal: 110, proteinG: 7, fatG: 4, carbG: 12, fiberG: 0, sodiumMg: 80, priceFen: 600 },
  { canteen: '三食堂', name: '黑咖啡', category: 'drink', servingG: 300, caloriesKcal: 5, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 5, priceFen: 800 },
  { canteen: '三食堂', name: '三明治', category: 'staple', servingG: 200, caloriesKcal: 380, proteinG: 14, fatG: 14, carbG: 46, fiberG: 2, sodiumMg: 800, priceFen: 1200 },
  { canteen: '三食堂', name: '水煮鸡胸', category: 'meat', servingG: 200, caloriesKcal: 230, proteinG: 40, fatG: 5, carbG: 4, fiberG: 0, sodiumMg: 350, priceFen: 1500 },
  { canteen: '三食堂', name: '番茄意面', category: 'staple', servingG: 350, caloriesKcal: 480, proteinG: 16, fatG: 14, carbG: 70, fiberG: 3, sodiumMg: 600, priceFen: 1600 },
  { canteen: '三食堂', name: '西兰花牛肉', category: 'meat', servingG: 250, caloriesKcal: 300, proteinG: 24, fatG: 14, carbG: 18, fiberG: 4, sodiumMg: 700, priceFen: 1800 },
  { canteen: '三食堂', name: '紫薯', category: 'staple', servingG: 150, caloriesKcal: 120, proteinG: 2, fatG: 0, carbG: 28, fiberG: 3, sodiumMg: 10, priceFen: 300 },

  // ---------------- 教工食堂 · 家常 ----------------
  { canteen: '教工食堂', name: '黄焖鸡米饭', category: 'staple', servingG: 450, caloriesKcal: 680, proteinG: 30, fatG: 26, carbG: 80, fiberG: 2, sodiumMg: 1400, priceFen: 1800 },
  { canteen: '教工食堂', name: '清炒虾仁', category: 'meat', servingG: 200, caloriesKcal: 200, proteinG: 24, fatG: 8, carbG: 6, fiberG: 0, sodiumMg: 600, priceFen: 2200 },
  { canteen: '教工食堂', name: '西芹百合', category: 'vegetable', servingG: 200, caloriesKcal: 110, proteinG: 3, fatG: 5, carbG: 12, fiberG: 3, sodiumMg: 400, priceFen: 900 },
  { canteen: '教工食堂', name: '山药排骨汤', category: 'soup', servingG: 300, caloriesKcal: 200, proteinG: 12, fatG: 12, carbG: 10, fiberG: 2, sodiumMg: 700, priceFen: 800 },
  { canteen: '教工食堂', name: '白灼菜心', category: 'vegetable', servingG: 200, caloriesKcal: 60, proteinG: 3, fatG: 3, carbG: 4, fiberG: 3, sodiumMg: 350, priceFen: 600 },
  { canteen: '教工食堂', name: '杂粮饭', category: 'staple', servingG: 200, caloriesKcal: 260, proteinG: 6, fatG: 2, carbG: 54, fiberG: 4, sodiumMg: 10, priceFen: 300 },
  { canteen: '教工食堂', name: '蒸蛋', category: 'other', servingG: 150, caloriesKcal: 110, proteinG: 9, fatG: 7, carbG: 2, fiberG: 0, sodiumMg: 300, priceFen: 400 },
  { canteen: '教工食堂', name: '冰糖雪梨', category: 'drink', servingG: 300, caloriesKcal: 120, proteinG: 0, fatG: 0, carbG: 30, fiberG: 1, sodiumMg: 10, priceFen: 400 },
];

/** 演示账号（CAS mock 登录用 `ticket=demo-student`） */
const DEMO_EXTERNAL_ID = 'demo-student';
const DEMO_DISPLAY_NAME = '演示同学';

/** 营养数据来源（按食堂给一个可追溯的来源；真实上线应换成公示文件链接/编号） */
const CANTEEN_SOURCE: Readonly<Record<string, string>> = {
  一食堂: '一食堂公告栏公示',
  二食堂: '二食堂公告栏公示',
  三食堂: '人工录入（营养社整理）',
  教工食堂: '教工食堂公示',
};

/** 这批数据的核对日期 */
const VERIFIED_AT = new Date('2026-10-12T00:00:00.000Z');

/**
 * 菜名 → 过敏原（与 `@kedaya/shared` 的 `inferAllergensFromName` 同一套关键词）。
 *
 * 为什么在这里复制一份：seed 是**独立脚本**（`node prisma/seed.ts`），
 * 直接 import 工作区的 TS 源码在 ESM/类型擦除下不稳；而这份映射只是初标，
 * 真实标注以后台录入为准，重复的代价可以接受。
 */
const ALLERGEN_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['peanut', ['花生', '宫保']],
  ['tree-nut', ['核桃', '杏仁', '腰果', '坚果']],
  ['seafood', ['鱼', '虾', '蟹', '贝', '蛤', '鱿鱼', '海参', '生蚝', '扇贝']],
  ['egg', ['蛋', '皮蛋', '咸蛋']],
  ['milk', ['奶', '芝士', '奶酪', '黄油', '奶油', '布丁', '拿铁']],
  ['soy', ['豆腐', '豆浆', '豆干', '腐竹', '豆皮', '黄豆']],
  ['gluten', ['面', '馒头', '包', '饺', '饼', '蛋糕', '面包', '意面', '拉面', '凉皮', '油条']],
  ['beef', ['牛肉', '牛腩', '牛排', '肥牛']],
  ['pork', ['猪', '排骨', '里脊', '肉包', '卤肉', '红烧肉', '五花', '腊肉', '肘子']],
  ['chili', ['辣', '麻婆', '水煮', '剁椒', '麻辣', '干锅', '香辣']],
  ['cilantro', ['香菜', '芫荽']],
  ['sesame', ['芝麻', '麻酱']],
];

function inferAllergens(name: string): string[] {
  return ALLERGEN_KEYWORDS.filter(([, keywords]) => keywords.some((keyword) => name.includes(keyword))).map(
    ([allergen]) => allergen,
  );
}

async function seedDishes(): Promise<number> {
  let created = 0;
  let updated = 0;
  for (const dish of DISHES) {
    const data = {
      ...dish,
      source: CANTEEN_SOURCE[dish.canteen] ?? '人工录入',
      lastVerifiedAt: VERIFIED_AT,
      allergens: inferAllergens(dish.name),
    };
    const existing = await prisma.canteenDish.findFirst({
      where: { canteen: dish.canteen, name: dish.name },
    });
    if (existing === null) {
      await prisma.canteenDish.create({ data });
      created += 1;
    } else {
      await prisma.canteenDish.update({ where: { id: existing.id }, data });
      updated += 1;
    }
  }
  console.log(`菜品库：新增 ${created} 道，更新 ${updated} 道（共 ${DISHES.length} 道）`);
  return DISHES.length;
}

/** 今天的某个时刻（按项目时区口径，与服务端 dayRange 对齐） */
function todayAt(hour: number, minute: number, now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  const wallMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dayStart = wallMidnight - TZ_OFFSET_MINUTES * 60 * 1000;
  return new Date(dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000);
}

async function seedDemoUser(): Promise<void> {
  const identity = await prisma.authIdentity.findUnique({
    where: { provider_externalId: { provider: 'SHTU_CAS', externalId: DEMO_EXTERNAL_ID } },
    include: { user: true },
  });

  const user =
    identity?.user ??
    (await prisma.user.create({
      data: {
        displayName: DEMO_DISPLAY_NAME,
        department: '信息科学与技术学院',
        identities: {
          create: {
            provider: 'SHTU_CAS',
            externalId: DEMO_EXTERNAL_ID,
            email: 'demo@shanghaitech.edu.cn',
            realName: DEMO_DISPLAY_NAME,
            department: '信息科学与技术学院',
            lastLoginAt: new Date(),
          },
        },
      },
    }));

  // 每日需求：一人一份（顺带把估算器需要的身体档案存下来，体现「因人而异」）
  await prisma.nutritionTarget.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      caloriesKcal: 2400,
      proteinG: 96,
      fatG: 66,
      carbG: 336,
      fiberG: 34,
      sodiumMg: 2000,
      sex: 'male',
      age: 20,
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
    },
    update: {},
  });

  // 今日已吃：早餐 + 午餐（只在今天还没有记录时写入，保证幂等）
  const todayStart = todayAt(0, 0);
  const existingMeals = await prisma.mealRecord.count({
    where: { userId: user.id, eatenAt: { gte: todayStart } },
  });
  if (existingMeals > 0) {
    console.log(`演示账号已有 ${existingMeals} 条今日记录，跳过写入`);
    return;
  }

  const pick = async (name: string) => {
    const dish = await prisma.canteenDish.findFirst({ where: { name } });
    if (dish === null) throw new Error(`种子菜品缺失：${name}`);
    return dish;
  };

  const breakfastItems = [await pick('豆浆'), await pick('小笼包')];
  const lunchItems = [await pick('米饭'), await pick('红烧排骨'), await pick('清炒菠菜')];

  const toItem = (dish: Awaited<ReturnType<typeof pick>>, servings: number) => ({
    dishId: dish.id,
    dishName: dish.name,
    category: dish.category,
    servings,
    caloriesKcal: dish.caloriesKcal,
    proteinG: dish.proteinG,
    fatG: dish.fatG,
    carbG: dish.carbG,
    fiberG: dish.fiberG,
    sodiumMg: dish.sodiumMg,
  });

  await prisma.mealRecord.create({
    data: {
      userId: user.id,
      mealType: 'breakfast',
      source: 'manual',
      eatenAt: todayAt(8, 5),
      items: { create: breakfastItems.map((dish) => toItem(dish, 1)) },
    },
  });
  await prisma.mealRecord.create({
    data: {
      userId: user.id,
      mealType: 'lunch',
      source: 'photo',
      eatenAt: todayAt(12, 10),
      note: '一食堂二楼',
      items: { create: lunchItems.map((dish) => toItem(dish, 1)) },
    },
  });

  console.log(`演示账号：${user.displayName}（userId=${user.id}），已写入今日早餐 + 午餐`);
}

async function main(): Promise<void> {
  await seedDishes();
  await seedDemoUser();
  console.log('种子数据完成。演示登录：POST /api/v1/auth/login { "ticket": "demo-student" }');
}

main()
  .catch((error: unknown) => {
    console.error('种子数据写入失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
