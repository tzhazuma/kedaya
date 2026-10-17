-- ============================================================================
-- 联系方式交换（U8）· contact-exchange —— 迁移
--   契约 docs/architecture/00-FROZEN-CONTRACT.md §9（隐私：显式二次同意）
--   规格 docs/features/buddy-matching.md §6.2（联系方式交换的跨模块依赖）
--
-- ## 本迁移做什么
--
-- 1. 新增 `ContactEntry` —— 用户维护的可交换联系方式条目。
--    · 明文只以 AES-256-GCM 密文存 `valueCipher`；
--    · `valueFingerprint` 是**带密钥的** HMAC-SHA256（不是裸 SHA-256，
--      手机号低熵，裸哈希可被彩虹表反查）；
--    · `shared` 默认 false —— 默认不参与任何交换。
-- 2. 新增 `ContactExchangeRequest` —— 双方同意的关系本身。
--    · 交换的是**读取权限**，不是联系方式副本；撤销立即生效。
-- 3. 新增 `ContactAccessAudit` —— 查看审计。
--    · 只存 `entryIds` / `entryKinds` / 时间，**不存 value / 密文 / 指纹**。
--
-- ## 手写部分（Prisma schema 表达不了的约束）
--
-- `ContactExchangeRequest_pair_active_key` 是一条**部分唯一索引**：
-- 同一对用户最多只能有一条 `PENDING`/`ACCEPTED` 申请。
-- Prisma schema 不支持 partial unique index，因此只存在于本迁移。
-- 应用层会先做友好检查，并发下由数据库兜底（P2002 → CONFLICT）。
-- 过期申请会先被惰性置为 `EXPIRED`，从而释放这条唯一索引。
--
-- ## 生成方式（可复现）
--
-- ```bash
-- git show HEAD:services/api/prisma/schema.prisma > /tmp/old.prisma
-- cd services/api
-- npx prisma migrate diff --from-schema /tmp/old.prisma \
--     --to-schema prisma/schema.prisma --script
-- ```
-- 上面命令的输出**逐字**写入本文件（再追加部分唯一索引 + 本注释），
-- 因此与 schema 零漂移。
-- ============================================================================

-- CreateTable
CREATE TABLE "ContactEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "valueCipher" TEXT NOT NULL,
    "valueFingerprint" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactExchangeRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "contextModule" TEXT NOT NULL,
    "contextId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "ContactExchangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAccessAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'view_contacts',
    "entryIds" TEXT[],
    "entryKinds" TEXT[],
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactEntry_userId_createdAt_idx" ON "ContactEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactEntry_userId_shared_idx" ON "ContactEntry"("userId", "shared");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEntry_userId_kind_valueFingerprint_key" ON "ContactEntry"("userId", "kind", "valueFingerprint");

-- CreateIndex
CREATE INDEX "ContactExchangeRequest_requesterId_createdAt_idx" ON "ContactExchangeRequest"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactExchangeRequest_addresseeId_createdAt_idx" ON "ContactExchangeRequest"("addresseeId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactExchangeRequest_pairKey_createdAt_idx" ON "ContactExchangeRequest"("pairKey", "createdAt");

-- CreateIndex
CREATE INDEX "ContactExchangeRequest_status_expiresAt_idx" ON "ContactExchangeRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ContactAccessAudit_subjectId_at_idx" ON "ContactAccessAudit"("subjectId", "at");

-- CreateIndex
CREATE INDEX "ContactAccessAudit_actorId_at_idx" ON "ContactAccessAudit"("actorId", "at");

-- CreateIndex
CREATE INDEX "ContactAccessAudit_requestId_at_idx" ON "ContactAccessAudit"("requestId", "at");

-- AddForeignKey
ALTER TABLE "ContactEntry" ADD CONSTRAINT "ContactEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchangeRequest" ADD CONSTRAINT "ContactExchangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchangeRequest" ADD CONSTRAINT "ContactExchangeRequest_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAccessAudit" ADD CONSTRAINT "ContactAccessAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAccessAudit" ADD CONSTRAINT "ContactAccessAudit_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAccessAudit" ADD CONSTRAINT "ContactAccessAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ContactExchangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ----------------------------------------------------------------------------
-- 手写：同一对用户最多一条活跃申请（PENDING / ACCEPTED）
-- 撤销 / 拒绝 / 过期后索引释放，允许重新发起。
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "ContactExchangeRequest_pair_active_key"
    ON "ContactExchangeRequest" ("pairKey")
    WHERE "status" IN ('PENDING', 'ACCEPTED');
