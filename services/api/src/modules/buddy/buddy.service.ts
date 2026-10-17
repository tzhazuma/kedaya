import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  BUDDY_ACTIVITIES,
  BUDDY_GROUP_REPOSITORY,
  BUDDY_MAX_CAPACITY,
  BUDDY_MIN_CAPACITY,
  BUDDY_SORTS,
  BUDDY_STATUS,
  BUDDY_STATUSES,
  type BuddyGroupDetail,
  type BuddyGroupListQuery,
  type BuddyGroupModel,
  type BuddyGroupRepository,
  type BuddySort,
  type CreateBuddyGroupInput,
} from './domain/buddy.domain';

/**
 * 找搭子用例层（契约 §7：controller → service → repository）。
 *
 * 这里是本模块的**核心领域规则**所在：
 *   · 归属：只有组长能停止招募 / 取消；组长不能退出（必须走 cancel）；
 *   · 容量：人数达到 capacity 自动 `recruiting → full`，有人退出回落到 `recruiting`；
 *   · 状态机：`recruiting → full → closed`，`cancelled` 为终态；
 *   · 校验：活动白名单、容量区间、开始时间、文本长度。
 *
 * 依赖用**显式 token** 注入，因此 `new BuddyGroupService(fakeRepo)` 可直接在 vitest 里测。
 */
@Injectable()
export class BuddyGroupService {
  constructor(@Inject(BUDDY_GROUP_REPOSITORY) private readonly repo: BuddyGroupRepository) {}

  async list(query: Partial<BuddyGroupListQuery> = {}): Promise<Page<BuddyGroupModel>> {
    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.activity === undefined ? {} : { activity: normalizeActivity(query.activity) }),
      ...(query.status === undefined ? {} : { status: normalizeStatus(query.status) }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword.trim().slice(0, 60) }),
      ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
      ...(query.joinedUserId === undefined ? {} : { joinedUserId: query.joinedUserId }),
      ...(query.onlyUpcoming === undefined ? {} : { onlyUpcoming: query.onlyUpcoming }),
      sort: normalizeSort(query.sort),
    });
  }

  async create(input: CreateBuddyGroupInput, actorId?: string): Promise<BuddyGroupModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发起搭子招募');

    return this.repo.create({
      ownerId: actorId, // 永远以登录主体为准
      activity: normalizeActivity(input.activity),
      title: normalizeTitle(input.title),
      description: normalizeText(input.description, 2000, '搭子简介'),
      campusSpot: normalizeSpot(input.campusSpot),
      startsAt: normalizeStartsAt(input.startsAt),
      capacity: normalizeCapacity(input.capacity),
    });
  }

  /** 详情：带上成员列表（含展示名与头像） */
  async detail(id: string): Promise<BuddyGroupDetail> {
    const group = await this.requireGroup(id);
    const members = await this.repo.listMembers(id);
    return { ...group, members };
  }

  /**
   * 加入搭子。
   *
   * 四道闸：不能加自己建的、不能重复加入、必须还在招募中、不能超容量。
   * 人数刚好达到容量时把状态推进为 `full`（同一步完成，避免第二次并发加入绕过容量）。
   */
  async join(id: string, actorId?: string): Promise<BuddyGroupModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再加入搭子');

    const group = await this.requireGroup(id);
    if (group.ownerId === actorId) {
      throw new ValidationError('不能加入自己创建的搭子');
    }
    if (await this.repo.findMembership(id, actorId)) {
      throw new ConflictError('你已经加入这个搭子了');
    }
    if (group.status !== BUDDY_STATUS.recruiting) {
      throw new ConflictError(
        group.status === BUDDY_STATUS.full ? '这个搭子已经满员了' : '这个搭子已经停止招募了',
      );
    }

    const count = await this.repo.countMembers(id);
    if (count >= group.capacity) {
      throw new ConflictError('这个搭子已经满员了');
    }

    const member = await this.repo.addMember(id, actorId, 'member');
    if (!member) {
      // 并发下唯一约束兜底：与上面的预检查同义
      throw new ConflictError('你已经加入这个搭子了');
    }

    if (count + 1 >= group.capacity) {
      return this.repo.applyState(id, BUDDY_STATUS.full);
    }
    return group;
  }

  /** 退出搭子：本人操作；组长不能退出（必须走 cancel） */
  async leave(id: string, actorId?: string): Promise<BuddyGroupModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录');

    const group = await this.requireGroup(id);
    const membership = await this.repo.findMembership(id, actorId);
    if (!membership) {
      throw new ValidationError('你还没有加入这个搭子');
    }
    if (membership.role === 'owner') {
      throw new ConflictError('组长不能退出，请使用「取消招募」来结束这个搭子');
    }

    await this.repo.removeMember(id, actorId);

    // 满员的人退出后腾出名额，重新开放招募
    const remaining = await this.repo.countMembers(id);
    if (group.status === BUDDY_STATUS.full && remaining < group.capacity) {
      return this.repo.applyState(id, BUDDY_STATUS.recruiting);
    }
    return group;
  }

  /** 组长手动停止招募：只能从 `recruiting` 推进到 `closed` */
  async close(id: string, actorId?: string): Promise<BuddyGroupModel> {
    const group = await this.requireGroup(id);
    this.assertOwner(group, actorId, '只有组长可以停止招募');

    if (group.status !== BUDDY_STATUS.recruiting) {
      throw new ConflictError('只有招募中的搭子可以停止招募');
    }
    return this.repo.applyState(id, BUDDY_STATUS.closed);
  }

  /** 组长取消（解散）搭子：终态 */
  async cancel(id: string, actorId?: string): Promise<BuddyGroupModel> {
    const group = await this.requireGroup(id);
    this.assertOwner(group, actorId, '只有组长可以取消搭子');

    if (group.status === BUDDY_STATUS.closed || group.status === BUDDY_STATUS.cancelled) {
      throw new ConflictError('这个搭子已经结束了');
    }
    return this.repo.applyState(id, BUDDY_STATUS.cancelled);
  }

  private async requireGroup(id: string): Promise<BuddyGroupModel> {
    const group = await this.repo.findById(id);
    if (!group) throw new NotFoundError('搭子不存在或已被解散');
    return group;
  }

  private assertOwner(group: BuddyGroupModel, actorId: string | undefined, message: string): void {
    if (!actorId) throw new UnauthenticatedError('请先登录');
    if (group.ownerId !== actorId) throw new ForbiddenError(message);
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写搭子标题', { field: 'title' });
  if ([...title].length > 60) throw new ValidationError('标题最多 60 个字', { field: 'title' });
  return title;
}

