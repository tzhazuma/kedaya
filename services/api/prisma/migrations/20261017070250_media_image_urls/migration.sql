-- AlterTable
ALTER TABLE "FleaItem" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ForumPost" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LostFoundItem" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
