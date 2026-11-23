import type { Result } from '@kedaya/shared'

import type { ActivityItem } from '../../../../domain/models/activity'
import type { MailEventItem, MailEventsSnapshot } from '../../../../domain/models/mailActivity'
import type { RepositoryError } from '../../../../domain/ports/errors'

/**
 * 邮箱页的进入恢复 / 提升结果。
 *
 * `GET /mail/events` 对未绑定账号返回空列表（不是错误），因此「已连接」只能
 * 由「有事件」或「上次同步失败（stale）」推断；失败时如实显示错误，不假装已连接。
 */

export type MailRestoreOutcome =
  | {
      ok: true
      connected: boolean
      events: MailEventItem[]
      stale: boolean
      error: null
    }
  | {
      ok: false
      connected: false
      events: MailEventItem[]
      stale: false
      error: string
    }

export function buildMailRestore(
  result: Result<MailEventsSnapshot, RepositoryError>,
): MailRestoreOutcome {
  if (!result.ok) {
    return {
      ok: false,
      connected: false,
      events: [],
      stale: false,
      error: result.error.message,
    }
  }

  return {
    ok: true,
    connected: result.value.items.length > 0 || result.value.stale,
    events: result.value.items,
    stale: result.value.stale,
    error: null,
  }
}

export type PromoteOutcome =
  | {
      ok: true
      items: ActivityItem[]
      notice: string
    }
  | {
      ok: false
      error: string
    }

export function buildPromoteOutcome(
  result: Result<ActivityItem[], RepositoryError>,
): PromoteOutcome {
  if (!result.ok) return { ok: false, error: result.error.message }

  return {
    ok: true,
    items: result.value,
    notice:
      result.value.length > 1
        ? `已提升 ${result.value.length} 条候选活动。逐条确认后才加入日程。`
        : '已提升为候选活动。确认后才加入日程。',
  }
}
