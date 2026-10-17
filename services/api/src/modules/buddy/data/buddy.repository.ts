/**
 * 找搭子 · data 层：资料 / 帖子 / 用户（契约 §7：唯一允许碰 IO 的地方）
 *
 * ## 为什么手写映射而不是复用 `PrismaCursorRepository`
 *
 * 通用基类假设"列表按主键排序 + 单键游标"。buddy 的列表要
 * `createdAt_desc`（契约 §3.1 的单键游标）**和** `startsAt_asc`
 * （需要复合游标 `(startsAt, id)`，否则会跳条，规格 §5.9 / U3）。
 * 硬套基类会得到一个"看起来能用但会漏数据"的分页。
 *
 * ## 为什么不用 Prisma 的 `include`
 *
 * 全部改成"先查主表 → 收集 id → 批量查关联 → 内存 join"。两个原因：
 *   1. 关联查询会让分页的 `take` 语义变复杂（`include` + `take` 是 join 后截断）；
 *   2. 测试用的内存版 Prisma 只需支持 `findMany/create/update` 这一小撮方法，
 *      HTTP e2e 才可能走**真实**控制器/守卫/仓储（见 test/fixtures/fake-buddy-prisma.ts）。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AvailabilitySlot } from '@kedaya/shared';
import { decodePostCursor, encodePostCursor } from '../domain/cursor';
import { activitiesOf } from '../domain/section';
import {
  type BuddyCreatorModel,
  type BuddyPostModel,
  type BuddyPostRepository,
  type BuddyProfileModel,
  type BuddyProfileRepository,
  type BuddyUserRepository,
  type CreateBuddyPostInput,
  type PostListQuery,
  type PostPage,
  type PostWithCreator,
  type UpdateBuddyPostInput,
  type UpsertBuddyProfileInput,
} from '../domain/buddy.domain';

/* ------------------------------------------------------------------ *
 * 行 → 领域模型（两层之间**唯一**的接触面）
 * ------------------------------------------------------------------ */

interface ProfileRow {
  userId: string;
  sections: string[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: string | null;
  availability: unknown;
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  matchEnabled: boolean;
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface PostRow {
  id: string;
  creatorId: string;
  activity: string;
  status: string;
  title: string;
  description: string | null;
  location: string;
  startsAt: Date;
  durationMin: number | null;
  capacity: number;
  joinedCount: number;
  genderPreference: string;
  tags: string[];
  minSkillLevel: string | null;
  autoCloseAt: Date | null;
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export function toProfileModel(row: ProfileRow): BuddyProfileModel {
  return {
    userId: row.userId,
    sections: row.sections ?? [],
    interestTags: row.interestTags ?? [],
    activityTags: row.activityTags ?? [],
    skillLevel: row.skillLevel,
    // `availability` 是 Json 列：历史数据可能是任何形状，读取时兜底成 []
    availability: Array.isArray(row.availability) ? (row.availability as AvailabilitySlot[]) : [],
    preferredAreas: row.preferredAreas ?? [],
    department: row.department,
    bio: row.bio,
    matchEnabled: row.matchEnabled,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function toPostModel(row: PostRow): BuddyPostModel {
  return {
    id: row.id,
    creatorId: row.creatorId,
    activity: row.activity,
    status: row.status,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    durationMin: row.durationMin,
    capacity: row.capacity,
    joinedCount: row.joinedCount,
    genderPreference: row.genderPreference,
    tags: row.tags ?? [],
    minSkillLevel: row.minSkillLevel,
    autoCloseAt: row.autoCloseAt,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/* ------------------------------------------------------------------ *
 * 资料
 * ------------------------------------------------------------------ */

@Injectable()
export class BuddyProfilePrismaRepository implements BuddyProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<BuddyProfileModel | null> {
    const row = (await this.prisma.buddyProfile.findFirst({
      where: { userId, deletedAt: null },
    })) as ProfileRow | null;
    return row ? toProfileModel(row) : null;
  }

  async upsert(userId: string, input: UpsertBuddyProfileInput): Promise<BuddyProfileModel> {
    const data = {
      sections: input.sections,
      interestTags: input.interestTags,
      activityTags: input.activityTags,
      skillLevel: input.skillLevel ?? null,
      availability: input.availability as unknown as object,
      preferredAreas: input.preferredAreas,
      department: input.department ?? null,
      bio: input.bio ?? null,
      matchEnabled: input.matchEnabled,
      deletedAt: null,
    };
    const row = (await this.prisma.buddyProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })) as ProfileRow;
    return toProfileModel(row);
  }

  async remove(userId: string): Promise<void> {
    // 硬删（规格 §6.3）：embedding 随行一起消失，立即从推荐池移除。
    // 用 deleteMany 而不是 delete：不存在时也成功（DELETE 语义幂等）。
    await this.prisma.buddyProfile.deleteMany({ where: { userId } });
  }

  async findEnabledByUserIds(userIds: readonly string[]): Promise<Map<string, BuddyProfileModel>> {
    if (userIds.length === 0) return new Map();
    const rows = (await this.prisma.buddyProfile.findMany({
      where: { userId: { in: [...new Set(userIds)] }, matchEnabled: true, deletedAt: null },
    })) as ProfileRow[];
    return new Map(rows.map((row) => [row.userId, toProfileModel(row)]));
  }
}

/* ------------------------------------------------------------------ *
 * 用户（只读公开资料）
 * ------------------------------------------------------------------ */

@Injectable()
export class BuddyUserPrismaRepository implements BuddyUserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findPublicByIds(ids: readonly string[]): Promise<Map<string, BuddyCreatorModel>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, displayName: true, avatarUrl: true },
    })) as Array<{ id: string; displayName: string; avatarUrl: string | null }>;
    return new Map(
      rows.map((row) => [row.id, { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl }]),
    );
  }
}

