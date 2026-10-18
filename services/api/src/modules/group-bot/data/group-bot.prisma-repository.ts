import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateGroupDraftInput,
  GroupDraftRecord,
  GroupDraftRepository,
} from '../domain/group-bot.repository';
import type { GroupDraftStatus } from '../domain/group-bot.domain';

/**
 * 群草稿仓储 —— **唯一碰 Prisma 的地方**。
 *
 * 注意没有任何 `senderRef` 之外的发送者字段：
 * 昵称、QQ 号、头像一律不落库（见 domain 注释）。
 */
@Injectable()
export class PrismaGroupDraftRepository implements GroupDraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByPlatformMessage(platform: string, platformMessageId: string): Promise<GroupDraftRecord | null> {
    const row = await this.prisma.groupDraft.findUnique({
      where: { platform_platformMessageId: { platform, platformMessageId } },
    });
    return row === null ? null : toRecord(row);
  }

  async findById(id: string): Promise<GroupDraftRecord | null> {
    const row = await this.prisma.groupDraft.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  async create(input: CreateGroupDraftInput): Promise<GroupDraftRecord> {
    const row = await this.prisma.groupDraft.create({
      data: {
        platform: input.platform,
        groupId: input.groupId,
        platformMessageId: input.platformMessageId,
        senderRef: input.senderRef,
        rawText: input.rawText,
        candidates: input.candidates as never,
        status: input.status,
      },
    });
    return toRecord(row);
  }

  async list(input: {
    cursor: string | null;
    limit: number;
    status?: string;
  }): Promise<{ items: GroupDraftRecord[]; nextCursor: string | null }> {
    const rows = await this.prisma.groupDraft.findMany({
      where: input.status === undefined ? {} : { status: input.status },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor === null ? {} : { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasMore = rows.length > input.limit;
    const items = (hasMore ? rows.slice(0, input.limit) : rows).map(toRecord);
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last !== undefined ? last.id : null };
  }

  async decide(input: {
    id: string;
    status: GroupDraftStatus;
    note: string | null;
    decidedAt: Date;
  }): Promise<void> {
    await this.prisma.groupDraft.update({
      where: { id: input.id },
      data: { status: input.status, decisionNote: input.note, decidedAt: input.decidedAt },
    });
  }
}

interface RawRow {
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

function toRecord(row: RawRow): GroupDraftRecord {
  return {
    id: row.id,
    platform: row.platform,
    groupId: row.groupId,
    platformMessageId: row.platformMessageId,
    senderRef: row.senderRef,
    rawText: row.rawText,
    candidates: row.candidates,
    status: row.status,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    receivedAt: row.receivedAt,
  };
}
