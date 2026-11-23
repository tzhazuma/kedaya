/**
 * 校园活动 · Prisma 仓储（data 层）
 *
 * 唯一的 IO 落点。所有按用户收窄的查询都显式带 `userId`；
 * 只有派发用的 `findByIds` 不带（调用方持有已抢占的提醒，不再接受外部输入）。
 *
 * 幂等：`(userId, source, sourceRef)` 唯一。先查再建，撞唯一约束时回读既有行
 * （并发导入同一篇文章不会产生第二条，也不会把 500 抛给用户）。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Activity } from '@prisma/client';

import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ACTIVITY_STATUSES,
  type ActivityKind,
  type ActivityListFilters,
  type ActivityListPage,
  type ActivityRecord,
  type ActivityRepository,
  type ActivitySource,
  type ActivityStatus,
  type ActivityUpdateData,
  type NewActivity,
} from '../domain/activities.domain';

const KINDS: readonly ActivityKind[] = [
  'lecture',
  'meeting',
  'info-session',
  'sports',
  'club',
  'other',
];
const SOURCES: readonly ActivitySource[] = ['campus-mail', 'wechat-mp', 'manual'];

function normalizeKind(value: string): ActivityKind {
  return (KINDS as readonly string[]).includes(value) ? (value as ActivityKind) : 'other';
}

function normalizeSource(value: string): ActivitySource {
  return (SOURCES as readonly string[]).includes(value) ? (value as ActivitySource) : 'manual';
}

function normalizeStatus(value: string): ActivityStatus {
  return (ACTIVITY_STATUSES as readonly string[]).includes(value)
    ? (value as ActivityStatus)
    : 'candidate';
}

/** 行 → 领域模型。逐字段显式映射，Prisma 加字段时不会悄悄进响应。 */
export function toActivityRecord(row: Activity): ActivityRecord {
  return {
    id: row.id,
    userId: row.userId,
    source: normalizeSource(row.source),
    sourceRef: row.sourceRef,
    kind: normalizeKind(row.kind),
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    location: row.location,
    organizer: row.organizer,
    registrationDeadlineAt: row.registrationDeadlineAt,
    registrationDeadlineRaw: row.registrationDeadlineRaw,
    registrationUrl: row.registrationUrl,
    evidenceText: row.evidenceText,
    confidence: row.confidence,
    status: normalizeStatus(row.status),
    sourceUrl: row.sourceUrl,
    sourceLabel: row.sourceLabel,
    publishedAt: row.publishedAt,
    stale: row.stale,
    mailAccountId: row.mailAccountId,
    mailEventId: row.mailEventId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCreateData(input: NewActivity): Prisma.ActivityUncheckedCreateInput {
  return {
    userId: input.userId,
    source: input.source,
    sourceRef: input.sourceRef,
    kind: input.kind,
    title: input.title,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    location: input.location ?? null,
    organizer: input.organizer ?? null,
    registrationDeadlineAt: input.registrationDeadlineAt ?? null,
    registrationDeadlineRaw: input.registrationDeadlineRaw ?? null,
    registrationUrl: input.registrationUrl ?? null,
    evidenceText: input.evidenceText,
    confidence: input.confidence,
    status: input.status,
    sourceUrl: input.sourceUrl ?? null,
    sourceLabel: input.sourceLabel ?? null,
    publishedAt: input.publishedAt ?? null,
    stale: input.stale ?? false,
    mailAccountId: input.mailAccountId ?? null,
    mailEventId: input.mailEventId ?? null,
  };
}

function toUpdateData(input: ActivityUpdateData): Prisma.ActivityUpdateManyMutationInput {
  const data: Prisma.ActivityUpdateManyMutationInput = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.title !== undefined) data.title = input.title;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (input.location !== undefined) data.location = input.location;
  if (input.organizer !== undefined) data.organizer = input.organizer;
  if (input.registrationDeadlineAt !== undefined) {
    data.registrationDeadlineAt = input.registrationDeadlineAt;
  }
  if (input.registrationDeadlineRaw !== undefined) {
    data.registrationDeadlineRaw = input.registrationDeadlineRaw;
  }
  if (input.registrationUrl !== undefined) data.registrationUrl = input.registrationUrl;
  if (input.evidenceText !== undefined) data.evidenceText = input.evidenceText;
  if (input.status !== undefined) data.status = input.status;
  if (input.sourceUrl !== undefined) data.sourceUrl = input.sourceUrl;
  if (input.sourceLabel !== undefined) data.sourceLabel = input.sourceLabel;
  if (input.publishedAt !== undefined) data.publishedAt = input.publishedAt;
  if (input.stale !== undefined) data.stale = input.stale;
  return data;
}

@Injectable()
export class ActivityPrismaRepository implements ActivityRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: NewActivity): Promise<ActivityRecord> {
    const row = await this.prisma.activity.create({ data: toCreateData(input) });
    return toActivityRecord(row);
  }

  async upsertBySourceRef(
    input: NewActivity,
  ): Promise<{ record: ActivityRecord; created: boolean }> {
    const existing = await this.findBySourceRef(input.userId, input.source, input.sourceRef);
    if (existing !== null) return { record: existing, created: false };

    try {
      const row = await this.prisma.activity.create({ data: toCreateData(input) });
      return { record: toActivityRecord(row), created: true };
    } catch (error) {
      // 并发导入同一来源：唯一约束是最终裁判，回读既有行即可
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findBySourceRef(input.userId, input.source, input.sourceRef);
        if (raced !== null) return { record: raced, created: false };
      }
      throw error;
    }
  }

  async findById(userId: string, id: string): Promise<ActivityRecord | null> {
    const row = await this.prisma.activity.findFirst({ where: { id, userId } });
    return row === null ? null : toActivityRecord(row);
  }

  async findByIds(ids: readonly string[]): Promise<ActivityRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.activity.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toActivityRecord);
  }

  async listByUser(
    userId: string,
    filters: ActivityListFilters,
    page: { cursor?: string; limit: number },
  ): Promise<ActivityListPage> {
    const cursorId = decodeCursor(page.cursor);
    const rows = await this.prisma.activity.findMany({
      where: {
        userId,
        // 契约：不传 status 时默认只返回 candidate + confirmed；
        // dismissed / archived 必须显式查询。
        status:
          filters.status === undefined
            ? { in: ['candidate', 'confirmed'] }
            : filters.status,
        ...(filters.source === undefined ? {} : { source: filters.source }),
        ...(filters.from === undefined && filters.to === undefined
          ? {}
          : {
              startsAt: {
                ...(filters.from === undefined ? {} : { gte: filters.from }),
                ...(filters.to === undefined ? {} : { lt: filters.to }),
              },
            }),
      },
      take: page.limit + 1,
      // 先按开始时间；没有开始时间的（只写了报名截止）按截止时间兜底，
      // 两者都没有的排最后 —— 不让「只有截止时间」的活动掉到列表末尾。
      orderBy: [
        { startsAt: { sort: 'asc', nulls: 'last' } },
        { registrationDeadlineAt: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
      ...(cursorId === undefined ? {} : { cursor: { id: cursorId }, skip: 1 }),
    });

    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map(toActivityRecord),
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  async update(userId: string, id: string, data: ActivityUpdateData): Promise<ActivityRecord | null> {
    const result = await this.prisma.activity.updateMany({
      where: { id, userId },
      data: toUpdateData(data),
    });
    if (result.count === 0) return null;
    const row = await this.prisma.activity.findUnique({ where: { id } });
    return row === null ? null : toActivityRecord(row);
  }

  private async findBySourceRef(
    userId: string,
    source: ActivitySource,
    sourceRef: string,
  ): Promise<ActivityRecord | null> {
    const row = await this.prisma.activity.findUnique({
      where: { userId_source_sourceRef: { userId, source, sourceRef } },
    });
    return row === null ? null : toActivityRecord(row);
  }
}
