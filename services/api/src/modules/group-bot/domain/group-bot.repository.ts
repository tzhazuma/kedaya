import type { GroupDraftStatus } from './group-bot.domain';

/** 一条草稿的持久化形状 */
export interface GroupDraftRecord {
  id: string;
  platform: string;
  groupId: string;
  platformMessageId: string;
  senderRef: string;
  rawText: string;
  candidates: unknown;
  status: string;
  decisionNote: string | null;
  decidedAt: Date | null;
  receivedAt: Date;
}

export interface CreateGroupDraftInput {
  platform: string;
  groupId: string;
  platformMessageId: string;
  senderRef: string;
  rawText: string;
  candidates: readonly unknown[];
  status: string;
}

export interface GroupDraftRepository {
  findByPlatformMessage(platform: string, platformMessageId: string): Promise<GroupDraftRecord | null>;
  findById(id: string): Promise<GroupDraftRecord | null>;
  create(input: CreateGroupDraftInput): Promise<GroupDraftRecord>;
  list(input: {
    cursor: string | null;
    limit: number;
    status?: string;
  }): Promise<{ items: GroupDraftRecord[]; nextCursor: string | null }>;
  decide(input: {
    id: string;
    status: GroupDraftStatus;
    note: string | null;
    decidedAt: Date;
  }): Promise<void>;
}

export const GROUP_DRAFT_REPOSITORY = Symbol('KEDAYA_GROUP_DRAFT_REPOSITORY');