/* ------------------------------------------------------------------ *
 * 帖子
 * ------------------------------------------------------------------ */

@Injectable()
export class BuddyPostPrismaRepository implements BuddyPostRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: PostListQuery): Promise<PostPage> {
    const activities = resolveActivities(query);
    const statuses = query.statuses && query.statuses.length > 0 ? [...new Set(query.statuses)] : undefined;
    const where: Record<string, unknown> = {
      // ⚠️ 规格 §5.3（query 表无 status → 不过滤）**优先于** §5.9 的 `where status='OPEN'`。
      // 硬编码 OPEN 会让 FULL/CLOSED/CANCELLED 的活动在列表里**静默消失** ——
      // 用户以为活动没了，而它只是满了/被关了（Web 端因此只能自造 includeClosed）。
      // 过滤现在由 `statuses` 显式驱动；缺省不过滤。
      ...(statuses ? { status: { in: statuses } } : {}),
      deletedAt: null,
      startsAt: { gt: query.startsAfter ?? new Date() },
      ...(activities.length > 0 ? { activity: { in: activities } } : {}),
      ...(query.tags && query.tags.length > 0 ? { tags: { hasSome: query.tags } } : {}),
    };

    const startsAtAsc = query.sort === 'startsAt_asc';
    const orderBy: Prisma.BuddyPostOrderByWithRelationInput[] = startsAtAsc
      ? [{ startsAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

    // —— 游标（规格 §5.9）——
    // createdAt_desc：Prisma 原生 cursor + skip:1，游标就是 id，
    //   **逐字符合**契约 api-contract §3.1。
    // startsAt_asc：必须用**行值比较** (startsAt, id) > (c, cId)。
    //   只写 id > cursorId 会跳条，因为 startsAt 顺序与 id 顺序不一致 ——
    //   这是规格 U3 记录的、本模块唯一偏离契约 §3.1 的地方（复合游标）。
    let cursorArgs: Record<string, unknown> = {};
    if (query.cursor) {
      if (startsAtAsc) {
        const decoded = decodePostCursor(query.cursor);
        if (decoded) {
          where.OR = [
            { startsAt: { gt: decoded.startsAt } },
            { AND: [{ startsAt: decoded.startsAt }, { id: { gt: decoded.id } }] },
          ];
        }
      } else {
        const id = decodeCursor(query.cursor);
        if (id) cursorArgs = { cursor: { id }, skip: 1 };
      }
    }

    const rows = (await this.prisma.buddyPost.findMany({
      where,
      orderBy,
      take: query.limit + 1, // 多取一条判断有没有下一页（不做 count 查询）
      ...cursorArgs,
    })) as PostRow[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);

    return {
      items: await this.withCreators(visible),
      nextCursor:
        hasMore && last
          ? startsAtAsc
            ? encodePostCursor(last.startsAt, last.id)
            : encodeCursor(last.id)
          : null,
    };
  }

  async findById(id: string): Promise<PostWithCreator | null> {
    const row = (await this.prisma.buddyPost.findFirst({
      where: { id, deletedAt: null },
    })) as PostRow | null;
    if (!row) return null;
    const [withCreator] = await this.withCreators([row]);
    return withCreator ?? null;
  }

  async findByIds(ids: readonly string[]): Promise<PostWithCreator[]> {
    if (ids.length === 0) return [];
    const rows = (await this.prisma.buddyPost.findMany({
      where: { id: { in: [...new Set(ids)] }, deletedAt: null },
    })) as PostRow[];
    return this.withCreators(rows);
  }

  async findRuleCandidates(
    activities: readonly string[],
    limit: number,
    now: Date,
  ): Promise<PostWithCreator[]> {
    // 这个查询在任何 PostgreSQL 16 上都能跑，不需要任何扩展（规格 §4.5）。
    // 它是"最低可上线版本"。
    const rows = (await this.prisma.buddyPost.findMany({
      where: {
        status: 'OPEN',
        deletedAt: null,
        startsAt: { gt: now },
        ...(activities.length > 0 ? { activity: { in: [...activities] } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
    })) as PostRow[];
    return this.withCreators(rows);
  }

  async create(creatorId: string, input: CreateBuddyPostInput): Promise<PostWithCreator> {
    const row = (await this.prisma.buddyPost.create({
      data: {
        creatorId,
        activity: input.activity,
        status: 'OPEN',
        title: input.title,
        description: input.description ?? null,
        location: input.location,
        startsAt: input.startsAt,
        durationMin: input.durationMin ?? null,
        capacity: input.capacity,
        // 规格 U2：发起人自己占一位，因此 capacity 是**含发起人的总人数**
        joinedCount: 1,
        genderPreference: input.genderPreference ?? 'any',
        tags: input.tags ?? [],
        minSkillLevel: input.minSkillLevel ?? null,
        // 默认与 startsAt 相同（规格 §2.3：autoCloseAt 默认 startsAt）
        autoCloseAt: input.startsAt,
      },
    })) as PostRow;
    const [withCreator] = await this.withCreators([row]);
    return withCreator as PostWithCreator;
  }

  async update(id: string, input: UpdateBuddyPostInput): Promise<PostWithCreator> {
    const row = (await this.prisma.buddyPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt, autoCloseAt: input.startsAt } : {}),
        ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.genderPreference !== undefined ? { genderPreference: input.genderPreference } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.minSkillLevel !== undefined ? { minSkillLevel: input.minSkillLevel } : {}),
      },
    })) as PostRow;
    const [withCreator] = await this.withCreators([row]);
    return withCreator as PostWithCreator;
  }

  async setStatus(id: string, status: string): Promise<PostWithCreator> {
    const row = (await this.prisma.buddyPost.update({
      where: { id },
      data: { status },
    })) as PostRow;
    const [withCreator] = await this.withCreators([row]);
    return withCreator as PostWithCreator;
  }

  async findMyApplicationStatuses(
    userId: string,
    postIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (postIds.length === 0) return new Map();
    const rows = (await this.prisma.buddyApplication.findMany({
      where: { applicantId: userId, postId: { in: [...new Set(postIds)] } },
      select: { postId: true, status: true },
    })) as Array<{ postId: string; status: string }>;
    return new Map(rows.map((row) => [row.postId, row.status]));
  }

  /**
   * 组装"带发起人公开资料"的帖子。
   *
   * 未找到用户时给一个**中性兜底**（`同学`）而不是泄漏"这个用户不存在" ——
   * 后者会让 `NOT_FOUND` 的"不区分不存在与不可见"原则（api-contract §2.1）破功。
   */
  private async withCreators(rows: PostRow[]): Promise<PostWithCreator[]> {
    if (rows.length === 0) return [];
    const creators = await new BuddyUserPrismaRepository(this.prisma).findPublicByIds(
      rows.map((row) => row.creatorId),
    );
    return rows.map((row) => ({
      post: toPostModel(row),
      creator: creators.get(row.creatorId) ?? { id: row.creatorId, displayName: '同学', avatarUrl: null },
    }));
  }
}

/**
 * 解析"按板块 / 按活动"的过滤。
 *
 * `section` 与 `activity` 同时给出时取**交集**（两者都是"只看这些活动"的意思）。
 * 都不给则不过滤 —— 规格 §5.3 说 `section` 不传则不过滤。
 */
function resolveActivities(query: PostListQuery): string[] {
  const fromSection = query.section ? activitiesOf(query.section) : undefined;
  const fromActivity = query.activities && query.activities.length > 0 ? query.activities : undefined;

  if (fromSection && fromActivity) {
    const allowed = new Set<string>(fromSection);
    return fromActivity.filter((activity) => allowed.has(activity));
  }
  if (fromSection) return [...fromSection];
  if (fromActivity) return [...fromActivity];
  return [];
}
