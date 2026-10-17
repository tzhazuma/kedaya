/**
 * 联系方式交换 · data 层（唯一碰 Prisma / SQL 的地方）
 *
 * 这一层只做三件事：
 *   1. 行 ↔ 领域模型映射；
 *   2. 游标分页（复合游标 `(createdAt|at, id)`，契约 §11.10-E）；
 *   3. 把 Prisma 的唯一约束错误翻译成领域错误（不让 ORM 细节上抛）。
 *
 * 加密不在这里做 —— 见 `aes-gcm-contact.crypto.ts`。因此本文件即使被
 * 误用也不会把密文当明文返回：所有查询都显式 `select`/返回完整行，
 * 由用例层决定要不要 `decrypt`。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ContactAccessAudit as ContactAccessAuditRow,
  ContactEntry as ContactEntryRow,
  ContactExchangeRequest as ContactExchangeRequestRow,
} from '@prisma/client';
import type {
  ContactAccessAuditPage,
  ContactAccessAuditQuery,
  ContactAccessAuditRecord,
  ContactEntryPage,
  ContactEntryRecord,
  ContactExchangeRepository,
  ContactExchangeRequestPage,
  ContactExchangeRequestQuery,
  ContactExchangeRequestRecord,
  CreateContactEntryInput,
  CreateContactExchangeRequestInput,
  PageQuery,
  UpdateContactEntryInput,
  UpdateContactExchangeRequestInput,
  AppendContactAuditInput,
} from '../domain/contact-exchange.domain';
import {
  ContactExchangeRepositoryError,
  encodeTimeCursor,
} from '../domain/contact-exchange.domain';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ContactExchangeStatus, ContactKind } from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 行 → 领域模型
 * ------------------------------------------------------------------ */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export function toContactEntryRecord(row: ContactEntryRow): ContactEntryRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as ContactKind,
    label: row.label,
    valueCipher: row.valueCipher,
    valueFingerprint: row.valueFingerprint,
    shared: row.shared,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toContactExchangeRequestRecord(
  row: ContactExchangeRequestRow,
): ContactExchangeRequestRecord {
  return {
    id: row.id,
    requesterId: row.requesterId,
    addresseeId: row.addresseeId,
    pairKey: row.pairKey,
    status: row.status as ContactExchangeStatus,
    contextModule: row.contextModule as ContactExchangeRequestRecord['contextModule'],
    contextId: row.contextId,
    message: row.message,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
  };
}

export function toContactAccessAuditRecord(row: ContactAccessAuditRow): ContactAccessAuditRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    subjectId: row.subjectId,
    requestId: row.requestId,
    action: 'view_contacts',
    entryIds: row.entryIds,
    entryKinds: row.entryKinds as ContactKind[],
    at: row.at,
  };
}

/* ------------------------------------------------------------------ *
 * 游标条件
 * ------------------------------------------------------------------ */

function timeCursorWhere<T extends { OR?: unknown[] }>(
  cursor: { at: Date; id: string } | undefined,
): T | undefined {
  if (!cursor) return undefined;
  // Prisma 的复合游标语义：先比时间，时间相同再比 id（降序）。
  return {
    OR: [
      { createdAt: { lt: cursor.at } },
      { createdAt: cursor.at, id: { lt: cursor.id } },
    ],
  } as T;
}

function auditCursorWhere(
  cursor: { at: Date; id: string } | undefined,
): Prisma.ContactAccessAuditWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }],
  };
}

