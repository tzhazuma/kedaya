-- 校园卡（契约 §11.21-B / §11.19-A）
--
-- 这个迁移此前**只改了 schema.prisma，没有生成迁移** —— 于是测试夹具
-- `test/fixtures/pglite-prisma.ts` 里写着的目录名存在、SQL 不存在，
-- 导致 techpie-db / buddy-db 等一整套真库测试直接失败。
--
-- 本迁移只做两件事，都是**重命名/默认值**级别，不动数据语义：
--   1. CampusCardTransaction.happenedAt → occurredAt
--      （契约 §11.21-B：`happenedAt` 与契约字段名不一致，统一为 `occurredAt`）
--   2. TechpieLink.status 默认值 UNLINKED → PENDING
--      （契约 §11.19-A：新链接的初始态是"待核对"，不是"未关联"）

-- 1. 重命名时间列。PostgreSQL 的 RENAME COLUMN 不重写数据，是纯元数据操作。
ALTER TABLE "CampusCardTransaction" RENAME COLUMN "happenedAt" TO "occurredAt";

-- 索引名跟着改，否则 `@@index([userId, occurredAt])` 与库里的名字不一致，
-- `prisma migrate diff` 会一直报 drift。
DROP INDEX IF EXISTS "CampusCardTransaction_userId_happenedAt_idx";
CREATE INDEX "CampusCardTransaction_userId_occurredAt_idx"
  ON "CampusCardTransaction"("userId", "occurredAt");

-- 2. TechpieLink.status 默认值。
ALTER TABLE "TechpieLink" ALTER COLUMN "status" SET DEFAULT 'PENDING';
