import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { MAX_SLOT, SLOT_OPTIONS, WEEKDAY_LABELS, conflictLabel, countdownLabel, courseSubtitle } from '../../../domain/models/schedule'
import type { ScheduleCourseView } from '../../../domain/models/schedule'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 课表（`schedule`）—— 「我现在该去哪」。
 *
 * 页面结构按**用户当下最急的问题**排序，而不是按数据表的结构：
 *   1. 今天（正在上什么 / 下一节还有多久 / 今天还剩几节）—— 站着看手机的那 3 秒要用到；
 *   2. 本周（切换星期看某天）—— 计划用；
 *   3. 同步 / 手动加课 —— 数据不对时才用到，所以收在下面。
 *
 * 高可用设计：
 *   · 首屏用缓存秒出（`hydrate()`），再后台刷新，失败不清空；
 *   · 没有课表时不说"加载失败"，而是明确区分「还没绑定教务系统」与
 *     「已绑定但今天没课」—— 这两种情况的下一步动作完全不同；
 *   · 手动加课做**节次区间校验**（后端也会校验），并且加完立刻刷新今日视图，
 *     让用户马上看到结果。
 */

function CourseRow({ course }: { course: ScheduleCourseView }) {
  return (
    <View className='kdy-schedule__course'>
      <View className='kdy-schedule__course-time'>
        <Text className='kdy-schedule__course-time-main'>{course.timeLabel}</Text>
        <Text className='kdy-schedule__course-time-sub'>{course.slotLabel}</Text>
      </View>
      <View className='kdy-schedule__course-body'>
        <Text className='kdy-schedule__course-name'>{course.courseName}</Text>
        <Text className='kdy-schedule__course-meta'>{courseSubtitle(course) || '地点未登记'}</Text>
      </View>
    </View>
  )
}

