-- 校园活动独立域 + 邮件活动扩展字段
--
-- 安全边界（与 schema.prisma 的模型注释一致）：
--   1. Activity 只存活动字段与 ≤200 字 evidenceText，不存邮件正文/附件/公众号全文；
--   2. Activity.registrationDeadlineRaw 在时刻无法确定时保留原文，**不补 23:59**；
--   3. ActivityReminder 的 channel 目前只真正接通 inapp；wechat-subscribe 仅是契约占位；
--   4. Activity.mailAccountId / mailEventId 可空：解绑校园邮箱（删账户）或换邮箱
--      （清理旧 MailEvent）时级联删除由邮件提升的活动（连同其提醒）；
--      手动/微信来源不受影响；
--   5. 派发时用 FOR UPDATE SKIP LOCKED 原子抢占，避免多副本重复发。

-- AlterTable：MailEvent 扩展字段全部可空（旧行保持 null，不猜测）
ALTER TABLE "MailEvent"
    ADD COLUMN "kind" TEXT,
    ADD COLUMN "endsAt" TIMESTAMP(3),
    ADD COLUMN "registrationDeadlineAt" TIMESTAMP(3),
    ADD COLUMN "registrationDeadlineRaw" TEXT,
    ADD COLUMN "registrationUrl" TEXT;

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "organizer" TEXT,
    "registrationDeadlineAt" TIMESTAMP(3),
    "registrationDeadlineRaw" TEXT,
    "registrationUrl" TEXT,
    "evidenceText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "sourceUrl" TEXT,
    "sourceLabel" TEXT,
    "publishedAt" TIMESTAMP(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "mailAccountId" TEXT,
    "mailEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'inapp',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dedupeKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Activity_userId_source_sourceRef_key" ON "Activity"("userId", "source", "sourceRef");

-- CreateIndex
CREATE INDEX "Activity_userId_status_startsAt_idx" ON "Activity"("userId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Activity_mailAccountId_idx" ON "Activity"("mailAccountId");

-- CreateIndex
CREATE INDEX "Activity_mailEventId_idx" ON "Activity"("mailEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReminder_activityId_dedupeKey_key" ON "ActivityReminder"("activityId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReminder_activityId_kind_remindAt_key" ON "ActivityReminder"("activityId", "kind", "remindAt");

-- CreateIndex
CREATE INDEX "ActivityReminder_status_remindAt_idx" ON "ActivityReminder"("status", "remindAt");

-- CreateIndex
CREATE INDEX "ActivityReminder_userId_remindAt_idx" ON "ActivityReminder"("userId", "remindAt");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_mailEventId_fkey" FOREIGN KEY ("mailEventId") REFERENCES "MailEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReminder" ADD CONSTRAINT "ActivityReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReminder" ADD CONSTRAINT "ActivityReminder_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
