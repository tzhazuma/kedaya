-- ============================================================================
-- 找搭子 · buddy —— 手写迁移（规格 docs/features/buddy-matching.md §4.2 / §4.3）
--
-- ## 为什么必须手写
--
-- `BuddyProfile.embedding` / `BuddyPost.embedding` 的类型是
-- `Unsupported("vector(768)")`。Prisma **不能**为 `Unsupported` 生成迁移 DDL：
-- `prisma migrate dev` 只会生成一个空迁移让你自己填。因此本文件是手写的。
--
-- 建表语句取自 `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
-- 的**逐字输出**（含 `"embedding" vector(768)`），因此与 schema 零漂移 ——
-- 这一点由 `prisma migrate diff --from-migrations ... --to-schema ... --shadow-database-url`
-- 与 `scripts/verify-buddy-migration.mjs` 双重验证。
--
-- ## 前置条件与降级
--
-- `CREATE EXTENSION vector` 需要 superuser 或具备 CREATE EXTENSION 权限的角色。
-- **无权限时不要阻塞上线**：应用启动自检会降级到 `rule` 模式
-- （见 src/modules/buddy/domain/matching-mode.ts 与 data/buddy-capability.probe.ts）。
--
-- ## 为什么**不**建 HNSW 索引（规格 §4.3 的建议，刻意反直觉）
--
-- 上科大活跃 BuddyProfile 在几千量级，顺序扫描 + `ORDER BY <=> LIMIT 200`
-- 在 5ms 量级，**比 HNSW 更简单也更准**（HNSW 是近似检索，会漏真近邻）。
-- 小数据量下建 HNSW 是纯负债（建索引慢、内存高、还损失召回率）。
-- 门槛：`BuddyProfile` 行数 > 20,000 或推荐 P95 > 300ms 时才建。届时的 DDL：
--
--   CREATE INDEX CONCURRENTLY "BuddyProfile_embedding_hnsw_idx"
--     ON "BuddyProfile" USING hnsw ("embedding" vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
--
-- ⚠️ `vector_cosine_ops` 必须与查询用的 `<=>` 算子匹配，否则索引不会被使用。
-- ============================================================================

-- 1) pgvector 扩展。装在 vector 类型被引用**之前**（下面的 CREATE TABLE 用到它）。
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) 退休脚手架占位表。
--    它既不是冻结契约里的模型（契约 §2.3 冻结的是 BuddyPost / BuddyApplication），
--    也不承载规格 §3 的匹配特征；脚手架阶段无真实数据。
--    动作名与状态名一一对应：DELETE /items/:id → CANCELLED（规格 §5.2）。
DROP TABLE IF EXISTS "BuddyGroup";
-- CreateTable
CREATE TABLE "BuddyProfile" (
    "userId" TEXT NOT NULL,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interestTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skillLevel" TEXT DEFAULT 'casual',
    "availability" JSONB NOT NULL DEFAULT '[]',
    "preferredAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "department" TEXT,
    "bio" TEXT,
    "matchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(768),
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BuddyProfile_pkey" PRIMARY KEY ("userId")
);
-- CreateTable
CREATE TABLE "BuddyPost" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER,
    "capacity" INTEGER NOT NULL,
    "joinedCount" INTEGER NOT NULL DEFAULT 1,
    "genderPreference" TEXT NOT NULL DEFAULT 'any',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minSkillLevel" TEXT,
    "autoCloseAt" TIMESTAMP(3),
    "embedding" vector(768),
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BuddyPost_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BuddyApplication" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyApplication_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BuddyMatchFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetPostId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyMatchFeedback_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BuddyQuestionnaire" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyQuestionnaire_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BuddyQuestionnaireResponse" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyQuestionnaireResponse_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BuddyTag" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyTag_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "BuddyProfile_matchEnabled_idx" ON "BuddyProfile"("matchEnabled");
CREATE INDEX "BuddyPost_status_startsAt_idx" ON "BuddyPost"("status", "startsAt");
CREATE INDEX "BuddyPost_activity_status_startsAt_idx" ON "BuddyPost"("activity", "status", "startsAt");
CREATE INDEX "BuddyPost_creatorId_idx" ON "BuddyPost"("creatorId");
CREATE INDEX "BuddyApplication_applicantId_status_idx" ON "BuddyApplication"("applicantId", "status");
CREATE UNIQUE INDEX "BuddyApplication_postId_applicantId_key" ON "BuddyApplication"("postId", "applicantId");
CREATE INDEX "BuddyMatchFeedback_userId_section_createdAt_idx" ON "BuddyMatchFeedback"("userId", "section", "createdAt");
CREATE UNIQUE INDEX "BuddyMatchFeedback_userId_targetPostId_section_key" ON "BuddyMatchFeedback"("userId", "targetPostId", "section");
CREATE UNIQUE INDEX "BuddyQuestionnaire_slug_key" ON "BuddyQuestionnaire"("slug");
CREATE INDEX "BuddyQuestionnaire_section_isActive_idx" ON "BuddyQuestionnaire"("section", "isActive");
CREATE UNIQUE INDEX "BuddyQuestionnaireResponse_questionnaireId_userId_key" ON "BuddyQuestionnaireResponse"("questionnaireId", "userId");
CREATE INDEX "BuddyTag_group_isActive_idx" ON "BuddyTag"("group", "isActive");

ALTER TABLE "BuddyProfile" ADD CONSTRAINT "BuddyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyPost" ADD CONSTRAINT "BuddyPost_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyApplication" ADD CONSTRAINT "BuddyApplication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BuddyPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyApplication" ADD CONSTRAINT "BuddyApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyMatchFeedback" ADD CONSTRAINT "BuddyMatchFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyMatchFeedback" ADD CONSTRAINT "BuddyMatchFeedback_targetPostId_fkey" FOREIGN KEY ("targetPostId") REFERENCES "BuddyPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyQuestionnaireResponse" ADD CONSTRAINT "BuddyQuestionnaireResponse_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "BuddyQuestionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyQuestionnaireResponse" ADD CONSTRAINT "BuddyQuestionnaireResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
