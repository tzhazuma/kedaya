import type { Page } from '@kedaya/contracts';

/**
 * 找搭子 · buddy（契约 §4 模块 id：`buddy`）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**：它已经承载真实的领域规则
 * （归属校验、成员容量、状态机、筛选与搜索）。请直接改本文件，不要重跑 `npm run scaffold`。
 *
 * 安全基线（所有模块统一）：
 *   1. `ownerId` **永远**来自 JWT 解出的主体，不接受请求体传入；
 *   2. 结束招募 / 取消只允许组长；
 *   3. 容量与状态机由服务层强制，非法操作返回 CONFLICT 而不是静默改写。
 *
 * 与跳蚤不同，本模块有**成员关系**（BuddyMember），因此仓储端口不套用通用的
 * `ResourceRepository`，而是自己声明成员相关方法。
 */

/** 活动类型白名单（对外契约的一部分，客户端筛选器直接用它渲染） */
export const BUDDY_ACTIVITIES = [
  'study',
  'sport',
  'meal',
  'travel',
  'game',
  'movie',
  'other',
] as const;
export type BuddyActivity = (typeof BUDDY_ACTIVITIES)[number];

/** 状态机：recruiting → full → closed；cancelled 为终态 */
export const BUDDY_STATUS = {
  recruiting: 'recruiting',
  full: 'full',
  closed: 'closed',
  cancelled: 'cancelled',
} as const;
export type BuddyStatus = (typeof BUDDY_STATUS)[keyof typeof BUDDY_STATUS];

/** 供 Zod `z.enum` 复用的状态白名单 */
export const BUDDY_STATUSES = [
  BUDDY_STATUS.recruiting,
  BUDDY_STATUS.full,
  BUDDY_STATUS.closed,
  BUDDY_STATUS.cancelled,
] as const;

/** 排序方式（默认最新；soon = 即将开始） */
export const BUDDY_SORTS = ['latest', 'soon'] as const;
export type BuddySort = (typeof BUDDY_SORTS)[number];

/** 容量区间：至少「我 + 一个搭子」，最多 50 人 */
export const BUDDY_MIN_CAPACITY = 2;
export const BUDDY_MAX_CAPACITY = 50;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface BuddyGroupModel {
  id: string;
  ownerId: string;
  activity: string;
  title: string;
  description: string | null;
  campusSpot: string;
  startsAt: Date;
  capacity: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 成员关系行（粗粒度，供服务层判断角色） */
export interface BuddyMemberModel {
  id: string;
  groupId: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

/** 成员对外视图：带上展示名与头像，供详情页渲染 */
export interface BuddyMemberView {
  userId: string;
  role: string;
  joinedAt: Date;
  displayName: string;
  avatarUrl: string | null;
}

/** 详情 = 小组 + 成员列表 */
export interface BuddyGroupDetail extends BuddyGroupModel {
  members: BuddyMemberView[];
}

/** 创建输入。`ownerId` 由服务层从登录主体补全，客户端传了也会被忽略。 */
export interface CreateBuddyGroupInput {
  ownerId?: string;
  activity: string;
  title: string;
  description?: string | null;
  campusSpot: string;
  startsAt: Date;
  capacity: number;
}

/** 列表查询条件 */
export interface BuddyGroupListQuery {
  cursor?: string;
  limit: number;
  activity?: string;
  status?: string;
  /** 标题 / 简介模糊搜索 */
  keyword?: string;
  /** 我创建的（`mine=1` 由服务层填成当前用户） */
  ownerId?: string;
  /** 我加入的（`joined=1`，命中 BuddyMember 关系） */
  joinedUserId?: string;
  /** `upcoming=1` 时只看未开始（startsAt >= now） */
  onlyUpcoming?: boolean;
  sort: BuddySort;
}

/** 端口：service 只依赖本类型，实现见 data/buddy.repository.ts */
export interface BuddyGroupRepository {
  list(query: BuddyGroupListQuery): Promise<Page<BuddyGroupModel>>;
  create(input: CreateBuddyGroupInput & { ownerId: string }): Promise<BuddyGroupModel>;
  findById(id: string): Promise<BuddyGroupModel | null>;
  /** 只改状态（招募中 / 满员 / 已关闭 / 已取消） */
  applyState(id: string, status: BuddyStatus): Promise<BuddyGroupModel>;
  /** 详情页的成员列表（含展示名与头像） */
  listMembers(groupId: string): Promise<BuddyMemberView[]>;
  findMembership(groupId: string, userId: string): Promise<BuddyMemberModel | null>;
  /** 加入成员；已存在时返回 null（唯一约束冲突由数据层翻成 null） */
  addMember(groupId: string, userId: string, role: string): Promise<BuddyMemberModel | null>;
  removeMember(groupId: string, userId: string): Promise<void>;
  countMembers(groupId: string): Promise<number>;
}

export const BUDDY_GROUP_REPOSITORY = Symbol('KEDAYA_BUDDY_GROUP_REPOSITORY');
