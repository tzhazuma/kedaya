-- ============================================================================
-- TechPie 整合 · techpie —— Phase 0 迁移
--   规格 docs/features/techpie-integration.md §5 / §9.1
--   裁决 docs/architecture/00-FROZEN-CONTRACT.md §11.18
--
-- ## 本迁移做什么
--
-- 1. **重塑 `TechpieLink`**：脚手架占位形状（key/name/category/url）替换为契约
--    §2.9 + 规格 §5.1 的绑定形状。`provider` 按契约 §11.10-B 裁决为**校园平台**
--    语义（`cas | egate | cpdaily | ecard | techpie`），与 `CampusBinding.platform` 同一套。
-- 2. **新增 `TechpieSyncJob`**（契约 §2.9 + 规格 §5.2）。
-- 3. **新增 `CampusSession`**（规格 §5.3）—— 校园会话密文的唯一落点。
--
-- ## ⚠️ 合规硬约束（规格 §11.18-D / 本迁移**不**做什么）
--
-- 本迁移**只建表，不产生任何凭证副本**。特别是：
--   · `CampusSession` 在 Phase 0 **只有 `ecard`（OPENID 通道）一个写入者**；
--   · 需要代持 CASTGC 的平台（`egate` / `cpdaily`）在信息办**书面回复**（U7）之前
--     **没有任何写入路径** —— 不是"先做着等批准"，而是根本不做：
--     一旦落库就有了未经授权的凭证副本，事后清理无法消除已发生的风险。
--   · `TechpieLink.tokenCipher` 保留是为了对齐契约 §2.9 的冻结字段，
--     Phase 0 **没有任何写入者**（Gradescope/Hydro 的第三方 token 属 U13）。
--
-- ## 生成方式（可复现）
--
-- ```bash
-- git show HEAD:services/api/prisma/schema.prisma > /tmp/old.prisma   # 本迁移之前的 schema
-- npx prisma migrate diff --from-schema /tmp/old.prisma \
--     --to-schema services/api/prisma/schema.prisma --script
-- ```
-- 输出**逐字**写入本文件，因此与 schema 零漂移。
-- 漂移由 `npm run test -w @kedaya/api`（`test/techpie-db.spec.ts` 用 PGlite
-- 真实执行全部四份迁移 + `prisma migrate diff --exit-code`）持续验证。
-- ============================================================================

-- DropIndex
DROP INDEX "TechpieLink_key_key";

-- DropIndex
DROP INDEX "TechpieLink_category_status_idx";

-- AlterTable
ALTER TABLE "TechpieLink" DROP COLUMN "category",
DROP COLUMN "key",
DROP COLUMN "name",
DROP COLUMN "url",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "externalUserId" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL,
ADD COLUMN     "tokenCipher" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'UNLINKED';

-- CreateTable
CREATE TABLE "TechpieSyncJob" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechpieSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sessionCipher" TEXT NOT NULL,
    "cipherKeyId" TEXT NOT NULL,
    "externalUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastRenewedAt" TIMESTAMP(3),
    "renewFailCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechpieSyncJob_status_nextRetryAt_idx" ON "TechpieSyncJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "TechpieSyncJob_linkId_createdAt_idx" ON "TechpieSyncJob"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "CampusSession_status_expiresAt_idx" ON "CampusSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampusSession_userId_platform_key" ON "CampusSession"("userId", "platform");

-- CreateIndex
CREATE INDEX "TechpieLink_status_expiresAt_idx" ON "TechpieLink"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechpieLink_userId_provider_key" ON "TechpieLink"("userId", "provider");

-- AddForeignKey
ALTER TABLE "TechpieLink" ADD CONSTRAINT "TechpieLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechpieSyncJob" ADD CONSTRAINT "TechpieSyncJob_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TechpieLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusSession" ADD CONSTRAINT "CampusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

