import { Inject, Injectable, Optional } from '@nestjs/common';
import { MINIAPP_PAGES, type Page } from '@kedaya/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  NOTIFICATION_PORT,
  miniappDetailLink,
  type NotificationPort,
} from '../../common/notifications/notification.port';
import { MEDIA_URL_POLICY } from '../../common/media/media.port';
import {
  normalizeImageUrls,
  resolveMediaUrlPolicy,
  type MediaUrlPolicy,
} from '../../common/media/media-url';
import {
  FLEA_CATEGORIES,
  FLEA_CONDITIONS,
  FLEA_ITEM_REPOSITORY,
  FLEA_MAX_PRICE_FEN,
  FLEA_SORTS,
  FLEA_STATUS,
  type CreateFleaItemInput,
  type FleaItemListQuery,
  type FleaItemModel,
  type FleaItemRepository,
  type FleaSort,
  type UpdateFleaItemInput,
} from './domain/flea-market.domain';

/**
 * 跳蚤市场用例层（契约 §7：controller → service → repository）。
 *
 * 这里集中放置**领域规则**，让 controller 只做 HTTP 形状、repository 只做 IO：
 *   · 归属：只有发布者本人能改 / 删 / 标记售出；
 *   · 状态机：on-sale → reserved → sold，非法跃迁返回 CONFLICT；
 *   · 校验：标题长度、价格区间、分类与成色白名单（客户端传了脏数据也不会落库）；
 *   · 列表：筛选条件直接透传仓储，`mine=1` 由 controller 翻译成 `sellerId = 当前用户`。
 *
 * 依赖用**显式 token** 注入（不使用 design:paramtypes），
 * 因此 `new FleaItemService(fakeRepo)` 就能在 vitest 里直接测，无需 DI 容器。
 * `notifier` 是 `@Optional()` 的：纯领域单测可以不提供它。
 */
@Injectable()
export class FleaItemService {
  constructor(
    @Inject(FLEA_ITEM_REPOSITORY) private readonly repo: FleaItemRepository,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifier?: NotificationPort,
    /**
     * 图片地址白名单策略（`@Optional()`：纯领域单测不提供它，
     * 此时退回默认策略 —— 仍然校验，只是不认 CDN 前缀）。
     */
    @Optional() @Inject(MEDIA_URL_POLICY) private readonly mediaUrlPolicy?: MediaUrlPolicy,
  ) {}

