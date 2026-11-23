CREATE TABLE "PushTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "templateId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PushTarget_channel_token_key" ON "PushTarget"("channel", "token");
CREATE INDEX "PushTarget_userId_status_idx" ON "PushTarget"("userId", "status");

CREATE TABLE "PushDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "templateId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "source" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "claimedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PushDelivery_dedupeKey_key" ON "PushDelivery"("dedupeKey");
CREATE INDEX "PushDelivery_status_createdAt_idx" ON "PushDelivery"("status", "createdAt");
CREATE INDEX "PushDelivery_userId_createdAt_idx" ON "PushDelivery"("userId", "createdAt");


CREATE TABLE "OfficialAccountSubscription" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialAccountSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OfficialAccountSubscription_userId_accountKey_key" ON "OfficialAccountSubscription"("userId", "accountKey");
CREATE INDEX "OfficialAccountSubscription_accountKey_idx" ON "OfficialAccountSubscription"("accountKey");
