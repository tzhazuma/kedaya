-- 校园邮箱接入（IMAP 只读）+ 归一后的活动
--
-- 安全边界（与 schema.prisma 的模型注释一致）：
--   1. MailAccount.passwordCipher 是 AES-256-GCM 密文，绝不存明文密码；
--   2. 没有 SMTP / 发信相关表；本模块只读收信；
--   3. MailEvent 只存归一后的活动与 UID / 收信时刻 / 命中时间片段，
--      不存邮件正文、附件、附件名；
--   4. 解绑 = 硬删 MailAccount 行，MailEvent 通过外键级联删除。
--   5. status = 'stale' 仅表示上次同步失败；应用层会保留旧活动，不清空。

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "passwordCipher" TEXT NOT NULL,
    "cipherKeyId" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_userId_key" ON "MailAccount"("userId");

-- CreateIndex
CREATE INDEX "MailAccount_status_idx" ON "MailAccount"("status");

-- CreateTable
CREATE TABLE "MailEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "organizer" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchedText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailEvent_accountId_uid_key" ON "MailEvent"("accountId", "uid");

-- CreateIndex
CREATE INDEX "MailEvent_userId_startsAt_idx" ON "MailEvent"("userId", "startsAt");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEvent" ADD CONSTRAINT "MailEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEvent" ADD CONSTRAINT "MailEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
