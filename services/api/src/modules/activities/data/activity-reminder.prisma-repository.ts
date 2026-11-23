/**
 * 活动提醒 · Prisma 仓储（data 层）
 *
 * 派发并发安全的核心在这里：`claimDue` 用
 *
 *   UPDATE ... SET status='sending'
 *   FROM (SELECT ... WHERE status='pending' AND remindAt <= now
 *         ORDER BY remindAt FOR UPDATE SKIP LOCKED LIMIT n) picked
 *   RETURNING ...
 *
 * 这是一个**单条 SQL 的原子抢占**：多个 API 副本同时派发时，同一行只会被一个
 * 副本的 UPDATE 命中，不会重复发站内信。发送失败由应用层 `release` 回退 pending。
 *
 * ⚠️ 已知限制：PGlite（测试夹具）把查询全局串行化，因此集成测试只能证明
 * "第一次抢占后第二次拿不到"，不能证明真实多连接下的并发行为；
 * 真实 PostgreSQL 的 `SKIP LOCKED` 语义由上述 SQL 保证。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ActivityReminder } from '@prisma/client';

import { ConflictError } from '../../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_STATUSES,
  type ActivityReminderChannel,
  type ActivityReminderKind,
  type ActivityReminderRecord,
  type ActivityReminderRepository,
  type ActivityReminderStatus,
  type ActivityStatus,
  type ClaimedActivityReminder,
  type NewActivityReminder,
  type NewActivityReminderInput,
  type ReminderListPage,
  type ReminderListQuery,
} from '../domain/activities.domain';

type ReminderRow = ActivityReminder & { activity: { title: string } };

function normalizeKind(value: string): ActivityReminderKind {
  return (ACTIVITY_REMINDER_KINDS as readonly string[]).includes(value)
    ? (value as ActivityReminderKind)
    : 'custom';
}

function normalizeChannel(value: string): ActivityReminderChannel {
  return (ACTIVITY_REMINDER_CHANNELS as readonly string[]).includes(value)
    ? (value as ActivityReminderChannel)
    : 'inapp';
}

function normalizeStatus(value: string): ActivityReminderStatus {
  return (ACTIVITY_REMINDER_STATUSES as readonly string[]).includes(value)
    ? (value as ActivityReminderStatus)
    : 'pending';
}

function normalizeActivityStatus(value: string): ActivityStatus {
  return (ACTIVITY_STATUSES as readonly string[]).includes(value)
    ? (value as ActivityStatus)
    : 'candidate';
}

function toRecord(row: ReminderRow): ActivityReminderRecord {
  return {
    id: row.id,
    userId: row.userId,
    activityId: row.activityId,
    activityTitle: row.activity.title,
    kind: normalizeKind(row.kind),
    remindAt: row.remindAt,
    channel: normalizeChannel(row.channel),
    status: normalizeStatus(row.status),
    dedupeKey: row.dedupeKey,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt,
    claimedAt: row.claimedAt,
    createdAt: row.createdAt,
  };
}

function toCreateData(input: NewActivityReminder): Prisma.ActivityReminderUncheckedCreateInput {
  return {
    userId: input.userId,
    activityId: input.activityId,
    kind: input.kind,
    remindAt: input.remindAt,
    channel: input.channel,
    dedupeKey: input.dedupeKey,
    status: 'pending',
  };
}

interface ClaimedRow {
  id: string;
  userId: string;
  activityId: string;
  kind: string;
  remindAt: Date;
  channel: string;
  status: string;
  dedupeKey: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  claimedAt: Date | null;
  createdAt: Date;
  activityTitle: string;
  activityStatus: string;
  activityStartsAt: Date | null;
  activityRegistrationDeadlineAt: Date | null;
}

@Injectable()
export class ActivityReminderPrismaRepository implements ActivityReminderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createMany(inputs: readonly NewActivityReminder[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await this.prisma.activityReminder.createMany({
      data: inputs.map(toCreateData),
      skipDuplicates: true,
    });
    return result.count;
  }

  async create(input: NewActivityReminderInput): Promise<ActivityReminderRecord> {
    try {
      const row = await this.prisma.activityReminder.create({
        data: toCreateData({
          ...input,
          dedupeKey: input.dedupeKey ?? null,
        }),
        include: { activity: { select: { title: true } } },
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('相同时间的提醒已存在', { reason: 'REMINDER_DUPLICATE' });
      }
      throw error;
    }
  }

  async listByUser(userId: string, query: ReminderListQuery): Promise<ReminderListPage> {
    const cursorId = decodeCursor(query.cursor);
    const statusFilter =
      query.status === undefined
        ? {}
        : query.status === 'scheduled'
          ? { status: { in: ['pending', 'sending'] } }
          : { status: query.status };

    const rows = await this.prisma.activityReminder.findMany({
      where: { userId, ...statusFilter },
      take: query.limit + 1,
      orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      include: { activity: { select: { title: true } } },
      ...(cursorId === undefined ? {} : { cursor: { id: cursorId }, skip: 1 }),
    });

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map(toRecord),
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  async listByActivity(userId: string, activityId: string): Promise<ActivityReminderRecord[]> {
    const rows = await this.prisma.activityReminder.findMany({
      where: { userId, activityId },
      orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      include: { activity: { select: { title: true } } },
    });
    return rows.map(toRecord);
  }

  async findById(userId: string, id: string): Promise<ActivityReminderRecord | null> {
    const row = await this.prisma.activityReminder.findFirst({
      where: { id, userId },
      include: { activity: { select: { title: true } } },
    });
    return row === null ? null : toRecord(row);
  }

  async deleteById(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.activityReminder.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  async deletePendingForActivity(activityId: string): Promise<number> {
    const result = await this.prisma.activityReminder.deleteMany({
      where: { activityId, status: 'pending' },
    });
    return result.count;
  }

  async deletePendingDefaults(
    activityId: string,
    kinds?: readonly ActivityReminderKind[],
  ): Promise<number> {
    const result = await this.prisma.activityReminder.deleteMany({
      where: {
        activityId,
        status: 'pending',
        dedupeKey: { startsWith: 'default:' },
        ...(kinds === undefined ? {} : { kind: { in: [...kinds] } }),
      },
    });
    return result.count;
  }

  /**
   * 原子抢占。`LIMIT` 由调用方限制在 1..200；`FOR UPDATE SKIP LOCKED`
   * 保证多副本不会拿到同一行。只抢 `channel='inapp'`（微信订阅消息未接通），
   * 抢占时 `attempts + 1`，供应用层判断是否已达重试上限。
   */
  async claimDue(now: Date, limit: number): Promise<ClaimedActivityReminder[]> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "ActivityReminder" AS r
      SET "status" = 'sending', "claimedAt" = ${now}, "attempts" = r."attempts" + 1
      FROM (
        SELECT "id", "activityId"
        FROM "ActivityReminder"
        WHERE "status" = 'pending' AND "channel" = 'inapp' AND "remindAt" <= ${now}
        ORDER BY "remindAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ) AS picked
      JOIN "Activity" AS a ON a."id" = picked."activityId"
      WHERE r."id" = picked."id"
      RETURNING
        r."id", r."userId", r."activityId", r."kind", r."remindAt", r."channel",
        r."status", r."dedupeKey", r."attempts", r."lastError",
        r."sentAt", r."claimedAt", r."createdAt",
        a."title" AS "activityTitle",
        a."status" AS "activityStatus",
        a."startsAt" AS "activityStartsAt",
        a."registrationDeadlineAt" AS "activityRegistrationDeadlineAt"
    `);

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      activityId: row.activityId,
      activityTitle: row.activityTitle,
      kind: normalizeKind(row.kind),
      remindAt: row.remindAt,
      channel: normalizeChannel(row.channel),
      status: normalizeStatus(row.status),
      dedupeKey: row.dedupeKey,
      attempts: row.attempts,
      lastError: row.lastError,
      sentAt: row.sentAt,
      claimedAt: row.claimedAt,
      createdAt: row.createdAt,
      activityStatus: normalizeActivityStatus(row.activityStatus),
      activityStartsAt: row.activityStartsAt,
      activityRegistrationDeadlineAt: row.activityRegistrationDeadlineAt,
    }));
  }

  /**
   * 回收超过租约仍停在 `sending` 的行（上一次派发进程崩溃/被杀）。
   * `claimedAt` 为 null 的 sending 也视为卡住，一并回收。
   */
  async releaseStale(claimedBefore: Date): Promise<number> {
    const result = await this.prisma.activityReminder.updateMany({
      where: {
        status: 'sending',
        OR: [{ claimedAt: null }, { claimedAt: { lt: claimedBefore } }],
      },
      data: { status: 'pending', claimedAt: null },
    });
    return result.count;
  }

  async markSent(id: string, sentAt: Date): Promise<boolean> {
    const result = await this.prisma.activityReminder.updateMany({
      where: { id, status: 'sending' },
      data: { status: 'sent', sentAt, claimedAt: null, lastError: null },
    });
    return result.count > 0;
  }

  async release(id: string): Promise<boolean> {
    const result = await this.prisma.activityReminder.updateMany({
      where: { id, status: 'sending' },
      data: { status: 'pending', claimedAt: null },
    });
    return result.count > 0;
  }

  async markFailed(id: string, reason: string): Promise<boolean> {
    const result = await this.prisma.activityReminder.updateMany({
      where: { id, status: 'sending' },
      data: {
        status: 'failed',
        claimedAt: null,
        lastError: reason.slice(0, 500),
      },
    });
    return result.count > 0;
  }

  async cancel(id: string): Promise<boolean> {
    const result = await this.prisma.activityReminder.updateMany({
      where: { id, status: { in: ['pending', 'sending'] } },
      data: { status: 'cancelled', claimedAt: null },
    });
    return result.count > 0;
  }
}
