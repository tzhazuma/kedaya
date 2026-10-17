-- AlterTable
ALTER TABLE "TakeoutReport" ALTER COLUMN "status" SET DEFAULT 'pending';

-- 存量数据：旧脚手架写的是 'reported'，而接口白名单只认 pending | escalated | resolved。
-- 不迁移的话这些行仍然"存在但筛不出来"（按状态筛永远命中不到），
-- 详情页的时间线也只能按 pending 兜底显示 —— 属于静默不一致，不是良性差异。
UPDATE "TakeoutReport" SET "status" = 'pending' WHERE "status" = 'reported';
