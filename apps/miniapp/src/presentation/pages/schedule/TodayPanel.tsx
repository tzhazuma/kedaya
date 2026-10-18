import { Text, View } from '@tarojs/components'

import {
  buildDayTimeline,
  conflictCourseIds,
  countdownHeadline,
} from '../../../application/schedule/timetable'
import type { ScheduleTodayView, ScheduleWeekView } from '../../../domain/models/schedule'
import { KdyCard, KdyEmpty, KdyTag } from '../../components'
import { ConflictCard, CourseRow, GapRow } from './parts'
import { useLiveMinutes } from './useLiveMinutes'

/**
 * 「今天」面板 —— 站着看手机的那 3 秒要回答的问题：
 *   现在在上什么？下一节还有多久、在哪？今天还剩几节？
 *
 * 所以第一块不是课程列表，而是一句**状态 + 下一节的事实**（课名 / 地点 / 时间）；
 * 第二块才是按节次排开的时间轴，课与课之间插空档提示（"空 2 小时，去图书馆"）。
 * 冲突单独一张卡：它不该只藏在某个方块的描边颜色里。
 */

export interface TodayPanelProps {
  today: ScheduleTodayView | null
  week: ScheduleWeekView | null
  needsBinding: boolean
  fromCache: boolean
  syncing: boolean
  onSync: () => void
  onBind: () => void
  onRetry: () => void
  onOpenWeek: () => void
}

export function TodayPanel({
  today,
  week,
  needsBinding,
  fromCache,
  syncing,
  onSync,
  onBind,
  onRetry,
  onOpenWeek,
}: TodayPanelProps) {
  /** 注意：hooks 必须在任何 early return 之前调用，所以这里用 `?? null` 兜住空态 */
  const liveMinutes = useLiveMinutes(today?.minutesUntilNext ?? null)

  if (today === null) {
    return (
      <KdyCard title='今天'>
        <KdyEmpty
          mode={needsBinding ? 'empty' : 'error'}
          title={needsBinding ? '还没有绑定教务系统' : '今天的课表没取到'}
          description={
            needsBinding
              ? '绑定教务系统后才能同步本学期课表。'
              : '下拉刷新或点重试再取一次；已有的缓存课表不会被清空。'
          }
          actionText={needsBinding ? '去绑定教务系统' : '重试'}
          onAction={needsBinding ? onBind : onRetry}
        />
      </KdyCard>
    )
  }

  const ongoing = today.ongoing
  const next = today.next
  const ongoingIds = new Set(ongoing.map((course) => course.id))
  const conflictIds = conflictCourseIds(today.conflicts)
  const timeline = buildDayTimeline(today.courses)

  const status = resolveStatus(today, liveMinutes, needsBinding, week)

  return (
    <>
      <KdyCard elevated className='kdy-schedule__hero-card'>
        <View className='kdy-schedule__hero'>
          <View className='kdy-schedule__hero-top'>
            <Text className='kdy-schedule__eyebrow'>
              {today.weekdayLabel} · {today.termLabel}
            </Text>
            <KdyTag tone={syncing ? 'warning' : fromCache ? 'neutral' : 'brand'}>
              {syncing ? '同步中' : fromCache ? '缓存数据' : '已同步'}
            </KdyTag>
          </View>

          <Text className='kdy-schedule__headline'>{status.headline}</Text>
          <Text className='kdy-schedule__detail'>{status.detail}</Text>

          {status.hint !== null && (
            <Text className='kdy-schedule__hero-hint'>{status.hint}</Text>
          )}
        </View>
      </KdyCard>

      <KdyCard
        title='今天的时间轴'
        extra={today.courses.length > 0 ? <KdyTag tone='neutral'>{today.courses.length} 节</KdyTag> : undefined}
      >
        {today.courses.length === 0 ? (
          <KdyEmpty
            mode='empty'
            title={needsBinding ? '还没有绑定教务系统' : '今天没有排课'}
            description={
              needsBinding
                ? '绑定后可以自动同步本学期课表，之后这里就会显示今天的课。'
                : week !== null && week.totalCount > 0
                  ? `本周还有 ${week.totalCount} 节课，切到「本周」看看排在哪天。`
                  : '如果这不对，可能还没同步过课表。'
            }
            actionText={
              needsBinding ? '去绑定教务系统' : week !== null && week.totalCount > 0 ? '查看本周' : '同步课表'
            }
            onAction={
              needsBinding ? onBind : week !== null && week.totalCount > 0 ? onOpenWeek : onSync
            }
          />
        ) : (
          <View className='kdy-schedule__timeline'>
            {timeline.map((item) => {
              if (item.kind === 'gap') {
                return <GapRow key={`gap-${item.startMinutes}-${item.endMinutes}`} item={item} />
              }

              const { course } = item
              return (
                <CourseRow
                  key={course.id}
                  course={course}
                  conflict={conflictIds.has(course.id)}
                  status={ongoingIds.has(course.id) ? 'ongoing' : next?.id === course.id ? 'next' : null}
                />
              )
            })}
          </View>
        )}
      </KdyCard>

      <ConflictCard conflicts={today.conflicts} title='今天的时间冲突' />
    </>
  )
}

interface TodayStatus {
  headline: string
  detail: string
  hint: string | null
}

/**
 * 把四种情况写成四句不同的话。
 *
 * 不写"暂无数据"：这句话对用户没有任何下一步动作；而"下一节还有 20 分钟"
 * 与"今天的课上完了"对用户的行为影响完全不同。
 */
function resolveStatus(
  today: ScheduleTodayView,
  liveMinutes: number | null,
  needsBinding: boolean,
  week: ScheduleWeekView | null,
): TodayStatus {
  const ongoing = today.ongoing
  const next = today.next

  if (ongoing.length > 0) {
    const first = ongoing[0]
    const names = ongoing.map((course) => course.courseName).join(' / ')
    const place = first !== undefined && first.location !== null ? ` · ${first.location}` : ''
    const range = first !== undefined ? first.timeLabel : ''
    return {
      headline: '正在上课',
      detail: `${names}${place} · ${range}`,
      hint: ongoing.length > 1 ? '同一时段有多门课，以实际到场的为准。' : null,
    }
  }

  if (next !== null) {
    const place = next.location === null ? '地点未登记' : next.location
    const countdown = liveMinutes === null ? '' : countdownHeadline(liveMinutes)
    return {
      headline: countdown === '' ? '接下来还有课' : countdown,
      detail: `${next.courseName} · ${place} · ${next.timeLabel}`,
      hint: null,
    }
  }

  if (today.finishedForToday) {
    return {
      headline: '今天的课上完了',
      detail: `今天 ${today.courses.length} 节课已经结束，剩下的时间归你。`,
      hint: week !== null && week.totalCount > 0 ? `本周共 ${week.totalCount} 节课。` : null,
    }
  }

  return {
    headline: '今天没有排课',
    detail: needsBinding
      ? '还没有绑定教务系统，绑定后可以自动同步本学期课表。'
      : week !== null && week.totalCount > 0
        ? `本周还有 ${week.totalCount} 节课，切到「本周」看看排在哪天。`
        : '同步一次教务系统，或手动添加临时调课的安排。',
    hint: null,
  }
}
