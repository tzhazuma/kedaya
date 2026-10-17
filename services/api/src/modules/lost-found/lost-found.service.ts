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
  LOST_FOUND_CLOCK_SKEW_MS,
  LOST_FOUND_ITEM_REPOSITORY,
  LOST_FOUND_KINDS,
  LOST_FOUND_SORTS,
  LOST_FOUND_STATUS,
  LOST_FOUND_STATUSES,
  type CreateLostFoundItemInput,
  type LostFoundItemListQuery,
  type LostFoundItemModel,
  type LostFoundItemRepository,
  type LostFoundSort,
  type UpdateLostFoundItemInput,
} from './domain/lost-found.domain';

/**
 * 失物招领用例层（契约 §7：controller → service → repository）。
 *
 * 领域规则：
 *   · 归属：只有发布者能改 / 删 / 标记已找回 / 重新开放；
 *   · 状态机：open ↔ resolved（resolve 幂等冲突返回 CONFLICT，reopen 反向）；
 *   · 校验：类型白名单、事发时间不能在未来（留 5 分钟时钟偏差）、文本长度。
 *
 * 依赖用**显式 token** 注入，因此 `new LostFoundItemService(fakeRepo)` 可直接在 vitest 里测。
 */
@Injectable()
export class LostFoundItemService {
  constructor(@Inject(LOST_FOUND_ITEM_REPOSITORY) private readonly repo: LostFoundItemRepository) {}

  async list(query: Partial<LostFoundItemListQuery> = {}): Promise<Page<LostFoundItemModel>> {
    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.kind === undefined ? {} : { kind: normalizeKind(query.kind) }),
      ...(query.status === undefined ? {} : { status: normalizeStatus(query.status) }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword.trim().slice(0, 60) }),
      ...(query.place === undefined ? {} : { place: query.place.trim().slice(0, 60) }),
      ...(query.reporterId === undefined ? {} : { reporterId: query.reporterId }),
      sort: normalizeSort(query.sort),
    });
  }

  async create(input: CreateLostFoundItemInput, actorId?: string): Promise<LostFoundItemModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发布失物招领');

    return this.repo.create({
      reporterId: actorId, // 永远以登录主体为准，忽略请求体里的 reporterId
      kind: normalizeKind(input.kind),
      title: normalizeTitle(input.title),
      description: normalizeText(input.description, 2000, '详细描述'),
      place: normalizePlace(input.place),
      happenedAt: normalizeHappenedAt(input.happenedAt),
      contactHint: normalizeText(input.contactHint, 60, '联系方式提示'),
    });
  }

  async detail(id: string): Promise<LostFoundItemModel> {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundError('失物招领信息不存在或已被删除');
    return item;
  }

  async update(id: string, input: UpdateLostFoundItemInput, actorId?: string): Promise<LostFoundItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只能修改自己发布的信息');

    const patch: UpdateLostFoundItemInput = {};
    if (input.kind !== undefined) patch.kind = normalizeKind(input.kind);
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.description !== undefined) {
      patch.description = normalizeText(input.description, 2000, '详细描述');
    }
    if (input.place !== undefined) patch.place = normalizePlace(input.place);
    if (input.happenedAt !== undefined) patch.happenedAt = normalizeHappenedAt(input.happenedAt);
    if (input.contactHint !== undefined) {
      patch.contactHint = normalizeText(input.contactHint, 60, '联系方式提示');
    }

    return this.repo.update(id, patch);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只能删除自己发布的信息');
    await this.repo.remove(id);
  }

  /** 发布者标记「已找回 / 已归还」 */
  async resolve(id: string, actorId?: string): Promise<LostFoundItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只有发布者可以标记为已解决');

    if (item.status === LOST_FOUND_STATUS.resolved) {
      throw new ConflictError('这条信息已经标记为已解决');
    }

    return this.repo.applyStatus(id, {
      status: LOST_FOUND_STATUS.resolved,
      resolvedAt: new Date(),
    });
  }

  /** 发布者重新开放（信息有误 / 又丢了） */
  async reopen(id: string, actorId?: string): Promise<LostFoundItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只有发布者可以重新开放');

    if (item.status !== LOST_FOUND_STATUS.resolved) {
      throw new ConflictError('这条信息当前不是已解决状态');
    }

    return this.repo.applyStatus(id, {
      status: LOST_FOUND_STATUS.open,
      resolvedAt: null,
    });
  }

  private assertOwner(item: LostFoundItemModel, actorId: string | undefined, message: string): void {
    if (!actorId) throw new UnauthenticatedError('请先登录');
    if (item.reporterId !== actorId) throw new ForbiddenError(message);
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeKind(value: unknown): string {
  if (typeof value !== 'string' || !(LOST_FOUND_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError('信息类型不在支持范围内', {
      field: 'kind',
      allowed: LOST_FOUND_KINDS,
    });
  }
  return value;
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string' || !(LOST_FOUND_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('状态不在支持范围内', {
      field: 'status',
      allowed: LOST_FOUND_STATUSES,
    });
  }
  return value;
}

function normalizeSort(value: unknown): LostFoundSort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(LOST_FOUND_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: LOST_FOUND_SORTS });
  }
  return value as LostFoundSort;
}

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写物品名称', { field: 'title' });
  if ([...title].length > 60) throw new ValidationError('物品名称最多 60 个字', { field: 'title' });
  return title;
}

function normalizePlace(value: unknown): string {
  const place = typeof value === 'string' ? value.trim() : '';
  if (place.length === 0) throw new ValidationError('请填写地点', { field: 'place' });
  if ([...place].length > 60) throw new ValidationError('地点最多 60 个字', { field: 'place' });
  return place;
}

function normalizeHappenedAt(value: unknown): Date {
  const happenedAt = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(happenedAt.getTime())) {
    throw new ValidationError('事发时间格式不正确', { field: 'happenedAt' });
  }
  // 留 5 分钟偏差：手机时钟略快不该导致发布失败，但「未来的丢东西」没有意义
  if (happenedAt.getTime() > Date.now() + LOST_FOUND_CLOCK_SKEW_MS) {
    throw new ValidationError('事发时间不能晚于当前时间', { field: 'happenedAt' });
  }
  return happenedAt;
}

function normalizeText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}
