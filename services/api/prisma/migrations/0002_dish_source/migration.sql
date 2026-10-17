-- 菜品营养数据的「来源」与「最后核对时间」
--
-- 为什么加这两列：营养值全部来自人工录入，用户/评委有权知道这个数字凭什么可信。
-- 界面展示形如「来源：二食堂公示 · 更新于 2026-10-12」（ADR 0006 C2）。
ALTER TABLE "CanteenDish"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);
