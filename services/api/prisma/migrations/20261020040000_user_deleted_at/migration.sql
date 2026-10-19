-- 账号注销（PIPL 自助注销）
--
-- 为什么只加一列、不建新表：
--   `User` 被 60+ 个模型引用。注销时若物理删除这一行，他的论坛帖子、
--   已成团的拼单、场馆预约会全部变成孤儿（别人页面上出现空洞），
--   而交易类记录本身还有留存义务。
--
-- 所以注销 = **撤销身份 + 匿名化 + 打时间戳**，业务内容保留。
-- 这一列就是"这个人是否已注销"的唯一真相。
--
-- ⚠️ 所有查询用户资料的地方都必须按 `deletedAt IS NULL` 过滤。
--    最关键的落点是 `UserPrismaRepository.findById` —— JWT 是无状态的，
--    旧 access token 签名在注销后依然有效；不过滤的话
--    「注销后立即失效」就是一句空话。
--
-- 索引：按 deletedAt 过滤是热路径（每次鉴权都要查），加索引避免全表扫描。

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
