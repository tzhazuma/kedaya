-- ============================================================================
-- 合并对齐迁移（`main` 两个分支的迁移历史合并后的**单点对齐**）
--
-- ## 为什么需要这一份
--
-- 两个分支各自从 M0 骨架（无任何迁移）出发，**各自生成了自己的基线**：
--   · 本仓库（校园侧）：`20261016171043_init` + 5 份增量
--   · 另一分支（业务侧）：`20261017030000_init` + wildlife / buddy / techpie
-- 两份基线互不兼容（各自建了 30 张表，其中 25 张重名），
-- 合在一起执行时第二条 `_init` 会 `CREATE TABLE` 已存在的表而直接失败；
-- 而且两条线上的同表结构也有差异（`ForumPost.board` vs `boardId`、
-- `FaqEntry.slug`、`Notification.source` 等）。
--
-- 处置：**保留业务侧的四份迁移**（它们的校验脚本与测试夹具都以这些目录名为锚），
-- 把校园侧的全部 schema 差异收敛进这一份对齐迁移，并删除校园侧的 6 个迁移目录。
-- 对齐后的历史（按文件名排序）与 `prisma/schema.prisma` **零漂移**，
-- 由 `scripts/verify-schema-drift.mjs`（PGlite + `prisma migrate diff --exit-code`）持续验证。
--
-- ## 生成方式（可复现）
--
-- ```bash
-- git show <业务侧合并前的提交>:services/api/prisma/schema.prisma > /tmp/theirs.prisma
-- npx prisma migrate diff --from-schema /tmp/theirs.prisma \
--     --to-schema services/api/prisma/schema.prisma --script
-- ```
-- 第 3 段**逐字**写入本文件。第 1、2 段的语义变更无法由 datamodel 差异推导
-- （列改名、默认值、存量数据回填），因此手写并标注。
-- ============================================================================

-- ============================================================================
-- 1. 校园卡：列改名 + 默认值统一（原 `20261017070000_campus_card`）
--    契约 §11.21-B：`happenedAt` → `occurredAt`（与"发生时间"的语义对齐）；
--    契约 §11.19-A：`TechpieLink.status` 默认值统一为 `PENDING`。
-- ============================================================================

ALTER TABLE "CampusCardTransaction" RENAME COLUMN "happenedAt" TO "occurredAt";
ALTER INDEX "CampusCardTransaction_userId_happenedAt_idx" RENAME TO "CampusCardTransaction_userId_occurredAt_idx";
ALTER TABLE "TechpieLink" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ============================================================================
-- 2. 存量数据回填（原 `20261017091543_takeout_report_status_pending`）
--    新的默认值是 `pending`；已经写成 `reported` 的存量行需要跟上语义。
--    空库上是无操作（0 行），保留它是为了让"语义迁移"这条记录不丢。
-- ============================================================================

UPDATE "TakeoutReport" SET "status" = 'pending' WHERE "status" = 'reported';

-- ============================================================================
-- 3. schema 对齐（`prisma migrate diff` 生成，逐字，勿手改）
--    校园侧独有的表（邮箱密码账号、验证码、刷新会话 + 报告/埋点）与列。
-- ============================================================================

-- AlterTable
ALTER TABLE "TakeoutReport" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "FleaItem" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reservedById" TEXT,
ADD COLUMN     "soldAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DormHarmonyCase" ADD COLUMN     "expectation" TEXT,
ADD COLUMN     "trackCodeHash" TEXT;

-- AlterTable
ALTER TABLE "ErrandTask" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LostFoundItem" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'system';

-- CreateTable
CREATE TABLE "UserCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DormHarmonyMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromRole" TEXT NOT NULL DEFAULT 'student',
    "anonHandle" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DormHarmonyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "traceId" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "context" JSONB,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "targetAuthorId" TEXT,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_userId_key" ON "UserCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_email_key" ON "UserCredential"("email");

-- CreateIndex
CREATE INDEX "UserCredential_email_idx" ON "UserCredential"("email");

-- CreateIndex
CREATE INDEX "UserCredential_status_idx" ON "UserCredential"("status");

-- CreateIndex
CREATE INDEX "VerificationCode_target_purpose_createdAt_idx" ON "VerificationCode"("target", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_revokedAt_idx" ON "RefreshSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DormHarmonyMessage_caseId_createdAt_idx" ON "DormHarmonyMessage"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientEvent_createdAt_idx" ON "ClientEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClientEvent_kind_createdAt_idx" ON "ClientEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientEvent_userId_createdAt_idx" ON "ClientEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_escalated_createdAt_idx" ON "ContentReport"("escalated", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "FleaItem_sellerId_status_idx" ON "FleaItem"("sellerId", "status");

-- CreateIndex
CREATE INDEX "ErrandTask_requesterId_status_idx" ON "ErrandTask"("requesterId", "status");

-- CreateIndex
CREATE INDEX "ErrandTask_runnerId_status_idx" ON "ErrandTask"("runnerId", "status");

-- CreateIndex
CREATE INDEX "LostFoundItem_reporterId_status_idx" ON "LostFoundItem"("reporterId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleaItem" ADD CONSTRAINT "FleaItem_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DormHarmonyMessage" ADD CONSTRAINT "DormHarmonyMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DormHarmonyCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrandTask" ADD CONSTRAINT "ErrandTask_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrandTask" ADD CONSTRAINT "ErrandTask_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

