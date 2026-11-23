import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { buildActivityIcs, type ActivityItem } from '../domain/models/activity'
import { copyText } from './clipboard'
import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 「加入手机日历」——用户主动点击后才调用。
 *
 * - 微信小程序：`wx.addPhoneCalendar` 把活动写进系统日历；
 * - 其他端 / 调用失败：复制 ICS 文本，让用户在日历 App 里导入。
 *
 * ⚠️ 这**不是**微信订阅消息，也不会产生任何微信推送。页面文案必须如实说明。
 */

export interface CalendarAddOutcome {
  mode: 'added' | 'copied'
  message: string
}

type CalendarActivity = Pick<
  ActivityItem,
  | 'id'
  | 'title'
  | 'startsAt'
  | 'endsAt'
  | 'location'
  | 'organizer'
  | 'registrationUrl'
  | 'evidenceText'
>

function toUnixSeconds(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

export async function addActivityToPhoneCalendar(
  item: CalendarActivity,
): Promise<PlatformResult<CalendarAddOutcome>> {
  if (item.startsAt === null) {
    return err({ code: 'UNSUPPORTED', message: '这个活动没有确定的开始时间，无法加入日历' })
  }
  const startTime = toUnixSeconds(item.startsAt)
  if (startTime === null) {
    return err({ code: 'UNSUPPORTED', message: '这个活动的开始时间格式不正确，无法加入日历' })
  }

  if (isWeapp()) {
    const endTime = item.endsAt === null ? null : toUnixSeconds(item.endsAt)
    try {
      await Taro.addPhoneCalendar({
        title: item.title,
        startTime,
        ...(endTime === null ? {} : { endTime: String(endTime) }),
        ...(item.location === null ? {} : { location: item.location }),
        description: [item.organizer, item.evidenceText]
          .filter((value): value is string => value !== null)
          .join(' '),
        alarm: true,
        alarmOffset: 3600,
      })
      return ok({ mode: 'added', message: '已加入手机日历。' })
    } catch {
      // 用户拒绝 / 旧基础库不支持：继续走 ICS 复制，不把用户卡在错误里。
    }
  }

  const ics = buildActivityIcs(item, new Date())
  if (ics === null) {
    return err({ code: 'UNSUPPORTED', message: '这个活动没有可用的日历时间' })
  }

  const copied = await copyText(ics)
  if (!copied.ok) {
    return err({ code: 'FAILED', message: copied.error.message })
  }

  return ok({
    mode: 'copied',
    message: '当前平台不支持直接写入系统日历，已复制日历内容；请粘贴到日历 App 导入。',
  })
}