  async list(query: Partial<FleaItemListQuery> = {}): Promise<Page<FleaItemModel>> {
    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.category === undefined ? {} : { category: normalizeCategory(query.category) }),
      ...(query.condition === undefined ? {} : { condition: normalizeCondition(query.condition) }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword.trim().slice(0, 60) }),
      ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      sort: normalizeSort(query.sort),
    });
  }

  async create(input: CreateFleaItemInput, actorId?: string): Promise<FleaItemModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发布商品');

    return this.repo.create({
      sellerId: actorId, // 永远以登录主体为准，忽略请求体里的 sellerId
      title: normalizeTitle(input.title),
      description: normalizeText(input.description, 2000, '商品描述'),
      priceFen: normalizePrice(input.priceFen),
      category: normalizeCategory(input.category),
      condition: input.condition === undefined ? 'good' : normalizeCondition(input.condition),
      campusSpot: normalizeText(input.campusSpot, 60, '交易地点'),
      // 图片：只接受本平台上传的地址（防外链 / 追踪像素），数量上限由策略统一把关
      imageUrls: normalizeImageUrls(input.imageUrls, resolveMediaUrlPolicy(this.mediaUrlPolicy)),
    });
  }

  async detail(id: string): Promise<FleaItemModel> {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundError('商品不存在或已被删除');
    return item;
  }

  async update(id: string, input: UpdateFleaItemInput, actorId?: string): Promise<FleaItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只能修改自己发布的商品');

    if (item.status === FLEA_STATUS.sold) {
      throw new ConflictError('已售出的商品不能再修改');
    }

    const patch: UpdateFleaItemInput = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.description !== undefined) {
      patch.description = normalizeText(input.description, 2000, '商品描述');
    }
    if (input.priceFen !== undefined) patch.priceFen = normalizePrice(input.priceFen);
    if (input.category !== undefined) patch.category = normalizeCategory(input.category);
    if (input.condition !== undefined) patch.condition = normalizeCondition(input.condition);
    if (input.campusSpot !== undefined) {
      patch.campusSpot = normalizeText(input.campusSpot, 60, '交易地点');
    }
    if (input.imageUrls !== undefined) {
      patch.imageUrls = normalizeImageUrls(input.imageUrls, resolveMediaUrlPolicy(this.mediaUrlPolicy));
    }

    return this.repo.update(id, patch);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只能删除自己发布的商品');
    await this.repo.remove(id);
  }

  /**
   * 买家预定（"我想要"）。
   *
   * 与"下单/支付"刻意分开：校园跳蚤市场是**线下当面交易**，
   * 平台只负责撮合与状态同步，不碰资金（契约 §9 合规）。
   */
  async reserve(id: string, actorId?: string): Promise<FleaItemModel> {
    const item = await this.detail(id);
    if (!actorId) throw new UnauthenticatedError('请先登录后再预定');
    if (item.sellerId === actorId) throw new ValidationError('不能预定自己发布的商品');
    if (item.status !== FLEA_STATUS.onSale) {
      throw new ConflictError(
        item.status === FLEA_STATUS.reserved ? '该商品已被预定' : '该商品已售出',
      );
    }
    const updated = await this.repo.applyState(id, { status: FLEA_STATUS.reserved, reservedById: actorId });

    // 通知卖家：有人想要。预定是"线下当面交易"的起点，
    // 卖家很可能不会一直盯着列表页，这条通知是他唯一的及时提醒。
    await this.notifySafely({
      userId: item.sellerId,
      title: '有人预定了你的闲置',
      body: `「${item.title}」被同学预定了，请尽快联系确认交易方式。`,
      source: 'flea-market',
      link: miniappDetailLink(MINIAPP_PAGES.fleaDetail, id),
    });

    return updated;
  }

  /** 卖家解除预定（买家反悔 / 卖家改主意） */
  async release(id: string, actorId?: string): Promise<FleaItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只有卖家可以解除预定');
    if (item.status !== FLEA_STATUS.reserved) {
      throw new ConflictError('该商品当前没有被预定');
    }

    const updated = await this.repo.applyState(id, { status: FLEA_STATUS.onSale, reservedById: null });

    // 通知原预定人：预定被解除了。不发的话，买家会一直等一个不会到来的交易。
    if (item.reservedById) {
      await this.notifySafely({
        userId: item.reservedById,
        title: '你的预定已被解除',
        body: `「${item.title}」的卖家解除了预定，商品重新上架。`,
        source: 'flea-market',
        link: miniappDetailLink(MINIAPP_PAGES.fleaDetail, id),
      });
    }

    return updated;
  }

  /** 卖家标记已售出（终态） */
  async markSold(id: string, actorId?: string): Promise<FleaItemModel> {
    const item = await this.detail(id);
    this.assertOwner(item, actorId, '只有卖家可以标记售出');
    if (item.status === FLEA_STATUS.sold) {
      throw new ConflictError('该商品已经售出');
    }
    return this.repo.applyState(id, {
      status: FLEA_STATUS.sold,
      soldAt: new Date(),
    });
  }

  private assertOwner(item: FleaItemModel, actorId: string | undefined, message: string): void {
    if (!actorId) throw new UnauthenticatedError('请先登录');
    if (item.sellerId !== actorId) throw new ForbiddenError(message);
  }

  /**
   * 写站内信（best-effort）。
   * 预定/解除预定这样的**状态已经落库**，通知失败只意味着"对方晚点才知道"，
   * 绝不能因此让请求失败（用户重试会造成状态机二次跃迁）。
   */
  private async notifySafely(input: Parameters<NotificationPort['notify']>[0]): Promise<void> {
    if (!this.notifier) return;
    try {
      await this.notifier.notify(input);
    } catch {
      // 已在 NotificationService 内记日志；这里只保证不向上抛
    }
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写商品标题', { field: 'title' });
  if ([...title].length > 60) throw new ValidationError('标题最多 60 个字', { field: 'title' });
  return title;
}

function normalizePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('价格必须是以「分」为单位的整数', { field: 'priceFen' });
  }
  if (value < 0) throw new ValidationError('价格不能为负数', { field: 'priceFen' });
  if (value > FLEA_MAX_PRICE_FEN) {
    throw new ValidationError('价格超出上限（100 万元）', { field: 'priceFen' });
  }
  return value;
}

function normalizeCategory(value: unknown): string {
  if (typeof value !== 'string' || !(FLEA_CATEGORIES as readonly string[]).includes(value)) {
    throw new ValidationError('商品分类不在支持范围内', {
      field: 'category',
      allowed: FLEA_CATEGORIES,
    });
  }
  return value;
}

function normalizeCondition(value: unknown): string {
  if (typeof value !== 'string' || !(FLEA_CONDITIONS as readonly string[]).includes(value)) {
    throw new ValidationError('成色不在支持范围内', {
      field: 'condition',
      allowed: FLEA_CONDITIONS,
    });
  }
  return value;
}

function normalizeSort(value: unknown): FleaSort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(FLEA_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: FLEA_SORTS });
  }
  return value as FleaSort;
}

function normalizeText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}
