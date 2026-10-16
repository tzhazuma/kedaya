import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../pagination/cursor';
import type {
  AuditEntry,
  AuditListParams,
  AuditRecord,
  AuditRepository,
  ActorType,
} from '../compliance.types';

/**
 * AuditLog 表的 Prisma 实现。
 *
 * 分页排序用 `at desc, id desc`（而不是像业务表那样按 id asc）：
 * 审计日志的读取语义天然是"最近的在前"；加上 id 作为二级排序键，
 * 保证同一毫秒内的多条记录也有确定的顺序，游标翻页不会漏或重。
 */
@Injectable()
export class AuditPrismaRepository implements AuditRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async append(entry: AuditEntry): Promise<AuditRecord> {
    const row = await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorType: entry.actorType ?? 'user',
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        module: entry.module ?? null,
        ip: entry.ip ?? null,
        ua: entry.ua ?? null,
        metadata:
          entry.metadata === undefined || entry.metadata === null
            ? undefined
            : (entry.metadata as unknown as Prisma.InputJsonValue),
      },
    });
    return toRecord(row);
  }

  async list(params: AuditListParams): Promise<Page<AuditRecord>> {
    const id = decodeCursor(params.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(params.module ? { module: params.module } : {}),
        ...(params.actorId ? { actorId: params.actorId } : {}),
        ...(params.resource ? { resource: params.resource } : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });

    const hasMore = rows.length > params.limit;
    const visible = hasMore ? rows.slice(0, params.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toRecord),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }
}

function toRecord(row: AuditLog): AuditRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    actorType: row.actorType as ActorType,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    module: row.module,
    ip: row.ip,
    ua: row.ua,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    at: row.at,
  };
}
