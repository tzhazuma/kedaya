-- 活动提醒：可回收的派发租约 + 仅约束活跃行的唯一键
--
-- 1. `attempts` / `lastError`：派发抢占时 attempts + 1；失败未到上限回退 pending，
--    达到上限标记 failed（列表可查），不再无限重试。
-- 2. 原来的全表唯一键 `(activityId, dedupeKey)` 与 `(activityId, kind, remindAt)`
--    会让**已 sent / cancelled** 的默认提醒挡住活动改期后重建的提醒
--    （createMany(skipDuplicates) 会静默丢掉新行）。改成部分唯一索引，
--    只约束 pending/sending：历史保留，活跃提醒仍然不会重复。
--
-- ⚠️ 部分唯一索引无法写进 Prisma schema（`@@unique` 不支持 WHERE），
--    因此 schema.prisma 里刻意没有这两个 @@unique，唯一性由本迁移保证。

ALTER TABLE "ActivityReminder"
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT;

DROP INDEX "ActivityReminder_activityId_dedupeKey_key";
DROP INDEX "ActivityReminder_activityId_kind_remindAt_key";

CREATE UNIQUE INDEX "ActivityReminder_active_dedupeKey_key"
    ON "ActivityReminder"("activityId", "dedupeKey")
    WHERE "status" IN ('pending', 'sending') AND "dedupeKey" IS NOT NULL;

CREATE UNIQUE INDEX "ActivityReminder_active_kind_remindAt_key"
    ON "ActivityReminder"("activityId", "kind", "remindAt")
    WHERE "status" IN ('pending', 'sending');
