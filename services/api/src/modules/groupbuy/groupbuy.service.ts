import { Inject, Injectable, Optional } from '@nestjs/common';
import { MINIAPP_PAGES, type Page } from '@kedaya/contracts';
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from '../../common/errors/app-error';
import {
  NOTIFICATION_PORT,
  miniappDetailLink,
  type NotificationPort,
} from '../../common/notifications/notification.port';
import {
  GROUPBUY_CATEGORIES,
  GROUPBUY_MAX_TARGET_COUNT,
  GROUPBUY_MAX_UNIT_PRICE_FEN,
  GROUPBUY_ORDER_REPOSITORY,
  GROUPBUY_SORTS,
  GROUPBUY_STATUS,
  type CreateGroupbuyOrderInput,
  type GroupbuyCategory,
  type GroupbuyMineRole,
  type GroupbuyOrderListQuery,
  type GroupbuyOrderRepository,
  type GroupbuyOrderView,
  type GroupbuySort,
  type UpdateGroupbuyOrderInput,
} from './domain/groupbuy.domain';

/**
 * 拼单用例层（契约 §7：controller → service → repository）。
 *
 * 领域规则集中在这里，controller 只做 HTTP 形状、repository 只做 IO：
 *   · 归属：只有发起人能改 / 删；
 *   · 状态机：`open` → `full` 由参团次数推进；发起人不能参团自己的单；
 *   · 校验：标题长度、人数区间、单价区间、分类白名单、截止时间必须晚于现在；
 *   · 通知：参团与成团都会给相关人写站内信（best-effort，失败不影响主流程）。
 *
 * 依赖用**显式 token** 注入（不使用 design:paramtypes），
 * 因此 `new GroupbuyOrderService(fakeRepo)` 在 vitest 里可直接测，无需 DI 容器。
 * `notifier` 用 `@Optional()`：单元测试只关心领域规则时可以不提供它。
 */
@Injectable()
export class GroupbuyOrderService {
  constructor(
    @Inject(GROUPBUY_ORDER_REPOSITORY) private readonly repo: GroupbuyOrderRepository,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifier?: NotificationPort,
  ) {}

