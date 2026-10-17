/**
 * TechPie 整合 · data 层仓储（契约 §2.9 + 规格 §5）
 *
 * data 层是**唯一允许碰 IO 的地方**（契约 §7 依赖方向 `domain ← data`）。
 * 本文件同时承载两个仓储：
 *   · `TechpieLinkPrismaRepository`    —— 绑定元数据（**不含凭证**）
 *   · `TechpieSyncJobPrismaRepository` —— 同步任务
 *
 * 凭证（`CampusSession.sessionCipher`）**不在这里** —— 它的读写被限制在
 * `data/campus-session.service.ts` 一个文件的作用域内（规格 §5.3 的硬要求）。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import type { TechpieLink, TechpieSyncJob } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateTechpieLinkInput,
  CreateTechpieSyncJobInput,
  TechpieLinkModel,
  TechpieLinkRepository,
  TechpieListParams,
  TechpieSyncJobModel,
  TechpieSyncJobRepository,
  UpdateTechpieLinkInput,
} from '../domain/techpie.domain';
import type { CampusPlatform, TechpieLinkStatus } from '../domain/ports/campus-session.port';

/** 行 → 领域模型。逐字段显式映射（而不是透传），这样 Prisma 加字段时不会悄悄进响应。 */
export function toLinkModel(row: TechpieLink): TechpieLinkModel {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as CampusPlatform,
    status: row.status as TechpieLinkStatus,
    externalUserId: row.externalUserId,
    tokenCipher: row.tokenCipher,
    expiresAt: row.expiresAt,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toJobModel(row: TechpieSyncJob): TechpieSyncJobModel {
  return {
    id: row.id,
    linkId: row.linkId,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    nextRetryAt: row.nextRetryAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 游标分页（契约 §6.1：`orderBy id asc` + `take limit+1` + `cursor/skip 1`）。
 * 多取一条判断"还有没有下一页"，避免额外 count 查询。
 */
function pageOf<TRow extends { id: string }, TModel>(
  rows: TRow[],
  limit: number,
  map: (row: TRow) => TModel,
): Page<TModel> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}

@Injectable()
export class TechpieLinkPrismaRepository implements TechpieLinkRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listByUser(userId: string, { cursor, limit }: TechpieListParams): Promise<Page<TechpieLinkModel>> {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.techpieLink.findMany({
      where: { userId, deletedAt: null },
      take: limit + 1,
      orderBy: { id: 'asc' },
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });
    return pageOf(rows, limit, toLinkModel);
  }

  async findById(id: string): Promise<TechpieLinkModel | null> {
    const row = await this.prisma.techpieLink.findUnique({ where: { id } });
    return row ? toLinkModel(row) : null;
  }

  async findByUserAndProvider(userId: string, provider: CampusPlatform): Promise<TechpieLinkModel | null> {
    const row = await this.prisma.techpieLink.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    return row ? toLinkModel(row) : null;
  }

  async create(input: CreateTechpieLinkInput): Promise<TechpieLinkModel> {
    const row = await this.prisma.techpieLink.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        status: input.status,
        externalUserId: input.externalUserId ?? null,
        expiresAt: input.expiresAt ?? null,
        lastSyncAt: input.lastSyncAt ?? null,
      },
    });
    return toLinkModel(row);
  }

  async update(id: string, input: UpdateTechpieLinkInput): Promise<TechpieLinkModel> {
    // 只把**显式给出**的字段写进去：`undefined` 表示"不改"，
    // 而 `null` 是"清空"（与 PATCH 的 Merge Patch 语义一致，契约 §6.1）。
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) data[key] = value;
    }
    const row = await this.prisma.techpieLink.update({ where: { id }, data });
    return toLinkModel(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.techpieLink.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

@Injectable()
export class TechpieSyncJobPrismaRepository implements TechpieSyncJobRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listByUser(userId: string, { cursor, limit }: TechpieListParams): Promise<Page<TechpieSyncJobModel>> {
    const id = decodeCursor(cursor);

    // 归属校验：先取本人的 link id，再按 `linkId in (...)` 查任务。
    //
    // 为什么不是 `where: { link: { userId } }`（关系过滤）？
    //   1. 关系过滤会生成 JOIN，而本仓库的**离线测试夹具**（内存版 Prisma）
    //      刻意不支持 include/关系查询 —— 两段式查询让 e2e 跑在真实仓储上，
    //      而不是"给假 Prisma 写一段假的关系过滤"；
    //   2. 越权读在**第一段**就被切断（拿不到别人的 linkId），
    //      第二段的 `in` 只是一次范围收窄，语义更直白。
    const links = await this.prisma.techpieLink.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    const linkIds = links.map((link) => link.id);
    if (linkIds.length === 0) return { items: [], nextCursor: null };

    const rows = await this.prisma.techpieSyncJob.findMany({
      where: { linkId: { in: linkIds } },
      take: limit + 1,
      orderBy: { id: 'asc' },
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });
    return pageOf(rows, limit, toJobModel);
  }

  async create(input: CreateTechpieSyncJobInput): Promise<TechpieSyncJobModel> {
    const row = await this.prisma.techpieSyncJob.create({
      data: {
        linkId: input.linkId,
        kind: input.kind,
        ...(input.status ? { status: input.status } : {}),
        lastError: input.lastError ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
      },
    });
    return toJobModel(row);
  }
}
