import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_KIND_LABELS,
  formatActivityInstant,
  type ActivityReminderWithActivity,
} from '../../../../domain/models/activity'

/**
 * 提醒页视图。
 *
 * **站内信是唯一已接通的渠道**：微信订阅消息没有真实模板 ID，
 * 页面如实标「未接通」，不把它画成可用的开关。
 */

export interface ReminderRow extends ActivityReminderWithActivity {
  kindLabel: string
  channelLabel: string
  statusLabel: string
  whenLabel: string
}

export interface ReminderView {
  pending: ReminderRow[]
  done: ReminderRow[]
  notice: string
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: '待发送',
  sending: '发送中',
  sent: '已发送',
  failed: '发送失败',
  cancelled: '已取消',
}

function toRow(reminder: ActivityReminderWithActivity, now: Date): ReminderRow {
  return {
    ...reminder,
    kindLabel: REMINDER_KIND_LABELS[reminder.kind],
    channelLabel: REMINDER_CHANNEL_LABELS[reminder.channel],
    statusLabel: STATUS_LABELS[reminder.status] ?? reminder.status,
    whenLabel: formatActivityInstant(reminder.remindAt, now),
  }
}

export function buildReminderView(
  reminders: readonly ActivityReminderWithActivity[],
  now: Date,
): ReminderView {
  const rows = [...reminders]
    .sort((left, right) => Date.parse(left.remindAt) - Date.parse(right.remindAt))
    .map((reminder) => toRow(reminder, now))

  return {
    pending: rows.filter((row) => row.status === 'pending' || row.status === 'sending'),
    done: rows.filter((row) => row.status !== 'pending' && row.status !== 'sending'),
    notice: '当前只支持站内信提醒；微信订阅消息尚未接通，不会偷偷发推送。',
  }
}
