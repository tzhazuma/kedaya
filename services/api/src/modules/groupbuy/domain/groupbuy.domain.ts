/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 与脚手架版本的区别（这个模块是首页主打切片，必须真的能用）：
 *   1. **列表可筛可搜**：分类白名单 / 关键词 / 排序，筛选在**数据库**里做；
 *   2. **`mine` 支持两种角色**：我发起的（owner）与我参与的（member）；
 *   3. **返回"可展示的视图"而不是数据库行**：拼单是社交对象，列表要显示
 *      成团进度、发起人昵称、参团人列表 —— 这些必须由服务端一次查好，
 *      否则客户端要么看不到，要么 N+1 次请求；
 *   4. **状态由服务端推导**成 `open | full | closed | cancelled` 四个值：
 *      数据库里的 `grouped` 只是内部记账，客户端不该知道"几个状态各叫什么"。
 */

import type { Page } from '@kedaya/contracts';

/** 数据库行（内部） */
export interface GroupbuyOrderModel {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  category: string;
  targetCount: number;
  unitPriceFen: number;
  status: string;
  deadline: Date;
  pickupSpot: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupbuyParticipantView {
  /** 参团人 id（前端用它判断"我参团了吗"） */
  id: string;
  displayName: string;
  quantity: number;
  joinedAt: Date;
}

/**
 * 对外视图 —— 列表与详情返回同一个形状。
 *
 * 字段名与小程序端 `domain/models/groupbuy.ts` 的 `GroupBuy` 一一对应
 * （`priceFen` / `initiatorName` / `pickupPlace` / `participants`）。
 * 小程序侧刻意**不做字段改名映射**：两边同名，改一边就编译/测试报错。
 */
export interface GroupbuyOrderView {
  id: string;
  title: string;
  description: string | null;
  category: string;
  initiatorId: string;
  initiatorName: string;
  /** 单价，**分** */
  priceFen: number;
  targetCount: number;
  participants: GroupbuyParticipantView[];
  deadline: Date;
  pickupPlace: string | null;
  status: GroupbuyStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** 对外状态：数据库只记 open/grouped/cancelled，这里推导成客户端认识的四个值 */
export type GroupbuyStatus = 'open' | 'full' | 'closed' | 'cancelled';

export const GROUPBUY_STATUS = {
  open: 'open',
  full: 'full',
  closed: 'closed',
  cancelled: 'cancelled',
} as const;

/** 分类白名单 —— 必须与小程序 `GROUP_BUY_CATEGORIES` 一致（否则筛选点下去永远是空） */
export const GROUPBUY_CATEGORIES = ['food', 'drink', 'supplies', 'ticket', 'other'] as const;
export type GroupbuyCategory = (typeof GROUPBUY_CATEGORIES)[number];

export const GROUPBUY_SORTS = ['latest', 'deadline'] as const;
export type GroupbuySort = (typeof GROUPBUY_SORTS)[number];

/** 「我的拼单」的角色划分：我发起的 / 我参与的 */
export const GROUPBUY_MINE_ROLES = ['owner', 'member'] as const;
export type GroupbuyMineRole = (typeof GROUPBUY_MINE_ROLES)[number];

/** 单价上限（分）：1 万元。拼单是校园小额场景，超过必是误填 */
export const GROUPBUY_MAX_UNIT_PRICE_FEN = 1_000_000;
/** 成团人数上限 */
export const GROUPBUY_MAX_TARGET_COUNT = 99;

export interface CreateGroupbuyOrderInput {
  title: string;
  description?: string | null;
  category: string;
  targetCount: number;
  unitPriceFen: number;
  deadline: Date;
  pickupSpot?: string | null;
}

export interface UpdateGroupbuyOrderInput {
  title?: string;
  description?: string | null;
  category?: string;
  targetCount?: number;
  unitPriceFen?: number;
  deadline?: Date;
  pickupSpot?: string | null;
}

export interface GroupbuyOrderListQuery {
  cursor?: string;
  limit: number;
  sort: GroupbuySort;
  category?: string;
  keyword?: string;
  /** 只看"我"相关的：`owner` = 我发起的；`member` = 我参与的（不含我发起的） */
  mine?: { userId: string; role: GroupbuyMineRole };
}

export interface GroupbuyMemberRef {
  userId: string;
  role: string;
}

export interface GroupbuyOrderRepository {
  list(query: GroupbuyOrderListQuery): Promise<Page<GroupbuyOrderView>>;
  create(input: CreateGroupbuyOrderInput & { ownerId: string }): Promise<GroupbuyOrderModel>;
  findById(id: string): Promise<GroupbuyOrderView | null>;
  update(id: string, input: UpdateGroupbuyOrderInput): Promise<GroupbuyOrderModel>;
  /**
   * 单独改状态。
   *
   * 刻意与 `update` 分开：`UpdateGroupbuyOrderInput` 里**没有** status 字段，
   * 这样"改标题"之类的普通更新不可能顺手把状态改掉（状态跃迁只能走
   * `join` / `cancel` 两个明确的领域动作）。
   */
  setStatus(id: string, status: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** 参团：幂等 upsert 到关联表，返回该成员的最新记录 */
  join(orderId: string, userId: string, quantity: number): Promise<{ memberId: string; quantity: number }>;
  /** 参团人（含发起人，发起人在种子/创建时也会有一条 role=owner 的记录） */
  listMembers(orderId: string): Promise<GroupbuyMemberRef[]>;
}

export const GROUPBUY_ORDER_REPOSITORY = Symbol('KEDAYA_GROUPBUY_ORDER_REPOSITORY');
