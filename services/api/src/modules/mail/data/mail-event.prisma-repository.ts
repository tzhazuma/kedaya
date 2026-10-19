/**
 * 校园邮箱 · 活动 Prisma 仓储（data 层）
 *
 * 只读写 `MailEvent`。⚠️ 本表**不含邮件正文**：`matchedText` 只是命中的时间片段。
 *
 * 幂等策略：`(accountId, uid)` 唯一 + `createMany({ skipDuplicates: true })`。
 * 同一封邮件重复同步不会产生第二条活动；UID 在同一个 IMAP 邮箱内稳定。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MailEvent } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  MailEventRecord,
  MailMessageRepository,
  NewMailEvent,
} from '../domain/mail.domain';

/** 行 → 领域模型。逐字段显式映射。 */
export function toMailEventRecord(row: MailEvent): MailEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    uid: row.uid,
    title: row.title,
    startsAt: row.startsAt,
    location: row.location,
    organizer: row.organizer,
    confidence: row.confidence,
    matchedText: row.matchedText,
    receivedAt: row.receivedAt,
    stale: row.stale,
  };
}

@Injectable()
export class MailMessagePrismaRepository implements MailMessageRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async knownUids(accountId: string): Promise<Set<number>> {
    const rows = await this.prisma.mailEvent.findMany({
      where: { accountId },
      select: { uid: true },
    });
    return new Set(rows.map((row) => row.uid));
  }

  async saveEvents(events: readonly NewMailEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const result = await this.prisma.mailEvent.createMany({
      data: events.map((event) => ({
        userId: event.userId,
        accountId: event.accountId,
        uid: event.uid,
        title: event.title,
        startsAt: event.startsAt,
        location: event.location,
        organizer: event.organizer,
        confidence: event.confidence,
        matchedText: event.matchedText,
        receivedAt: event.receivedAt,
        stale: event.stale,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async listEvents(userId: string): Promise<MailEventRecord[]> {
    const rows = await this.prisma.mailEvent.findMany({
      where: { userId },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toMailEventRecord);
  }

  async markStale(accountId: string): Promise<number> {
    const result = await this.prisma.mailEvent.updateMany({
      where: { accountId },
      data: { stale: true },
    });
    return result.count;
  }

  async clearStale(accountId: string): Promise<number> {
    const result = await this.prisma.mailEvent.updateMany({
      where: { accountId },
      data: { stale: false },
    });
    return result.count;
  }

  async purgeForAccount(accountId: string): Promise<number> {
    const result = await this.prisma.mailEvent.deleteMany({ where: { accountId } });
    return result.count;
  }
}
