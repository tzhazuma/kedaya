-- ============================================================================
-- 营养管家 · canteen —— 迁移（2026-10-18）
--   契约 docs/architecture/03-api-contract.md §12（附录：营养管家端点全表）
--   决策 docs/adr/0006-nutrition-butler.md
--
-- ## 本迁移做什么
--
-- 1. 升级 `CanteenDish`：补六项营养口径所需的字段与「可信度」元数据。
--    · category / servingG / fiberG / sodiumMg —— 每份口径的六项营养（ADR 0006 D5）；
--    · source / lastVerifiedAt —— 回答「这个数字凭什么可信」（C2）；
--    · allergens —— 过敏原标注，推荐阶段命中即**整道排除**（D22）；
--    · deletedAt —— 软删除：菜品是历史餐记录的依据，硬删会让 MealItem.dishId 变 NULL（D17）。
--2. 新增 `MealRecord` / `MealItem` —— 当餐记录。营养值是菜品库值的**快照**（D1/D2），
--    因此 MealItem 里冗余存 caloriesKcal…sodiumMg，而不是每次 JOIN 菜品库回算。
-- 3. 新增 `NutritionTarget` —— 一人一份（userId 唯一）的每日需求 + 身体档案 + 忌口。
--    需求由使用者自行提出，估算器只负责预填（D4）。
--
-- ## 数据安全说明（可回滚性）
--
-- · 新增列全部带默认值或可空 → 对已有行是**无损**的（老菜品默认 other / 100g / 0）；
-- · 没有改写、没有删除任何既有列与数据；
-- · 回滚 = 删除新表 + 删除新列（老数据仍在）。
--
-- ## 生成方式（可复现）
--
-- ```bash
-- git show HEAD:services/api/prisma/schema.prisma > /tmp/old.prisma
-- cd services/api
-- npx prisma migrate diff --from-schema /tmp/old.prisma --to-schema prisma/schema.prisma --script
-- ```
-- ============================================================================

-- AlterTable
ALTER TABLE "CanteenDish" ADD COLUMN     "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fiberG" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "servingG" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "sodiumMg" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "MealRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL DEFAULT 'lunch',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "eatenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealItem" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "dishId" TEXT,
    "dishName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "caloriesKcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "carbG" INTEGER NOT NULL,
    "fiberG" INTEGER NOT NULL DEFAULT 0,
    "sodiumMg" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MealItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caloriesKcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "carbG" INTEGER NOT NULL,
    "fiberG" INTEGER NOT NULL DEFAULT 25,
    "sodiumMg" INTEGER NOT NULL DEFAULT 2000,
    "sex" TEXT,
    "age" INTEGER,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "activity" TEXT,
    "goal" TEXT,
    "avoidAllergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealRecord_userId_eatenAt_idx" ON "MealRecord"("userId", "eatenAt");

-- CreateIndex
CREATE UNIQUE INDEX "MealRecord_userId_clientRequestId_key" ON "MealRecord"("userId", "clientRequestId");

-- CreateIndex
CREATE INDEX "MealItem_mealId_idx" ON "MealItem"("mealId");

-- CreateIndex
CREATE INDEX "MealItem_dishId_idx" ON "MealItem"("dishId");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_userId_key" ON "NutritionTarget"("userId");

-- CreateIndex
CREATE INDEX "CanteenDish_category_idx" ON "CanteenDish"("category");

-- CreateIndex
CREATE INDEX "CanteenDish_deletedAt_idx" ON "CanteenDish"("deletedAt");

-- AddForeignKey
ALTER TABLE "MealRecord" ADD CONSTRAINT "MealRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealItem" ADD CONSTRAINT "MealItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "MealRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealItem" ADD CONSTRAINT "MealItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "CanteenDish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionTarget" ADD CONSTRAINT "NutritionTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