export default function SchedulePage() {
  const container = getContainer()
  const schedule = container.useCases.campus.schedule
  const state = useStore(schedule)

  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draft, setDraft] = useState({ courseName: '', location: '', teacher: '', weekday: 1, startSlot: 1, endSlot: 2 })
  const [formError, setFormError] = useState<string | null>(null)

  useDidShow(() => {
    schedule.hydrate()
    void schedule.load()
  })

  const today = state.today
  const week = state.week
  const activeDay = selectedDay ?? week?.today ?? today?.weekday ?? 1
  const activeDayCourses = week?.days.find((day) => day.weekday === activeDay)?.courses ?? []

  async function handleSync(): Promise<void> {
    const result = await schedule.sync()
    if (result.error !== null) {
      // 绑定类错误给"去绑定"，其它给重试提示
      toast(result.needsBinding ? '还没有绑定教务系统，先去身份页绑定' : result.error)
      if (result.needsBinding) void navigateTo(PAGE_PATHS.identity)
      return
    }
    toast(`已同步 ${result.lastSync?.imported ?? 0} 门课程`)
  }

  /** 节次选择：点更晚的节次延长区间；点区间内则重新以它作为起点 */
  function pickSlot(value: number): void {
    setDraft((prev) => {
      if (value < prev.startSlot) return { ...prev, startSlot: value }
      if (value > prev.endSlot) return { ...prev, endSlot: value }
      return { ...prev, startSlot: value, endSlot: value }
    })
  }

  async function handleAddCourse(): Promise<void> {
    if (draft.courseName.trim() === '') {
      setFormError('课程名不能为空')
      return
    }
    if (draft.startSlot > draft.endSlot) {
      setFormError('开始节次不能晚于结束节次')
      return
    }
    setFormError(null)

    const result = await schedule.addCourse({
      courseName: draft.courseName.trim(),
      teacher: draft.teacher.trim(),
      location: draft.location.trim(),
      weekday: draft.weekday,
      startSlot: draft.startSlot,
      endSlot: draft.endSlot,
    })

    if (!result.ok) {
      setFormError(result.message)
      return
    }
    toast(result.message)
    setDraft({ courseName: '', location: '', teacher: '', weekday: draft.weekday, startSlot: 1, endSlot: 2 })
    setShowAddForm(false)
  }

  return (
    <View className='kdy-page kdy-schedule'>
      <KdyHeading
        title='课表'
        subtitle='时间由服务端按学校时钟计算，手机时间不准也不会看错'
        eyebrow='KEDAYA · 课表'
      />

      {today?.simulated === true && (
        <View className='kdy-schedule__notice'>
          <Text className='kdy-schedule__notice-text'>当前课表来自演示数据源，不代表真实教务数据。</Text>
        </View>
      )}

      {/* 今日：页面最重要的一块 */}
      <KdyCard
        title={`今天 · ${today?.weekdayLabel ?? ''}`}
        extra={
          <KdyTag tone={state.syncing ? 'warning' : state.error === null ? 'brand' : 'neutral'}>
            {state.syncing ? '同步中' : state.fromCache ? '缓存数据' : '已同步'}
          </KdyTag>
        }
      >
        {today === null && state.status === 'loading' && <Text className='kdy-schedule__muted'>正在读取课表…</Text>}

        {today !== null && (
          <>
            <Text className='kdy-schedule__status'>{todayStatusText(today.ongoing.length > 0, today.next !== null, today.finishedForToday, countdownLabel(today.minutesUntilNext), state.needsBinding)}</Text>

            {today.courses.length === 0 ? (
              <KdyEmpty
                mode={state.needsBinding ? 'empty' : 'empty'}
                title='今天没有排课'
                description={
                  state.needsBinding
                    ? '还没有绑定教务系统，绑定后才能同步本学期课表。'
                    : '如果这不对，可能还没同步过课表。'
                }
                actionText={state.needsBinding ? '去绑定教务系统' : '同步课表'}
                onAction={() => {
                  if (state.needsBinding) void navigateTo(PAGE_PATHS.identity)
                  else void handleSync()
                }}
              />
            ) : (
              <View className='kdy-schedule__courses'>
                {today.courses.map((course) => (
                  <CourseRow key={course.id} course={course} />
                ))}
              </View>
            )}

            {today.conflicts.length > 0 && (
              <View className='kdy-schedule__conflict'>
                <Text className='kdy-schedule__conflict-title'>检测到时间冲突</Text>
                {today.conflicts.map((conflict) => (
                  <Text key={`${conflict.a.id}-${conflict.b.id}`} className='kdy-schedule__conflict-text'>
                    {conflictLabel(conflict)}
                  </Text>
                ))}
              </View>
            )}
          </>
        )}

        <View className='kdy-schedule__actions'>
          <KdyButton size='sm' loading={state.syncing} onClick={() => void handleSync()}>
            同步课表
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => setShowAddForm((value) => !value)}>
            {showAddForm ? '收起手动添加' : '手动添加课程'}
          </KdyButton>
        </View>

        {state.error !== null && <Text className='kdy-schedule__error'>{state.error}</Text>}
      </KdyCard>

      {/* 手动加课：只覆盖"临时调课"这一种场景 */}
      {showAddForm && (
        <KdyCard title='手动添加课程'>
          <KdyField
            label='课程名'
            value={draft.courseName}
            maxLength={80}
            placeholder='例如：数据结构与算法'
            onChange={(value) => setDraft((prev) => ({ ...prev, courseName: value }))}
          />
          <KdyField
            label='地点'
            value={draft.location}
            maxLength={60}
            placeholder='例如：信息楼 305'
            onChange={(value) => setDraft((prev) => ({ ...prev, location: value }))}
          />
          <KdyField
            label='教师'
            value={draft.teacher}
            maxLength={40}
            placeholder='可留空'
            onChange={(value) => setDraft((prev) => ({ ...prev, teacher: value }))}
          />

          <Text className='kdy-schedule__form-label'>星期</Text>
          <View className='kdy-schedule__chips'>
            {WEEKDAY_LABELS.map((label, index) => (
              <KdyChip
                key={label}
                active={draft.weekday === index + 1}
                onClick={() => setDraft((prev) => ({ ...prev, weekday: index + 1 }))}
              >
                {label}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-schedule__form-label'>节次</Text>
          <View className='kdy-schedule__chips'>
            {SLOT_OPTIONS.map((option) => (
              <KdyChip
                key={option.value}
                active={option.value >= draft.startSlot && option.value <= draft.endSlot}
                onClick={() => pickSlot(option.value)}
              >
                {option.label}
              </KdyChip>
            ))}
          </View>
          <Text className='kdy-schedule__muted'>
            已选：第 {draft.startSlot}–{draft.endSlot} 节（点更晚的节次延长区间，点区间内则重新开始，最多 {MAX_SLOT} 节）
          </Text>

          {formError !== null && <Text className='kdy-schedule__error'>{formError}</Text>}

          <View className='kdy-schedule__actions'>
            <KdyButton size='sm' onClick={() => void handleAddCourse()}>
              加入课表
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {/* 本周 */}
      <KdyCard
        title='本周'
        extra={week !== null && week.terms.length > 1 ? <KdyTag tone='neutral'>{week.termLabel}</KdyTag> : undefined}
      >
        <View className='kdy-schedule__chips'>
          {WEEKDAY_LABELS.map((label, index) => {
            const weekday = index + 1
            return (
              <KdyChip key={label} active={activeDay === weekday} onClick={() => setSelectedDay(weekday)}>
                {week?.today === weekday ? `今天` : label}
              </KdyChip>
            )
          })}
        </View>

        {week !== null && week.terms.length > 1 && (
          <>
            <Text className='kdy-schedule__form-label'>学期</Text>
            <View className='kdy-schedule__chips'>
              {week.terms.map((term) => (
                <KdyChip key={term} active={state.term === term} onClick={() => void schedule.switchTerm(term)}>
                  {term}
                </KdyChip>
              ))}
            </View>
          </>
        )}

        {activeDayCourses.length === 0 ? (
          <Text className='kdy-schedule__muted'>{WEEKDAY_LABELS[activeDay - 1]}没有课。</Text>
        ) : (
          <View className='kdy-schedule__courses'>
            {activeDayCourses.map((course) => (
              <CourseRow key={course.id} course={course} />
            ))}
          </View>
        )}

        {week !== null && week.conflicts.length > 0 && (
          <View className='kdy-schedule__conflict'>
            <Text className='kdy-schedule__conflict-title'>本周有 {week.conflicts.length} 处时间冲突</Text>
            {week.conflicts.map((conflict) => (
              <Text key={`${conflict.a.id}-${conflict.b.id}`} className='kdy-schedule__conflict-text'>
                {conflictLabel(conflict)}
              </Text>
            ))}
          </View>
        )}
      </KdyCard>

      <KdyAgentFab module='schedule' page={PAGE_PATHS.schedule} hint='下一节在哪？' />
    </View>
  )
}

/** 今日状态一句话 —— 把四种情况写成四种不同的话，而不是一句"暂无数据" */
function todayStatusText(
  hasOngoing: boolean,
  hasNext: boolean,
  finished: boolean,
  countdown: string,
  needsBinding: boolean,
): string {
  if (hasOngoing) return '正在上课'
  if (hasNext) return countdown === '' ? '接下来还有课' : `下一节${countdown}`
  if (finished) return '今天的课上完了 🎉'
  if (needsBinding) return '还没有绑定教务系统'
  return '今天没有排课'
}
