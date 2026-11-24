import type { Result } from '@kedaya/shared'

import type {
  ActivityItem,
  ActivityReminderChannel,
  ActivityReminderItem,
  ActivityReminderKind,
  ActivityReminderWithActivity,
  ActivitySource,
  ActivityStatus,
  ManualActivityDraft,
} from '../models/activity'
import type { WechatHistoryPage } from '../models/wechatHistory'
import type { RepositoryError } from './errors'

/**
 * 活动仓储端口（`/activities`）。
 *
 * 路径映射（与共同契约一致）：
 * ```
 * GET    /activities/items                     列表（游标分页）
 * POST   /activities/items                     手动新增
 * GET    /activities/items/:id                 详情
 * PATCH  /activities/items/:id                 编辑
 * POST   /activities/items/:id/confirm         确认加入日程
 * POST   /activities/items/:id/dismiss         忽略
 * POST   /activities/imports/wechat            公众号单篇导入
 * POST   /activities/imports/mail              邮件事件提升
 * GET    /activities/reminders                 我的提醒
 * POST   /activities/items/:id/reminders       建提醒
 * DELETE /activities/reminders/:id             删提醒
 * POST   /activities/reminders/dispatch        （管理员）派发站内信
 * ```
 *
 * ⚠️ 邮件正文 / 附件 / 公众号全文**没有**字段：端口只能传链接、正文或事件 id，
 * 服务端归一后只回活动字段与 ≤200 字证据片段。
 */

export interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
  total?: number
}

export interface ListActivitiesQuery {
  cursor?: string | null
  limit?: number
  /** 服务端筛选：`GET /activities/items` 的 status / source / from / to */
  status?: ActivityStatus
  source?: ActivitySource
  from?: string
  to?: string
}

export interface ActivityPatch {
  title?: string
  kind?: ActivityItem['kind']
  startsAt?: string | null
  endsAt?: string | null
  location?: string | null
  organizer?: string | null
  registrationDeadlineAt?: string | null
  registrationDeadlineRaw?: string | null
  registrationUrl?: string | null
  evidenceText?: string
}

export interface CreateActivityReminderInput {
  kind: ActivityReminderKind
  remindAt: string
  channel: ActivityReminderChannel
}

export interface DispatchRemindersResult {
  dispatched: number
}

export interface ActivityRepository {
  list(query?: ListActivitiesQuery): Promise<Result<ActivityPage, RepositoryError>>
  detail(id: string): Promise<Result<ActivityItem, RepositoryError>>
  create(
    input: ManualActivityDraft,
    idempotencyKey?: string,
  ): Promise<Result<ActivityItem, RepositoryError>>
  update(id: string, patch: ActivityPatch): Promise<Result<ActivityItem, RepositoryError>>
  confirm(id: string, idempotencyKey?: string): Promise<Result<ActivityItem, RepositoryError>>
  dismiss(id: string, idempotencyKey?: string): Promise<Result<ActivityItem, RepositoryError>>
  importWechat(
    input: { link?: string; text?: string },
    idempotencyKey?: string,
  ): Promise<Result<ActivityItem, RepositoryError>>
  /**
   * 解析**用户自己保存**的公众号历史消息页（`POST /wechat/profile-list`）。
   *
   * 入参是页面 HTML 原文，不是 URL —— 服务端不会替客户端去抓任何东西。
   * 返回候选列表，用户勾选后再逐篇走 `importWechat`。
   */
  parseWechatHistory(
    savedPageHtml: string,
  ): Promise<Result<WechatHistoryPage, RepositoryError>>
  /** `POST /activities/items/:id/archive` —— 归档（从待确认/日程里收起，不删除） */
  archive(id: string, idempotencyKey?: string): Promise<Result<ActivityItem, RepositoryError>>
  /** `POST /activities/items/:id/restore` —— 从归档恢复到候选 */
  restore(id: string, idempotencyKey?: string): Promise<Result<ActivityItem, RepositoryError>>
  /** 提升一封邮件事件；服务端可能归一出多条候选，因此返回数组 */
  importMail(eventId: string, idempotencyKey?: string): Promise<Result<ActivityItem[], RepositoryError>>
  listRemindersFor(activityId: string): Promise<Result<ActivityReminderItem[], RepositoryError>>
  listReminders(): Promise<Result<ActivityReminderWithActivity[], RepositoryError>>
  createReminder(
    activityId: string,
    input: CreateActivityReminderInput,
    idempotencyKey?: string,
  ): Promise<Result<ActivityReminderItem, RepositoryError>>
  deleteReminder(id: string, idempotencyKey?: string): Promise<Result<true, RepositoryError>>
  dispatchReminders(): Promise<Result<DispatchRemindersResult, RepositoryError>>
}
