-- wildlife：猫/鸟/黑天鹅活动区域与轨迹（规格 docs/features/wildlife-map.md §2 / §7）
--
-- 本迁移做两件事：
--   1. **删除脚手架生成的占位 `WildlifeSpot` 表**（字段是 species/place/lat/lng/status，
--      与规格 §2.3 的"算法聚类热点"完全不是一回事，保留它只会让后来者困惑）；
--   2. 建规格 §7 的 8 张表：SpeciesTaxonomy / WildlifeZone / WildlifeSighting /
--      WildlifeSightingExact / WildlifeIndividual / WildlifeMedia / WildlifeSpot / WildlifeTrack。
--
-- 全局约定（规格 §3.2）：所有 lat/lng 列的语义都是 **WGS84**，且经纬度用
-- `DECIMAL(10,7)`（≈1.1cm 分辨率）；禁止出现 gcjLat/gcjLng 这类持久化列。
--
-- ⚠️ 精确坐标只在 `WildlifeSightingExact`（受限表，读取需审计）。
--    `WildlifeSighting.geoLat/geoLng` 存的是**已模糊化**的可公开坐标。
--
-- 生成方式（离线，无 PostgreSQL）：
--   cd services/api && npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
--   然后只摘出 wildlife 相关块（表 / 索引 / **外键**），保证 DDL 与 Prisma 自己产出的完全一致。
--   外键块刻意不能漏：漏掉它们表仍能建起来（所以肉眼看不出来），
--   但引用完整性就没了 —— 由 `scripts/verify-wildlife-migration.mjs` 断言。

-- 1. 删除脚手架占位表（连同它的索引）
DROP TABLE IF EXISTS "WildlifeSpot";

-- CreateTable
CREATE TABLE "SpeciesTaxonomy" (
    "id" TEXT NOT NULL,
    "scientificName" TEXT NOT NULL,
    "commonNameZh" TEXT NOT NULL,
    "commonNameEn" TEXT,
    "taxonRank" TEXT NOT NULL DEFAULT 'species',
    "parentId" TEXT,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "isNestingSensitive" BOOLEAN NOT NULL DEFAULT false,
    "nestingMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "defaultFeedingPolicy" TEXT NOT NULL DEFAULT 'discouraged',
    "externalIds" JSONB NOT NULL DEFAULT '{}',
    "iconUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "needsFieldVerification" BOOLEAN NOT NULL DEFAULT true,
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpeciesTaxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "speciesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "centerLat" DECIMAL(10,7) NOT NULL,
    "centerLng" DECIMAL(10,7) NOT NULL,
    "radiusM" INTEGER NOT NULL,
    "feedingPolicy" TEXT NOT NULL DEFAULT 'discouraged',
    "note" TEXT,
    "fuzzRadiusM" INTEGER NOT NULL DEFAULT 50,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "sensitiveRing" JSONB,
    "noticeText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WildlifeZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSighting" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT,
    "species" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "geoLat" DECIMAL(10,7),
    "geoLng" DECIMAL(10,7),
    "geoFuzzLevel" TEXT NOT NULL DEFAULT 'grid',
    "fuzzRadiusM" INTEGER NOT NULL DEFAULT 50,
    "gridCellKey" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "healthConcern" BOOLEAN NOT NULL DEFAULT false,
    "reporterId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "observedAtFuzzed" TIMESTAMP(3) NOT NULL,
    "publishDelayDays" INTEGER NOT NULL DEFAULT 0,
    "individualId" TEXT,
    "autoSpeciesId" TEXT,
    "autoConfidence" DECIMAL(4,3),
    "classifiedBy" TEXT NOT NULL DEFAULT 'manual',
    "correctedFromSpeciesId" TEXT,
    "note" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WildlifeSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSightingExact" (
    "sightingId" TEXT NOT NULL,
    "exactLat" DECIMAL(10,7) NOT NULL,
    "exactLng" DECIMAL(10,7) NOT NULL,
    "exactAccuracyM" INTEGER,
    "exactObservedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WildlifeSightingExact_pkey" PRIMARY KEY ("sightingId")
);

