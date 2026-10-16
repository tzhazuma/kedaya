-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "department" TEXT,
    "anonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "realName" TEXT,
    "department" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "encryptedSession" TEXT NOT NULL,
    "sessionFingerprint" TEXT,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "ua" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "module" TEXT,
    "ip" TEXT,
    "ua" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupbuyOrder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "unitPriceFen" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "deadline" TIMESTAMP(3) NOT NULL,
    "pickupSpot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupbuyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupbuyMember" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "paidFen" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupbuyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoutReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "anonHandle" TEXT,
    "orderNo" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "evidenceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakeoutReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleaItem" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceFen" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "campusSpot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'on-sale',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DormHarmonyCase" (
    "id" TEXT NOT NULL,
    "anonHandle" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "mediatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DormHarmonyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrandTask" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "runnerId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "rewardFen" INTEGER NOT NULL,
    "fromPlace" TEXT NOT NULL,
    "toPlace" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrandTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuddyGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "campusSpot" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recruiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFoundItem" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "place" TEXT NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "contactHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenDish" (
    "id" TEXT NOT NULL,
    "canteen" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "caloriesKcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "carbG" INTEGER NOT NULL,
    "priceFen" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumBoard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "authorId" TEXT,
    "anonHandle" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReply" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentReplyId" TEXT,
    "authorId" TEXT,
    "anonHandle" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReport" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reporterId" TEXT,
    "reporterKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPortraitProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "traits" JSONB NOT NULL,
    "explain" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPortraitProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellbeingAppointment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counselor" TEXT NOT NULL,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'onsite',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "crisisFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WellbeingAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "unhelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqHelpfulVote" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "voterKey" TEXT NOT NULL,
    "vote" TEXT NOT NULL DEFAULT 'helpful',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqHelpfulVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "contact" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "suggestedEntryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityBooking" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "facilityName" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "feeFen" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechpieLink" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechpieLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WildlifeSpot" (
    "id" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "reportedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WildlifeSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleCourse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "teacher" TEXT,
    "location" TEXT,
    "weekday" INTEGER NOT NULL,
    "startSlot" INTEGER NOT NULL,
    "endSlot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusCardTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "balanceAfterFen" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampusCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showRealName" BOOLEAN NOT NULL DEFAULT false,
    "allowAiPortrait" BOOLEAN NOT NULL DEFAULT false,
    "allowWellbeing" BOOLEAN NOT NULL DEFAULT false,
    "allowDormHarmony" BOOLEAN NOT NULL DEFAULT false,
    "themeMode" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'inapp',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_externalId_key" ON "AuthIdentity"("provider", "externalId");

-- CreateIndex
CREATE INDEX "CampusBinding_userId_status_idx" ON "CampusBinding"("userId", "status");

-- CreateIndex
CREATE INDEX "CampusBinding_expiresAt_idx" ON "CampusBinding"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampusBinding_userId_platform_key" ON "CampusBinding"("userId", "platform");

-- CreateIndex
CREATE INDEX "Consent_userId_module_revokedAt_idx" ON "Consent"("userId", "module", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_userId_module_key" ON "Consent"("userId", "module");

-- CreateIndex
CREATE INDEX "AuditLog_module_at_idx" ON "AuditLog"("module", "at");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "GroupbuyOrder_status_deadline_idx" ON "GroupbuyOrder"("status", "deadline");

-- CreateIndex
CREATE INDEX "GroupbuyOrder_category_idx" ON "GroupbuyOrder"("category");

-- CreateIndex
CREATE INDEX "GroupbuyMember_userId_idx" ON "GroupbuyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupbuyMember_orderId_userId_key" ON "GroupbuyMember"("orderId", "userId");

-- CreateIndex
CREATE INDEX "TakeoutReport_status_happenedAt_idx" ON "TakeoutReport"("status", "happenedAt");

-- CreateIndex
CREATE INDEX "TakeoutReport_anonHandle_idx" ON "TakeoutReport"("anonHandle");

-- CreateIndex
CREATE INDEX "FleaItem_status_category_idx" ON "FleaItem"("status", "category");

-- CreateIndex
CREATE INDEX "FleaItem_priceFen_idx" ON "FleaItem"("priceFen");

-- CreateIndex
CREATE INDEX "DormHarmonyCase_status_building_idx" ON "DormHarmonyCase"("status", "building");

-- CreateIndex
CREATE INDEX "DormHarmonyCase_anonHandle_idx" ON "DormHarmonyCase"("anonHandle");

-- CreateIndex
CREATE INDEX "ErrandTask_status_deadline_idx" ON "ErrandTask"("status", "deadline");

-- CreateIndex
CREATE INDEX "ErrandTask_rewardFen_idx" ON "ErrandTask"("rewardFen");

-- CreateIndex
CREATE INDEX "BuddyGroup_status_startsAt_idx" ON "BuddyGroup"("status", "startsAt");

-- CreateIndex
CREATE INDEX "BuddyGroup_activity_idx" ON "BuddyGroup"("activity");

-- CreateIndex
CREATE INDEX "LostFoundItem_kind_status_idx" ON "LostFoundItem"("kind", "status");

-- CreateIndex
CREATE INDEX "LostFoundItem_happenedAt_idx" ON "LostFoundItem"("happenedAt");

-- CreateIndex
CREATE INDEX "CanteenDish_canteen_idx" ON "CanteenDish"("canteen");

-- CreateIndex
CREATE INDEX "CanteenDish_caloriesKcal_idx" ON "CanteenDish"("caloriesKcal");

-- CreateIndex
CREATE UNIQUE INDEX "ForumBoard_slug_key" ON "ForumBoard"("slug");

-- CreateIndex
CREATE INDEX "ForumBoard_visibility_idx" ON "ForumBoard"("visibility");

-- CreateIndex
CREATE INDEX "ForumPost_boardId_status_createdAt_idx" ON "ForumPost"("boardId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_anonHandle_idx" ON "ForumPost"("anonHandle");

-- CreateIndex
CREATE INDEX "ForumPost_status_createdAt_idx" ON "ForumPost"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ForumReply_postId_createdAt_idx" ON "ForumReply"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumReply_postId_status_idx" ON "ForumReply"("postId", "status");

-- CreateIndex
CREATE INDEX "ForumReply_parentReplyId_idx" ON "ForumReply"("parentReplyId");

-- CreateIndex
CREATE INDEX "ForumReport_targetId_status_idx" ON "ForumReport"("targetId", "status");

-- CreateIndex
CREATE INDEX "ForumReport_status_createdAt_idx" ON "ForumReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReport_targetType_targetId_reporterKey_key" ON "ForumReport"("targetType", "targetId", "reporterKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiPortraitProfile_userId_key" ON "AiPortraitProfile"("userId");

-- CreateIndex
CREATE INDEX "WellbeingAppointment_userId_slotAt_idx" ON "WellbeingAppointment"("userId", "slotAt");

-- CreateIndex
CREATE INDEX "WellbeingAppointment_status_idx" ON "WellbeingAppointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FaqEntry_slug_key" ON "FaqEntry"("slug");

-- CreateIndex
CREATE INDEX "FaqEntry_category_status_idx" ON "FaqEntry"("category", "status");

-- CreateIndex
CREATE INDEX "FaqHelpfulVote_entryId_idx" ON "FaqHelpfulVote"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "FaqHelpfulVote_entryId_voterKey_key" ON "FaqHelpfulVote"("entryId", "voterKey");

-- CreateIndex
CREATE INDEX "FaqTicket_userId_createdAt_idx" ON "FaqTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FaqTicket_status_createdAt_idx" ON "FaqTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_ownerId_startsAt_idx" ON "FacilityBooking"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_kind_startsAt_idx" ON "FacilityBooking"("kind", "startsAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_status_startsAt_idx" ON "FacilityBooking"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechpieLink_key_key" ON "TechpieLink"("key");

-- CreateIndex
CREATE INDEX "TechpieLink_category_status_idx" ON "TechpieLink"("category", "status");

-- CreateIndex
CREATE INDEX "WildlifeSpot_species_status_idx" ON "WildlifeSpot"("species", "status");

-- CreateIndex
CREATE INDEX "ScheduleCourse_userId_term_idx" ON "ScheduleCourse"("userId", "term");

-- CreateIndex
CREATE INDEX "ScheduleCourse_term_weekday_idx" ON "ScheduleCourse"("term", "weekday");

-- CreateIndex
CREATE INDEX "CampusCardTransaction_userId_happenedAt_idx" ON "CampusCardTransaction"("userId", "happenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSetting_userId_key" ON "ProfileSetting"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusBinding" ADD CONSTRAINT "CampusBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupbuyMember" ADD CONSTRAINT "GroupbuyMember_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GroupbuyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPortraitProfile" ADD CONSTRAINT "AiPortraitProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellbeingAppointment" ADD CONSTRAINT "WellbeingAppointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCourse" ADD CONSTRAINT "ScheduleCourse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusCardTransaction" ADD CONSTRAINT "CampusCardTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSetting" ADD CONSTRAINT "ProfileSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

