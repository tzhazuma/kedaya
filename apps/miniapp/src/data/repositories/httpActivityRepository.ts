import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import {
  normalizeActivityItem,
  normalizeActivityItems,
  normalizeActivityReminder,
  normalizeActivityRemindersWithActivity,
  type ActivityItem,
  type ActivityReminderItem,
  type ActivityReminderWithActivity,
  type ManualActivityDraft,
} from '../../domain/models/activity'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LogPort } from '../../domain/ports/logPort'
import {
  normalizeWechatHistoryPage,
  type WechatHistoryPage,
} from '../../domain/models/wechatHistory'
import type {
  ActivityPage,
  ActivityPatch,
  ActivityRepository,
  CreateActivityReminderInput,
  DispatchRemindersResult,
  ListActivitiesQuery,
} from '../../domain/ports/activityRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端活动仓储。
 *
 * ```
 * GET    /activities/items
 * POST   /activities/items
 * GET    /activities/items/:id
 * PATCH  /activities/items/:id
 * POST   /activities/items/:id/confirm
 * POST   /activities/items/:id/dismiss
 * POST   /activities/imports/wechat
 * POST   /activities/imports/mail
 * GET    /activities/reminders
 * POST   /activities/items/:id/reminders
 * DELETE /activities/reminders/:id
 * POST   /activities/reminders/dispatch
 * ```
 *
 * 信封解包、Bearer、trace、401 重试全部由 `ApiClient` 负责；这里只做
 * 「URL + 形状归一化」。坏形状**整条拒绝**并记一次 contract violation，
 * 而不是把半条活动渲染给用户。
 */

export interface ActivityRepositoryOptions {
  log?: LogPort
}

function reportViolation(
  log: LogPort | undefined,
  where: string,
  droppedCount: number,
  reason: string,
): void {
  log?.warn('activities.contract.violation', { where, droppedCount, reason })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pageItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (isRecord(raw) && Array.isArray(raw.items)) return raw.items
  return []
}

function nextCursorOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return typeof raw.nextCursor === 'string' ? raw.nextCursor : null
}

function totalOf(raw: unknown): number | undefined {
  if (!isRecord(raw)) return undefined
  return typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : undefined
}