  async list(query: Partial<GroupbuyOrderListQuery> & { actorId?: string } = {}): Promise<Page<GroupbuyOrderView>> {
    const mine = normalizeMine(query.mine, query.actorId);

    return this.repo.list({
      limit: query.limit ?? 20,
      sort: normalizeSort(query.sort),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.category === undefined ? {} : { category: normalizeCategory(query.category) }),
      ...(query.keyword === undefined ? {} : { keyword: normalizeKeyword(query.keyword) }),
      ...(mine === undefined ? {} : { mine }),
    });
  }

  async create(input: CreateGroupbuyOrderInput, actorId?: string): Promise<GroupbuyOrderView> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发起拼单');

    const created = await this.repo.create({
      ownerId: actorId, // 归属永远以登录主体为准，请求体里的 ownerId 一概忽略
      title: normalizeTitle(input.title),
      description: normalizeText(input.description, 500, '说明'),
      category: normalizeCategory(input.category),
      targetCount: normalizeTargetCount(input.targetCount),
      unitPriceFen: normalizeUnitPrice(input.unitPriceFen),
      deadline: normalizeDeadline(input.deadline),
      pickupSpot: normalizeText(input.pickupSpot, 60, '取货地点'),
    });

    // 创建后立刻回读视图（含发起人自己的参团记录），
    // 前端拿到就能直接渲染"1/3 已参团"，不必再发一次详情请求。
    return this.detail(created.id);
  }

  async detail(id: string): Promise<GroupbuyOrderView> {
    const order = await this.repo.findById(id);
    if (!order) throw new NotFoundError('拼单不存在或已被删除');
    return order;
  }

  async update(id: string, input: UpdateGroupbuyOrderInput, actorId?: string): Promise<GroupbuyOrderView> {
    const order = await this.detail(id);
    assertOwner(order.initiatorId, actorId, '只能修改自己发起的拼单');

    if (order.status === GROUPBUY_STATUS.full) {
      throw new ConflictError('已成团的拼单不能再修改');
    }

    const patch: UpdateGroupbuyOrderInput = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.description !== undefined) patch.description = normalizeText(input.description, 500, '说明');
    if (input.category !== undefined) patch.category = normalizeCategory(input.category);
    if (input.targetCount !== undefined) patch.targetCount = normalizeTargetCount(input.targetCount);
    if (input.unitPriceFen !== undefined) patch.unitPriceFen = normalizeUnitPrice(input.unitPriceFen);
    if (input.deadline !== undefined) patch.deadline = normalizeDeadline(input.deadline);
    if (input.pickupSpot !== undefined) patch.pickupSpot = normalizeText(input.pickupSpot, 60, '取货地点');

    await this.repo.update(id, patch);
    return this.detail(id);
  }

  /** 取消拼单（保留历史，不物理删除 —— 已参团的同学需要看到"被取消了"） */
  async cancel(id: string, actorId?: string): Promise<GroupbuyOrderView> {
    const order = await this.detail(id);
    assertOwner(order.initiatorId, actorId, '只能取消自己发起的拼单');
    if (order.status === GROUPBUY_STATUS.cancelled) {
      throw new ConflictError('该拼单已经取消');
    }
    await this.repo.setStatus(id, GROUPBUY_STATUS.cancelled);
    return this.detail(id);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const order = await this.detail(id);
    assertOwner(order.initiatorId, actorId, '只能删除自己发起的拼单');
    await this.repo.remove(id);
  }

  /**
   * 参团（契约 §6.1 的 `POST /items/:id/join`）。
   *
   * 幂等：`repo.join` 是按 `(orderId, userId)` 的 upsert，
   * 因此弱网重试不会把同一个人算成两份。
   */
  async join(id: string, userId: string, quantity: number): Promise<GroupbuyOrderView> {
    const safeQuantity = normalizeJoinQuantity(quantity);
    const order = await this.detail(id);

    if (order.status === GROUPBUY_STATUS.cancelled) {
      throw new ConflictError('该拼单已被发起人取消');
    }
    if (order.status === GROUPBUY_STATUS.full) {
      throw new ConflictError('该拼单已经成团，来晚了一步');
    }
    if (order.status === GROUPBUY_STATUS.closed) {
      throw new ConflictError('该拼单已过截止时间');
    }
    if (order.initiatorId === userId) {
      throw new ValidationError('不能参团自己发起的拼单，你已经是一份了');
    }

    const already = order.participants.find((item) => item.id === userId);
    if (already) {
      throw new ConflictError('你已经参团了');
    }

    const joinedQuantity = order.participants.reduce((sum, item) => sum + item.quantity, 0);
    if (joinedQuantity + safeQuantity > order.targetCount) {
      const remaining = Math.max(0, order.targetCount - joinedQuantity);
      throw new ConflictError(remaining === 0 ? '该拼单已经成团' : `只剩 ${remaining} 份了`);
    }

    await this.repo.join(id, userId, safeQuantity);

    // 成团判定用**份数**而不是"成员行数"：有人一次参团 2 份时，
    // 行数与份数不等，用行数会晚成团（甚至不成团）。
    const joinedAfter = joinedQuantity + safeQuantity;
    let becameFull = false;
    if (joinedAfter >= order.targetCount) {
      // 数据库里的 grouped 是内部记账位：对外状态仍由 deriveGroupbuyStatus 推导。
      await this.repo.setStatus(id, 'grouped');
      becameFull = true;
    }

    const updated = await this.detail(id);
    await this.notifyAfterJoin(updated, becameFull);
    return updated;
  }

  /** 参团 / 成团通知（best-effort，失败只记日志，见 NotificationPort 注释） */
  private async notifyAfterJoin(order: GroupbuyOrderView, becameFull: boolean): Promise<void> {
    if (!this.notifier) return;

    const link = miniappDetailLink(MINIAPP_PAGES.groupBuyDetail, order.id);
    const joined = order.participants.reduce((sum, item) => sum + item.quantity, 0);
    const remaining = Math.max(0, order.targetCount - joined);
    const pickup = order.pickupPlace ? `，请到${order.pickupPlace}取货` : '';

    const drafts = [
      {
        userId: order.initiatorId,
        title: becameFull ? '你的拼单成团了' : '有人参团了你的拼单',
        body: becameFull
          ? `「${order.title}」已凑齐 ${joined} 份${pickup}。`
          : `「${order.title}」已有 ${joined}/${order.targetCount} 份，还差 ${remaining} 份。`,
        source: 'groupbuy',
        link,
      },
    ];

    // 成团时通知所有参与者（发起人上面已经写过，跳过）
    if (becameFull) {
      for (const participant of order.participants) {
        if (participant.id === order.initiatorId) continue;
        drafts.push({
          userId: participant.id,
          title: '你参与的拼单成团了',
          body: `「${order.title}」已凑齐 ${joined} 份${pickup}。`,
          source: 'groupbuy',
          link,
        });
      }
    }

    await this.notifier.notify(drafts);
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写拼单标题', { field: 'title' });
  if ([...title].length > 60) throw new ValidationError('标题最多 60 个字', { field: 'title' });
  return title;
}

