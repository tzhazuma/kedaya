-- 群机器人接入：待确认草稿
--
-- 设计要点：
--   1. **不存发送者身份**：只留 `senderRef`（平台的 member_openid），
--      用于去重与审计；昵称/QQ 号一律不落库（那是个人信息，草稿不需要）。
--   2. **平台消息 id 唯一**：QQ 会重试投递，唯一约束保证幂等。
--   3. **status 单向**：pending → approved / rejected 由应用层强制，
--      数据库层用 CHECK 兜住"已处理的不能再处理"。
--   4. `candidates` 用 jsonb：解析结果是可变的（解析器升级后形状会变），
--      用 jsonb 比拆表更实际；它只供人看，不参与查询。

CREATE TABLE "GroupDraft" (
  "id"                TEXT PRIMARY KEY,
  "platform"          TEXT NOT NULL,
  "groupId"           TEXT NOT NULL,
  "platformMessageId" TEXT NOT NULL,
  "senderRef"         TEXT NOT NULL,
  "rawText"           TEXT NOT NULL,
  "candidates"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status"            TEXT NOT NULL DEFAULT 'pending',
  "decisionNote"      TEXT,
  "decidedAt"         TIMESTAMP(3),
  "receivedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupDraft_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
  -- 已处理的必须有决定时间；未处理的不能有
  CONSTRAINT "GroupDraft_decided_check" CHECK (
    ("status" = 'pending' AND "decidedAt" IS NULL) OR
    ("status" <> 'pending' AND "decidedAt" IS NOT NULL)
  )
);

-- 幂等：同一平台消息只落一条
CREATE UNIQUE INDEX "GroupDraft_platform_message_key"
  ON "GroupDraft"("platform", "platformMessageId");

-- 列表查询：按状态 + 时间倒序
CREATE INDEX "GroupDraft_status_receivedAt_idx"
  ON "GroupDraft"("status", "receivedAt" DESC);