@Injectable()
export class PrismaContactExchangeRepository implements ContactExchangeRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /* ---------------- 用户 ---------------- */

  async userExists(userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return row !== null;
  }

  /* ---------------- 联系方式条目 ---------------- */

  async createEntry(input: CreateContactEntryInput): Promise<ContactEntryRecord> {
    try {
      const row = await this.prisma.contactEntry.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          label: input.label,
          valueCipher: input.valueCipher,
          valueFingerprint: input.valueFingerprint,
          shared: input.shared,
        },
      });
      return toContactEntryRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContactExchangeRepositoryError('DUPLICATE_CONTACT', '同一类型下已存在相同的联系方式');
      }
      throw error;
    }
  }

  async findEntryById(id: string): Promise<ContactEntryRecord | null> {
    const row = await this.prisma.contactEntry.findUnique({ where: { id } });
    return row ? toContactEntryRecord(row) : null;
  }

  async findDuplicateEntry(
    userId: string,
    kind: ContactKind,
    fingerprint: string,
  ): Promise<ContactEntryRecord | null> {
    const row = await this.prisma.contactEntry.findFirst({
      where: { userId, kind, valueFingerprint: fingerprint },
    });
    return row ? toContactEntryRecord(row) : null;
  }

  async listEntries(userId: string, query: PageQuery): Promise<ContactEntryPage> {
    const cursorWhere = timeCursorWhere<Prisma.ContactEntryWhereInput>(query.cursor);
    const rows = await this.prisma.contactEntry.findMany({
      where: cursorWhere ? { AND: [{ userId }, cursorWhere] } : { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(toContactEntryRecord),
      nextCursor: hasMore && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
    };
  }

  async updateEntry(id: string, patch: UpdateContactEntryInput): Promise<ContactEntryRecord> {
    const data: Prisma.ContactEntryUpdateInput = {};
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.valueCipher !== undefined) data.valueCipher = patch.valueCipher;
    if (patch.valueFingerprint !== undefined) data.valueFingerprint = patch.valueFingerprint;
    if (patch.shared !== undefined) data.shared = patch.shared;

    try {
      const row = await this.prisma.contactEntry.update({ where: { id }, data });
      return toContactEntryRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContactExchangeRepositoryError('DUPLICATE_CONTACT', '同一类型下已存在相同的联系方式');
      }
      throw error;
    }
  }

  async deleteEntry(id: string): Promise<void> {
    await this.prisma.contactEntry.delete({ where: { id } });
  }

  async listSharedEntries(userId: string): Promise<ContactEntryRecord[]> {
    const rows = await this.prisma.contactEntry.findMany({
      // `shared: true` 是**唯一**的授权依据 —— 不存在"默认给看脱敏值"的路径。
      where: { userId, shared: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toContactEntryRecord);
  }

  /* ---------------- 交换申请 ---------------- */

  async expireStaleRequests(now: Date): Promise<number> {
    const result = await this.prisma.contactExchangeRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  async createRequest(
    input: CreateContactExchangeRequestInput,
  ): Promise<ContactExchangeRequestRecord> {
    try {
      const row = await this.prisma.contactExchangeRequest.create({
        data: {
          requesterId: input.requesterId,
          addresseeId: input.addresseeId,
          pairKey: input.pairKey,
          status: 'PENDING',
          contextModule: input.contextModule,
          contextId: input.contextId,
          message: input.message,
          expiresAt: input.expiresAt,
        },
      });
      return toContactExchangeRequestRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContactExchangeRepositoryError(
          'DUPLICATE_ACTIVE_REQUEST',
          '同一对用户已有进行中的联系方式交换申请',
        );
      }
      throw error;
    }
  }

  async findRequestById(id: string): Promise<ContactExchangeRequestRecord | null> {
    const row = await this.prisma.contactExchangeRequest.findUnique({ where: { id } });
    return row ? toContactExchangeRequestRecord(row) : null;
  }

  async findActiveRequestByPair(pairKey: string): Promise<ContactExchangeRequestRecord | null> {
    const row = await this.prisma.contactExchangeRequest.findFirst({
      where: { pairKey, status: { in: ['PENDING', 'ACCEPTED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toContactExchangeRequestRecord(row) : null;
  }

  async countRecentRequestsByPair(pairKey: string, since: Date): Promise<number> {
    return this.prisma.contactExchangeRequest.count({
      where: { pairKey, createdAt: { gte: since } },
    });
  }

  async updateRequestStatus(
    id: string,
    patch: UpdateContactExchangeRequestInput,
  ): Promise<ContactExchangeRequestRecord> {
    const row = await this.prisma.contactExchangeRequest.update({
      where: { id },
      data: {
        status: patch.status,
        ...(patch.respondedAt !== undefined ? { respondedAt: patch.respondedAt } : {}),
        ...(patch.revokedAt !== undefined ? { revokedAt: patch.revokedAt } : {}),
        ...(patch.revokedBy !== undefined ? { revokedBy: patch.revokedBy } : {}),
      },
    });
    return toContactExchangeRequestRecord(row);
  }

  async listRequests(
    userId: string,
    query: ContactExchangeRequestQuery,
  ): Promise<ContactExchangeRequestPage> {
    const directionWhere: Prisma.ContactExchangeRequestWhereInput =
      query.direction === 'incoming'
        ? { addresseeId: userId }
        : query.direction === 'outgoing'
          ? { requesterId: userId }
          : { OR: [{ requesterId: userId }, { addresseeId: userId }] };

    const filters: Prisma.ContactExchangeRequestWhereInput[] = [directionWhere];
    if (query.status) filters.push({ status: query.status });

    const cursorWhere = timeCursorWhere<Prisma.ContactExchangeRequestWhereInput>(query.cursor);
    if (cursorWhere) filters.push(cursorWhere);

    const rows = await this.prisma.contactExchangeRequest.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(toContactExchangeRequestRecord),
      nextCursor: hasMore && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
    };
  }

  /* ---------------- 审计 ---------------- */

  async appendAudit(input: AppendContactAuditInput): Promise<ContactAccessAuditRecord> {
    const row = await this.prisma.contactAccessAudit.create({
      data: {
        actorId: input.actorId,
        subjectId: input.subjectId,
        requestId: input.requestId,
        action: 'view_contacts',
        entryIds: input.entryIds,
        entryKinds: input.entryKinds,
      },
    });
    return toContactAccessAuditRecord(row);
  }

  async listAudit(
    userId: string,
    query: ContactAccessAuditQuery,
  ): Promise<ContactAccessAuditPage> {
    const directionWhere: Prisma.ContactAccessAuditWhereInput =
      query.direction === 'inbound' ? { subjectId: userId } : { actorId: userId };

    const cursorWhere = auditCursorWhere(query.cursor);
    const rows = await this.prisma.contactAccessAudit.findMany({
      where: cursorWhere ? { AND: [directionWhere, cursorWhere] } : directionWhere,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(toContactAccessAuditRecord),
      nextCursor: hasMore && last ? encodeTimeCursor({ at: last.at, id: last.id }) : null,
    };
  }
}