function normalizeCategory(value: unknown): GroupbuyCategory {
  if (typeof value !== 'string' || !(GROUPBUY_CATEGORIES as readonly string[]).includes(value)) {
    throw new ValidationError('拼单分类不在支持范围内', {
      field: 'category',
      allowed: GROUPBUY_CATEGORIES,
    });
  }
  return value as GroupbuyCategory;
}

function normalizeTargetCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('成团人数必须是整数', { field: 'targetCount' });
  }
  if (value < 2) throw new ValidationError('成团人数至少 2 人', { field: 'targetCount' });
  if (value > GROUPBUY_MAX_TARGET_COUNT) {
    throw new ValidationError(`成团人数最多 ${GROUPBUY_MAX_TARGET_COUNT} 人`, { field: 'targetCount' });
  }
  return value;
}

function normalizeUnitPrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('单价必须是以「分」为单位的整数', { field: 'unitPriceFen' });
  }
  if (value < 0) throw new ValidationError('单价不能为负数', { field: 'unitPriceFen' });
  if (value > GROUPBUY_MAX_UNIT_PRICE_FEN) {
    throw new ValidationError('单价超出上限（1 万元）', { field: 'unitPriceFen' });
  }
  return value;
}

function normalizeDeadline(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('截止时间格式不正确', { field: 'deadline' });
  }
  if (date.getTime() <= Date.now()) {
    throw new ValidationError('截止时间必须晚于现在', { field: 'deadline' });
  }
  return date;
}

function normalizeJoinQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError('参团份数必须是正整数', { field: 'quantity' });
  }
  if (value > GROUPBUY_MAX_TARGET_COUNT) {
    throw new ValidationError('参团份数过多', { field: 'quantity' });
  }
  return value;
}

function normalizeSort(value: unknown): GroupbuySort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(GROUPBUY_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: GROUPBUY_SORTS });
  }
  return value as GroupbuySort;
}

function normalizeKeyword(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : '';
}

function normalizeText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}

/**
 * `mine` 归一化。
 *
 * 硬规则：`mine` 必须由**登录主体**决定，且未登录时直接报错而不是静默返回全部 ——
 * 静默返回全部会让用户以为"我发的拼单怎么这么多"，而实际是把别人的也列出来了。
 */
function normalizeMine(
  mine: GroupbuyOrderListQuery['mine'] | undefined,
  actorId: string | undefined,
): GroupbuyOrderListQuery['mine'] {
  if (mine === undefined) return undefined;
  if (!actorId) throw new UnauthenticatedError('查看「我的拼单」需要先登录');
  const role: GroupbuyMineRole = mine.role === 'owner' ? 'owner' : 'member';
  return { userId: actorId, role };
}

function assertOwner(ownerId: string, actorId: string | undefined, message: string): void {
  if (!actorId) throw new UnauthenticatedError('请先登录');
  if (ownerId !== actorId) throw new ForbiddenError(message);
}

/** 供 controller 复用的白名单（避免在 controller 里再写一遍） */
export const GROUPBUY_MINE_ROLE_VALUES = ['owner', 'member'] as const;
