import type { Result } from '@kedaya/shared'

import type { ConfirmActivityResult } from '../../../../application/activities/activityUseCases'
import type { ActivityReminderItem } from '../../../../domain/models/activity'
import type { RepositoryError } from '../../../../domain/ports/errors'

/**
 * 详情页的提醒面板状态。
 *
 * 「读取失败」与「没有提醒」必须分开：前者要显示错误 + 重试，后者才是空态。
 * 把失败静默成空列表，用户会以为服务端没建默认提醒，然后手动再建一条。
 */
export interface ReminderPanelState {
  status: 'loading' | 'ready' | 'error'
  items: ActivityReminderItem[]
  error: string | null
}

export function reminderPanelStart(): ReminderPanelState {
  return { status: 'loading', items: [], error: null }
}

export function reminderLoadSuccess(items: ActivityReminderItem[]): ReminderPanelState {
  return { status: 'ready', items, error: null }
}

export function reminderLoadFailure(message: string): ReminderPanelState {
  return {
    status: 'error',
    items: [],
    error: message.trim() === '' ? '提醒读取失败，请稍后重试' : message,
  }
}

export function reminderLoadFromResult(
  result: Result<ActivityReminderItem[], RepositoryError>,
): ReminderPanelState {
  return result.ok ? reminderLoadSuccess(result.value) : reminderLoadFailure(result.error.message)
}

export interface ConfirmOutcome {
  tone: 'success' | 'error'
  message: string
  confirmed: boolean
}

/**
 * 确认结果文案。
 *
 * ⚠️ 只有服务端真的返回 `confirmed` 才能说「已加入日程」：
 * 并发下活动可能已被忽略 / 归档，此时请求 200 但状态没变。
 */
export function confirmOutcome(result: ConfirmActivityResult): ConfirmOutcome {
  if (result.item.status !== 'confirmed') {
    return {
      tone: 'error',
      message: '服务端没有确认这条活动（可能已被忽略或状态已变化），请刷新后重试。',
      confirmed: false,
    }
  }

  if (result.reminderWarning !== null) {
    return {
      tone: 'error',
      message: `已加入日程；${result.reminderWarning}`,
      confirmed: true,
    }
  }

  return {
    tone: 'success',
    message:
      result.reminders.length > 0
        ? '已加入日程，默认提醒已安排。'
        : '已加入日程。',
    confirmed: true,
  }
}
