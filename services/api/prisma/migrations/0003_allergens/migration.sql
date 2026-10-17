-- 过敏原 / 忌口
--
-- CanteenDish.allergens：菜品标注（机器值），空数组 = 未标注（不等于「无过敏原」）
-- NutritionTarget.avoidAllergens：用户勾选的忌口，推荐阶段硬过滤
ALTER TABLE "CanteenDish"
  ADD COLUMN "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "NutritionTarget"
  ADD COLUMN "avoidAllergens" TEXT[] DEFAULT ARRAY[]::TEXT[];