function normalizeSpot(value: unknown): string {
  const spot = typeof value === 'string' ? value.trim() : '';
  if (spot.length === 0) throw new ValidationError('请填写集合地点', { field: 'campusSpot' });
  if ([...spot].length > 60) throw new ValidationError('集合地点最多 60 个字', { field: 'campusSpot' });
  return spot;
}

function normalizeActivity(value: unknown): string {
  if (typeof value !== 'string' || !(BUDDY_ACTIVITIES as readonly string[]).includes(value)) {
    throw new ValidationError('活动类型不在支持范围内', {
      field: 'activity',
      allowed: BUDDY_ACTIVITIES,
    });
  }
  return value;
}

function normalizeCapacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('人数上限必须是整数', { field: 'capacity' });
  }
  if (value < BUDDY_MIN_CAPACITY || value > BUDDY_MAX_CAPACITY) {
    throw new ValidationError(
      `人数上限需在 ${BUDDY_MIN_CAPACITY}~${BUDDY_MAX_CAPACITY} 之间`,
      { field: 'capacity' },
    );
  }
  return value;
}

function normalizeStartsAt(value: unknown): Date {
  const startsAt = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError('开始时间格式不正确', { field: 'startsAt' });
  }
  if (startsAt.getTime() <= Date.now()) {
    throw new ValidationError('开始时间必须晚于当前时间', { field: 'startsAt' });
  }
  return startsAt;
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string' || !(BUDDY_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('搭子状态不在支持范围内', {
      field: 'status',
      allowed: BUDDY_STATUSES,
    });
  }
  return value;
}

function normalizeSort(value: unknown): BuddySort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(BUDDY_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: BUDDY_SORTS });
  }
  return value as BuddySort;
}

function normalizeText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}
