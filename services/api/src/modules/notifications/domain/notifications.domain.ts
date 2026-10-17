/**
 * 通知 · notifications（契约 §4）
 *
 * 这个模块与其它 14 个业务模块不同：它是**被其它模块写入、被用户读取**的。
 *   写：通过 `common/notifications/notification.port.ts` 的 `NotificationPort`
 *       （拼单成团、跑腿被接单、闲置被预定、帖子被回复都会写一条）；
 *   读：用户在「消息」页看自己的通知，未读数用于 tabBar 红点。
 *
 * 因此它**不是**通用 CRUD：
 *   · 没有"创建通知"的公开 HTTP 端点 —— 那等于让任何人给任何人发通知；
 *   · 列表恒按 `userId` 收窄到当前登录用户，不存在"列出别人通知"的用法。
 */

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface NotificationModel {
  id: string;
  userId: string;
  title: string;
  body: string;
  channel: string;
  source: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** 写通知的输入（内部调用，不来自 HTTP） */
export interface CreateNotificationInput {
  userId: string;
  title: string;
  body: string;
  channel?: string;
  source?: string;
  link?: string | null;
}

export interface NotificationListQuery {
  userId: string;
  cursor?: string;
  limit: number;
  /** 只看未读（「消息」页的未读筛选） */
  unreadOnly: boolean;
}

/**
 * 端口：service 只依赖本类型，实现见 `data/notifications.repository.ts`。
 *
 * 刻意**不继承** `ResourceRepository`：那个接口的 `list(params)` 没有按人收窄的能力，
 * 而"通知必须按收件人隔离"是这个模块唯一不能妥协的约束。
 */
export interface NotificationRepository {
  list(query: NotificationListQuery): Promise<{ items: NotificationModel[]; nextCursor: string | null }>;
  unreadCount(userId: string): Promise<number>;
  /** 标记已读。**必须**带 userId 条件，否则可以用别人的通知 id 越权改状态。 */
  markRead(id: string, userId: string): Promise<NotificationModel | null>;
  markAllRead(userId: string): Promise<number>;
  create(input: CreateNotificationInput): Promise<NotificationModel>;
  /** 批量写入（成团通知要发给全部成员） */
  createMany(inputs: readonly CreateNotificationInput[]): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('KEDAYA_NOTIFICATION_REPOSITORY');

/** 通知渠道（与 Prisma 注释一致） */
export const NOTIFICATION_CHANNELS = ['inapp', 'wechat-subscribe', 'push'] as const;

/**
 * 通知来源白名单。新增来源时必须登记在这里 ——
 * 拼错一个 source 不会报错，只会让前端选不到图标（静默降级），
 * 所以用白名单 + 单元测试兜住。
 */
export const NOTIFICATION_SOURCES = [
  'system',
  'groupbuy',
  'errand',
  'flea-market',
  'forum',
  'campus-card',
  'schedule',
] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

/** 正文长度上限：列表页是单行省略展示，过长没有意义还会撑爆气泡 */
export const NOTIFICATION_TITLE_MAX = 40;
export const NOTIFICATION_BODY_MAX = 120;
