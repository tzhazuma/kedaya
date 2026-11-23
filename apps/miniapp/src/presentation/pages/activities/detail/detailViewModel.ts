import {
  canConfirmActivity,
  canDismissActivity,
  normalizeActivityInstant,
  type ActivityItem,
  type ActivityReminderItem,
} from '../../../../domain/models/activity'

/**
 * 详情页动作闸门。
 *
 * **candidate 只能确认 / 忽略**：没确认就不能进日程、也不能先建提醒。
 * 报名提醒还要求有一个**确定的未来截止时刻** —— 只有原文时不推算，
 * 按钮直接禁用并说明原因。
 */

export interface ActivityDetailActions {
  canConfirm: boolean
  canDismiss: boolean
  canSetReminder: boolean
  canSetRegistrationReminder: boolean
  canSetStartReminder: boolean
  hasReminders: boolean
  hasRegistrationReminder: boolean
  hasStartReminder: boolean
  reminderHint: string | null
  registrationHint: string | null
  startHint: string | null
}

export interface ActivityDetailActionOptions {
  /**
   * 提醒列表是否已成功读取。
   *
   * 读取失败时**不能**显示补设按钮：我们不知道确认时服务端是否已经建过默认提醒，
   * 此时再点一次很可能生成重复提醒。页面应显示错误 + 重试。
   */
  remindersKnown?: boolean
}

export function buildActivityDetailActions(
  item: ActivityItem,
  reminders: readonly ActivityReminderItem[],
  now: Date,
  options: ActivityDetailActionOptions = {},
): ActivityDetailActions {
  const confirmed = item.status === 'confirmed'
  const remindersKnown = options.remindersKnown ?? true
  const hasReminders = reminders.length > 0
  const hasRegistrationReminder = reminders.some(
    (reminder) => reminder.kind === 'registration' && reminder.status !== 'cancelled',
  )
  const hasStartReminder = reminders.some(
    (reminder) => reminder.kind === 'start' && reminder.status !== 'cancelled',
  )

  const deadlineAt = normalizeActivityInstant(item.registrationDeadlineAt)
  const startAt = normalizeActivityInstant(item.startsAt)
  const deadlineMs = deadlineAt === null ? null : Date.parse(deadlineAt)
  const startMs = startAt === null ? null : Date.parse(startAt)

  let registrationHint: string | null = null
  if (!confirmed) {
    registrationHint = '确认加入日程后才能设置提醒'
  } else if (!remindersKnown) {
    registrationHint = '提醒读取失败，请重试后再补设'
  } else if (deadlineMs === null) {
    registrationHint =
      item.registrationDeadlineRaw === null
        ? '这个活动没有报名截止时间'
        : '原文没有确定的报名截止时间，无法设置提醒'
  } else if (deadlineMs <= now.getTime()) {
    registrationHint = '报名截止时间已过'
  } else if (hasRegistrationReminder) {
    registrationHint = '已安排报名提醒'
  }

  let startHint: string | null = null
  if (!confirmed) {
    startHint = '确认加入日程后才能设置提醒'
  } else if (!remindersKnown) {
    startHint = '提醒读取失败，请重试后再补设'
  } else if (startMs === null) {
    startHint = '这个活动没有确定的开始时间，无法设置提醒'
  } else if (startMs <= now.getTime()) {
    startHint = '活动已经开始或结束'
  } else if (hasStartReminder) {
    startHint = '已安排开始前提醒'
  }

  return {
    canConfirm: canConfirmActivity(item),
    canDismiss: canDismissActivity(item),
    canSetReminder: confirmed,
    canSetRegistrationReminder:
      confirmed &&
      remindersKnown &&
      deadlineMs !== null &&
      deadlineMs > now.getTime() &&
      !hasRegistrationReminder,
    canSetStartReminder:
      confirmed &&
      remindersKnown &&
      startMs !== null &&
      startMs > now.getTime() &&
      !hasStartReminder,
    hasReminders,
    hasRegistrationReminder,
    hasStartReminder,
    reminderHint: !confirmed
      ? '确认加入日程后才能设置提醒'
      : hasReminders
        ? '已有提醒，可在「提醒」页查看或删除'
        : null,
    registrationHint,
    startHint,
  }
}
