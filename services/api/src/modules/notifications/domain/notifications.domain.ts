/**
 * 通知 · notifications（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface NotificationModel {
  id: string;
  userId: string;
  title: string;
  body: string;
  channel: string;
  readAt: Date | null;
  createdAt: Date;
}

/** 创建输入。 * 归属字段 `userId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateNotificationInput {
  userId?: string;
  title: string;
  body: string;
  channel?: string;
  readAt?: Date | null;
}

/** 更新输入（全部可选） */
export interface UpdateNotificationInput {
  userId?: string;
  title?: string;
  body?: string;
  channel?: string;
  readAt?: Date | null;
}

/** 端口：service 只依赖本类型，实现见 data/notifications.repository.ts */
export type NotificationRepository = ResourceRepository<
  NotificationModel,
  CreateNotificationInput,
  UpdateNotificationInput
>;

export const NOTIFICATION_REPOSITORY = Symbol('KEDAYA_NOTIFICATION_REPOSITORY');
