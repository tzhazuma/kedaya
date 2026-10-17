-- CreateTable
CREATE TABLE "WildlifeAnimal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "avatarId" TEXT,
    "appearance" TEXT NOT NULL DEFAULT '',
    "commonArea" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "moderationStatus" TEXT NOT NULL DEFAULT 'public',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WildlifeAnimal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSighting" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "locationBlurred" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "animalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "moderationStatus" TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WildlifeSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeImage" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildlifeImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSightingPhoto" (
    "id" TEXT NOT NULL,
    "sightingId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WildlifeSightingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WildlifeAnimal_category_createdAt_id_idx" ON "WildlifeAnimal"("category", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WildlifeAnimal_name_idx" ON "WildlifeAnimal"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeAnimal_createdBy_clientRequestId_key" ON "WildlifeAnimal"("createdBy", "clientRequestId");

-- CreateIndex
CREATE INDEX "WildlifeSighting_latitude_longitude_idx" ON "WildlifeSighting"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "WildlifeSighting_category_observedAt_id_idx" ON "WildlifeSighting"("category", "observedAt", "id");

-- CreateIndex
CREATE INDEX "WildlifeSighting_animalId_observedAt_id_idx" ON "WildlifeSighting"("animalId", "observedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeSighting_createdBy_clientRequestId_key" ON "WildlifeSighting"("createdBy", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeImage_filename_key" ON "WildlifeImage"("filename");

-- CreateIndex
CREATE INDEX "WildlifeImage_createdBy_createdAt_idx" ON "WildlifeImage"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "WildlifeSightingPhoto_sightingId_sortOrder_idx" ON "WildlifeSightingPhoto"("sightingId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WildlifeSightingPhoto_sightingId_imageId_key" ON "WildlifeSightingPhoto"("sightingId", "imageId");

-- AddForeignKey
ALTER TABLE "WildlifeAnimal" ADD CONSTRAINT "WildlifeAnimal_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeAnimal" ADD CONSTRAINT "WildlifeAnimal_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "WildlifeImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSighting" ADD CONSTRAINT "WildlifeSighting_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "WildlifeAnimal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeImage" ADD CONSTRAINT "WildlifeImage_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSightingPhoto" ADD CONSTRAINT "WildlifeSightingPhoto_sightingId_fkey" FOREIGN KEY ("sightingId") REFERENCES "WildlifeSighting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WildlifeSightingPhoto" ADD CONSTRAINT "WildlifeSightingPhoto_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "WildlifeImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
