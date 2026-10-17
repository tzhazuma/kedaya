-- CreateTable
CREATE TABLE "ClientEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "traceId" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "context" JSONB,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientEvent_createdAt_idx" ON "ClientEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClientEvent_kind_createdAt_idx" ON "ClientEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientEvent_userId_createdAt_idx" ON "ClientEvent"("userId", "createdAt");