-- CreateTable
CREATE TABLE "WildlifeIndividual" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "description" TEXT,
    "coverPhotoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WildlifeIndividual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeMedia" (
    "id" TEXT NOT NULL,
    "sightingId" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "clientPhotoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildlifeMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSpot" (
    "id" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "zoneId" TEXT,
    "centroidLat" DECIMAL(10,7) NOT NULL,
    "centroidLng" DECIMAL(10,7) NOT NULL,
    "radiusM" INTEGER NOT NULL,
    "sightingCount" INTEGER NOT NULL,
    "distinctReporters" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "hourHistogram" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "confidence" DECIMAL(4,3) NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildlifeSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeTrack" (
    "id" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "individualId" TEXT,
    "spotIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pathGeoJson" JSONB NOT NULL,
    "totalDistanceM" INTEGER NOT NULL,
    "spanStartAt" TIMESTAMP(3) NOT NULL,
    "spanEndAt" TIMESTAMP(3) NOT NULL,
    "sightingCount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'dbscan-chain',
    "confidence" DECIMAL(4,3) NOT NULL,
    "isInferred" BOOLEAN NOT NULL DEFAULT true,
    "algorithmVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildlifeTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesTaxonomy_scientificName_key" ON "SpeciesTaxonomy"("scientificName");

-- CreateIndex
CREATE INDEX "SpeciesTaxonomy_taxonRank_isActive_idx" ON "SpeciesTaxonomy"("taxonRank", "isActive");

-- CreateIndex
CREATE INDEX "WildlifeZone_isSensitive_idx" ON "WildlifeZone"("isSensitive");

-- CreateIndex
CREATE INDEX "WildlifeZone_sortOrder_idx" ON "WildlifeZone"("sortOrder");

-- CreateIndex
CREATE INDEX "WildlifeSighting_species_status_observedAt_idx" ON "WildlifeSighting"("species", "status", "observedAt");

-- CreateIndex
CREATE INDEX "WildlifeSighting_geoLat_geoLng_idx" ON "WildlifeSighting"("geoLat", "geoLng");

-- CreateIndex
CREATE INDEX "WildlifeSighting_status_createdAt_idx" ON "WildlifeSighting"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WildlifeSighting_healthConcern_status_idx" ON "WildlifeSighting"("healthConcern", "status");

-- CreateIndex
CREATE INDEX "WildlifeSighting_gridCellKey_observedAt_idx" ON "WildlifeSighting"("gridCellKey", "observedAt");

-- CreateIndex
CREATE INDEX "WildlifeSighting_reporterId_createdAt_idx" ON "WildlifeSighting"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "WildlifeIndividual_status_createdAt_idx" ON "WildlifeIndividual"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeIndividual_speciesId_name_key" ON "WildlifeIndividual"("speciesId", "name");

-- CreateIndex
CREATE INDEX "WildlifeMedia_sha256_idx" ON "WildlifeMedia"("sha256");

-- CreateIndex
CREATE INDEX "WildlifeMedia_sightingId_sortOrder_idx" ON "WildlifeMedia"("sightingId", "sortOrder");

-- CreateIndex
CREATE INDEX "WildlifeMedia_sightingId_createdAt_idx" ON "WildlifeMedia"("sightingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeMedia_sightingId_clientPhotoId_key" ON "WildlifeMedia"("sightingId", "clientPhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeMedia_uploadedBy_clientPhotoId_key" ON "WildlifeMedia"("uploadedBy", "clientPhotoId");

-- CreateIndex
CREATE INDEX "WildlifeSpot_speciesId_computedAt_idx" ON "WildlifeSpot"("speciesId", "computedAt");

-- CreateIndex
CREATE INDEX "WildlifeSpot_computedAt_idx" ON "WildlifeSpot"("computedAt");

-- CreateIndex
CREATE INDEX "WildlifeTrack_speciesId_computedAt_idx" ON "WildlifeTrack"("speciesId", "computedAt");

-- CreateIndex
CREATE INDEX "WildlifeTrack_computedAt_idx" ON "WildlifeTrack"("computedAt");

-- AddForeignKey
ALTER TABLE "SpeciesTaxonomy" ADD CONSTRAINT "SpeciesTaxonomy_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SpeciesTaxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "WildlifeZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_species_fkey" FOREIGN KEY ("species") REFERENCES "SpeciesTaxonomy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_individualId_fkey" FOREIGN KEY ("individualId") REFERENCES "WildlifeIndividual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSightingExact" ADD CONSTRAINT "WildlifeSightingExact_sightingId_fkey" FOREIGN KEY ("sightingId") REFERENCES "WildlifeSighting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeIndividual" ADD CONSTRAINT "WildlifeIndividual_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "SpeciesTaxonomy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeMedia" ADD CONSTRAINT "WildlifeMedia_sightingId_fkey" FOREIGN KEY ("sightingId") REFERENCES "WildlifeSighting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSpot" ADD CONSTRAINT "WildlifeSpot_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "SpeciesTaxonomy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSpot" ADD CONSTRAINT "WildlifeSpot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "WildlifeZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeTrack" ADD CONSTRAINT "WildlifeTrack_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "SpeciesTaxonomy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
