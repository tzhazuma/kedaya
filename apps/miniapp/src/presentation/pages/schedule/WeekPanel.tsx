import { Text, View } from '@tarojs/components'

import {
  compareCourses,
  conflictCourseIds,
  shortTermLabel,
} from '../../../application/schedule/timetable'
import type { ScheduleCourseView, ScheduleWeekView } from '../../../domain/models/schedule'
import { KdyCard, KdyChip, KdyEmpty, KdyTag, KdyTimetable } from '../../components'
import { ConflictCard, CourseRow } from './parts'

/**
 * 「本周」面板 —— 一张 7 天 × 12 节的格子，外加"选中那天"的可读清单。
 *
 * 格子负责**形状**（哪天空、哪天满、有没有撞课），清单负责**细节**（课名、地点、教师）。
 * 只有格子，窄屏上读不全课名；只有清单，就退化成原来的"按天翻列表"，
 * 用户看不出这一周的整体节奏。两个一起才是课表。
 */

export interface WeekPanelProps {
  week: ScheduleWeekView | null
  selectedWeekday: number
  focusCourseId: string | null
  needsBinding: boolean
  onSelectDay: (weekday: number) => void
  onSelectCourse: (course: ScheduleCourseView) => void
  onSwitchTerm: (term: string) => void
  onSync: () => void
  onBind: () => void
  onRetry: () => void
}

export function WeekPanel({
  week,
  selectedWeekday,
  focusCourseId,
  needsBinding,
  onSelectDay,
  onSelectCourse,
  onSwitchTerm,
  onSync,
  onBind,
  onRetry,
}: WeekPanelProps) {
  if (week === null) {
    return (
      <KdyCard title='本周'>
        <KdyEmpty
          mode={needsBinding ? 'empty' : 'error'}
          title={needsBinding ? '还没有绑定教务系统' : '本周课表没取到'}
          description={
            needsBinding
              ? '绑定教务系统后才能同步本学期课表。'
              : '重试一次；下拉刷新也会重新取。'
          }
          actionText={needsBinding ? '去绑定教务系统' : '重试'}
          onAction={needsBinding ? onBind : onRetry}
        />
      </KdyCard>
    )
  }

  const conflictIds = conflictCourseIds(week.conflicts)
  const selectedDay = week.days.find((day) => day.weekday === selectedWeekday) ?? null
  const dayCourses = (selectedDay?.courses ?? []).slice().sort(compareCourses)
  const dayLabel =
    selectedDay === null
      ? ''
      : selectedDay.isToday
        ? '今天'
        : selectedDay.relativeLabel !== ''
          ? selectedDay.relativeLabel
          : selectedDay.label

  return (
    <>
      <KdyCard
        title='本周'
        extra={<KdyTag tone='neutral'>共 {week.totalCount} 节</KdyTag>}
      >
        {week.terms.length > 1 && (
          <>
            <Text className='kdy-schedule__form-label'>学期</Text>
            <View className='kdy-schedule__chips'>
              {week.terms.map((term) => (
                <KdyChip
                  key={term}
                  active={term === week.term}
                  onClick={() => onSwitchTerm(term)}
                >
                  {shortTermLabel(term)}
                </KdyChip>
              ))}
            </View>
          </>
        )}

        {week.totalCount === 0 ? (
          <KdyEmpty
            mode='empty'
            title={needsBinding ? '还没有绑定教务系统' : '这学期还没有课表'}
            description={
              needsBinding
                ? '绑定后可以从教务系统同步本学期课表。'
                : '从教务系统同步一次，或用手动加课补上临时调课。'
            }
            actionText={needsBinding ? '去绑定教务系统' : '同步课表'}
            onAction={needsBinding ? onBind : onSync}
          />
        ) : (
          <>
            <KdyTimetable
              days={week.days}
              selectedWeekday={selectedWeekday}
              conflictIds={conflictIds}
              onSelectDay={onSelectDay}
              onSelectCourse={onSelectCourse}
            />

            <Text className='kdy-schedule__muted'>
              横向滑动看完整一周；点某天看当天课程。
              {week.conflicts.length > 0 ? ' 红边方块表示时间冲突。' : ''}
            </Text>

            <View className='kdy-schedule__day-head'>
              <Text className='kdy-schedule__day-title'>{dayLabel}</Text>
              <Text className='kdy-schedule__day-count'>{dayCourses.length} 节课</Text>
            </View>

            {dayCourses.length === 0 ? (
              <Text className='kdy-schedule__muted'>这天没有课，可以安排点自己的事。</Text>
            ) : (
              <View className='kdy-schedule__courses'>
                {dayCourses.map((course) => (
                  <CourseRow
                    key={course.id}
                    course={course}
                    conflict={conflictIds.has(course.id)}
                    highlighted={focusCourseId === course.id}
                    onClick={() => onSelectCourse(course)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </KdyCard>

      <ConflictCard conflicts={week.conflicts} title='本周的时间冲突' />
    </>
  )
}