export function createHttpActivityRepository(
  client: ApiClient,
  options: ActivityRepositoryOptions = {},
): ActivityRepository {
  const { log } = options
  const itemsPath = modulePath('activities', 'items')

  function invalid(message: string): Result<never, RepositoryError> {
    return err({ code: 'INTERNAL', message })
  }

  return {
    async list(query: ListActivitiesQuery = {}): Promise<Result<ActivityPage, RepositoryError>> {
      const result = await client.get<unknown>(itemsPath, {
        ...(query.cursor == null ? {} : { cursor: query.cursor }),
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
      })
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = pageItems(result.value)
      const items = normalizeActivityItems(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'activities.items', raw.length - items.length, 'SHAPE_OR_ENUM')
      }
      return ok({
        items,
        nextCursor: nextCursorOf(result.value),
        ...(totalOf(result.value) === undefined ? {} : { total: totalOf(result.value) }),
      })
    },

    async detail(id: string): Promise<Result<ActivityItem, RepositoryError>> {
      const result = await client.get<unknown>(`${itemsPath}/${encodeURIComponent(id)}`)
      if (!result.ok) return err(toRepositoryError(result.error))
      const normalized = normalizeActivityItem(result.value)
      if (normalized === null) {
        reportViolation(log, 'activities.item', 1, 'SHAPE_OR_ENUM')
        return invalid('活动数据形状不合法，已拒绝使用')
      }
      return ok(normalized)
    },

    async create(
      input: ManualActivityDraft,
      idempotencyKey?: string,
    ): Promise<Result<ActivityItem, RepositoryError>> {
      const result = await client.post<unknown, Record<string, unknown>>(
        itemsPath,
        { ...input },
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      const normalized = normalizeActivityItem(result.value)
      if (normalized === null) {
        reportViolation(log, 'activities.items.create', 1, 'SHAPE_OR_ENUM')
        return invalid('新增结果形状不合法，已拒绝使用')
      }
      return ok(normalized)
    },

    async update(
      id: string,
      patch: ActivityPatch,
    ): Promise<Result<ActivityItem, RepositoryError>> {
      const result = await client.patch<unknown, ActivityPatch>(
        `${itemsPath}/${encodeURIComponent(id)}`,
        patch,
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      const normalized = normalizeActivityItem(result.value)
      if (normalized === null) {
        reportViolation(log, 'activities.items.update', 1, 'SHAPE_OR_ENUM')
        return invalid('更新结果形状不合法，已拒绝使用')
      }
      return ok(normalized)
    },

    async confirm(
      id: string,
      idempotencyKey?: string,
    ): Promise<Result<ActivityItem, RepositoryError>> {
      return action(`${itemsPath}/${encodeURIComponent(id)}/confirm`, 'activities.items.confirm', idempotencyKey)
    },

    async dismiss(
      id: string,
      idempotencyKey?: string,
    ): Promise<Result<ActivityItem, RepositoryError>> {
      return action(`${itemsPath}/${encodeURIComponent(id)}/dismiss`, 'activities.items.dismiss', idempotencyKey)
    },

    async importWechat(
      input: { link?: string; text?: string },
      idempotencyKey?: string,
    ): Promise<Result<ActivityItem, RepositoryError>> {
      const body: { url?: string; text?: string } = {
        ...(input.link === undefined ? {} : { url: input.link }),
        ...(input.text === undefined ? {} : { text: input.text }),
      }
      const result = await client.post<unknown, typeof body>(
        modulePath('activities', 'imports', 'wechat'),
        body,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      const raw = isRecord(result.value) && 'item' in result.value ? result.value.item : result.value
      const normalized = normalizeActivityItem(raw)
      if (normalized === null) {
        reportViolation(log, 'activities.imports.wechat', 1, 'SHAPE_OR_ENUM')
        return invalid('导入结果形状不合法，已拒绝使用')
      }
      return ok(normalized)
    },

    async importMail(
      eventId: string,
      idempotencyKey?: string,
    ): Promise<Result<ActivityItem[], RepositoryError>> {
      const result = await client.post<unknown, { eventIds: string[] }>(
        modulePath('activities', 'imports', 'mail'),
        { eventIds: [eventId] },
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      // 服务端可能从同一封邮件归一出多条候选；只取第一条会让其余候选静默消失。
      const rawItems =
        isRecord(result.value) && Array.isArray(result.value.items)
          ? result.value.items
          : isRecord(result.value) && result.value.item !== undefined
            ? [result.value.item]
            : []
      const normalized = normalizeActivityItems(rawItems)
      if (normalized.length === 0) {
        reportViolation(log, 'activities.imports.mail', 1, 'SHAPE_OR_ENUM')
        return invalid('导入结果形状不合法，已拒绝使用')
      }
      if (normalized.length < rawItems.length) {
        reportViolation(
          log,
          'activities.imports.mail',
          rawItems.length - normalized.length,
          'SHAPE_OR_ENUM',
        )
      }
      return ok(normalized)
    },

    async parseWechatHistory(
      savedPageHtml: string,
    ): Promise<Result<WechatHistoryPage, RepositoryError>> {
      const html = savedPageHtml.trim()
      if (html === '') return invalid('先把公众号「查看历史消息」页的内容粘贴进来')

      const result = await client.post<unknown, { html: string }>(
        // 这个端点在 `/wechat` 下，不在 `/activities` 下：它只做解析，与活动存储无关。
        modulePath('wechat', 'profile-list'),
        { html },
      )
      if (!result.ok) return err(toRepositoryError(result.error))

      // 服务端用 200 + `ok:false` 表达「这页不是历史页」。
      if (isRecord(result.value) && result.value.ok === false) {
        const message = typeof result.value.message === 'string' ? result.value.message : ''
        return invalid(message === '' ? '这段内容里没有历史文章列表' : message)
      }

      const { page, dropped } = normalizeWechatHistoryPage(result.value)
      if (page === null) {
        reportViolation(log, 'wechat.profile-list', 1, 'SHAPE_OR_ENUM')
        return invalid('解析结果形状不合法，已拒绝使用')
      }
      if (page.articles.length === 0) {
        return invalid('这一页没有可读文章，请翻到有文章的一页再保存')
      }
      if (dropped > 0) {
        reportViolation(log, 'wechat.profile-list', dropped, 'SHAPE_OR_ENUM')
      }
      return ok(page)
    },

    async listRemindersFor(activityId: string): Promise<Result<ActivityReminderItem[], RepositoryError>> {      // 契约没有「按活动查提醒」端点：拉一次我的提醒再按 activityId 过滤。
      // limit 取契约上限 100 —— 默认 20 会让提醒多的用户看不到本条活动的提醒。
      const result = await client.get<unknown>(modulePath('activities', 'reminders'), {
        limit: 100,
      })
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = pageItems(result.value)
      const items = normalizeActivityRemindersWithActivity(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'activities.reminders', raw.length - items.length, 'SHAPE_OR_ENUM')
      }
      return ok(items.filter((reminder) => reminder.activityId === activityId))
    },

    async listReminders(): Promise<Result<ActivityReminderWithActivity[], RepositoryError>> {
      const result = await client.get<unknown>(modulePath('activities', 'reminders'), {
        limit: 100,
      })
      if (!result.ok) return err(toRepositoryError(result.error))

      const raw = pageItems(result.value)
      const items = normalizeActivityRemindersWithActivity(raw)
      if (items.length < raw.length) {
        reportViolation(log, 'activities.reminders', raw.length - items.length, 'SHAPE_OR_ENUM')
      }
      return ok(items)
    },

    async createReminder(
      activityId: string,
      input: CreateActivityReminderInput,
      idempotencyKey?: string,
    ): Promise<Result<ActivityReminderItem, RepositoryError>> {
      const result = await client.post<unknown, CreateActivityReminderInput>(
        `${itemsPath}/${encodeURIComponent(activityId)}/reminders`,
        input,
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      const normalized = normalizeActivityReminder(result.value)
      if (normalized === null) {
        reportViolation(log, 'activities.items.reminders.create', 1, 'SHAPE_OR_ENUM')
        return invalid('提醒结果形状不合法，已拒绝使用')
      }
      return ok(normalized)
    },

    async deleteReminder(
      id: string,
      idempotencyKey?: string,
    ): Promise<Result<true, RepositoryError>> {
      const result = await client.del<unknown>(
        modulePath('activities', 'reminders', encodeURIComponent(id)),
        idempotencyKey === undefined ? {} : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(true)
    },

    async dispatchReminders(): Promise<Result<DispatchRemindersResult, RepositoryError>> {
      const result = await client.post<unknown, Record<string, never>>(
        modulePath('activities', 'reminders', 'dispatch'),
        {},
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      const value = isRecord(result.value) ? result.value : {}
      const dispatched =
        typeof value.sent === 'number'
          ? value.sent
          : typeof value.claimed === 'number'
            ? value.claimed
            : 0
      return ok({ dispatched })
    },
  }

  async function action(
    path: string,
    where: string,
    idempotencyKey: string | undefined,
  ): Promise<Result<ActivityItem, RepositoryError>> {
    const result = await client.post<unknown, undefined>(
      path,
      undefined,
      idempotencyKey === undefined ? {} : { idempotencyKey },
    )
    if (!result.ok) return err(toRepositoryError(result.error))
    const normalized = normalizeActivityItem(result.value)
    if (normalized === null) {
      reportViolation(log, where, 1, 'SHAPE_OR_ENUM')
      return invalid('活动状态更新结果形状不合法，已拒绝使用')
    }
    return ok(normalized)
  }
}
