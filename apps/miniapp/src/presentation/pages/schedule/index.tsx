import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { MAX_SLOT, SLOT_OPTIONS, WEEKDAY_LABELS } from '../../../domain/models/schedule'
import { navigateTo, toast } from '../../../platform/navigation'
import {
  KdyAgentFab,
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyField,
  KdyListSkeleton,
  KdyTag,
} from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import { TodayPanel } from './TodayPanel'
import { WeekPanel } from './WeekPanel'
import './index.scss'

/**
 * 课表（`schedule`）—— 「我现在该去哪」，以及「这周什么时候有空」。
 *
 * ## 两种视图，而不是一条长页面
 *
 * 用户打开课表只有两件事要做：**马上要上的课**（今天）和**安排这一周**（本周）。
 * 原来把"今天 → 本周 → 同步 → 手动加课"堆成一条长滚动，四件事互相稀释；
 * 现在顶部一个「今天 / 本周」切换，各自占满一屏：
 *   · 今天：状态大字 + 下一节倒计时 + 时间轴（课与空档）；
 *   · 本周：7×12 格子 + 选中那天的课程清单。
 * 同步 / 手动加课是低频维护动作，收在页面最下面的「课表工具」里。
 *
 * ## 状态机沿用用例层
 *
 * `hydrate()` 同步出缓存 → `load()` 后台刷新 → 失败保留旧数据（`application/campus`）。
 * 页面不写自己的 `loading` 布尔：`status` 就是唯一真相，
 * 首屏没有数据时用 `KdyListSkeleton`，有旧数据时只标「缓存数据」。
 *
 * ## 时间文案
 *
 * "还有 20 分钟"来自服务端（`minutesUntilNext`），页面只做本地流逝递减；
 * 每节课的起止时间直接显示服务端的 `timeLabel`，客户端不维护作息表。
 */

type ScheduleView = 'today' | 'week'

interface CourseDraft {
  courseName: string
  location: string
  teacher: string
  weekday: number
  startSlot: number
  endSlot: number
}

const EMPTY_DRAFT: CourseDraft = {
  courseName: '',
  location: '',
  teacher: '',
  weekday: 1,
  startSlot: 1,
  endSlot: 2,
}

export default function SchedulePage() {
  const container = getContainer()
  const schedule = container.useCases.campus.schedule
  const state = useStore(schedule)

  const [view, setView] = useState<ScheduleView>('today')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [focusCourseId, setFocusCourseId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draft, setDraft] = useState<CourseDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)

  useDidShow(() => {
    schedule.hydrate()
    void schedule.load()
  })

  usePullDownRefresh(() => {
    // 转圈必须等请求真的结束再收：早收会让用户以为刷完了
    void schedule.load().then(() => Taro.stopPullDownRefresh())
  })

  const today = state.today
  const week = state.week
  const hasAnyData = today !== null || week !== null
  const initialLoading = !hasAnyData && (state.status === 'idle' || state.status === 'loading')
  const initialError = !hasAnyData && state.status === 'error'
  const simulated = today?.simulated === true || week?.simulated === true
  const activeDay = selectedDay ?? week?.today ?? today?.weekday ?? 1

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

  function pickStart(value: number): void {
    setDraft((prev) => ({
      ...prev,
      startSlot: value,
      // 开始节次往后挪时把结束节次一起推后，避免出现"开始 5 结束 2"的非法区间
      endSlot: Math.max(value, prev.endSlot),
    }))
  }

  function pickEnd(value: number): void {
    setDraft((prev) => ({ ...prev, endSlot: Math.max(value, prev.startSlot) }))
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
    setDraft({ ...EMPTY_DRAFT, weekday: draft.weekday })
    setShowAddForm(false)
  }

  function handleSelectDay(weekday: number): void {
    setSelectedDay(weekday)
    setFocusCourseId(null)
  }

  function handleSelectCourse(course: { id: string; weekday: number }): void {
    setSelectedDay(course.weekday)
    setFocusCourseId(course.id)
  }

  return (
    <View className='kdy-page kdy-schedule'>
      <KdyHeading title='课表' subtitle={week?.termLabel} />

      {simulated && (
        <View className='kdy-schedule__notice'>
          <Text className='kdy-schedule__notice-text'>课表为演示数据，非真实教务数据。</Text>
        </View>
      )}

      {initialLoading ? (
        <View className='kdy-schedule__loading'>
          <KdyListSkeleton rows={2} />
        </View>
      ) : initialError ? (
        <KdyCard title='课表'>
          <KdyEmpty
            mode='error'
            title='课表没加载出来'
            description={state.error ?? '网络不太稳定，重试一次。'}
            actionText='重试'
            onAction={() => void schedule.load()}
          />
        </KdyCard>
      ) : (
        <>
          <View className='kdy-schedule__switch'>
            <KdyChip active={view === 'today'} onClick={() => setView('today')}>
              今天
            </KdyChip>
            <KdyChip active={view === 'week'} onClick={() => setView('week')}>
              本周
            </KdyChip>
            {state.syncing && <KdyTag tone='warning'>同步中</KdyTag>}
          </View>

          {view === 'today' ? (
            <TodayPanel
              today={today}
              week={week}
              needsBinding={state.needsBinding}
              fromCache={state.fromCache}
              syncing={state.syncing}
              onSync={() => void handleSync()}
              onBind={() => void navigateTo(PAGE_PATHS.identity)}
              onRetry={() => void schedule.load()}
              onOpenWeek={() => setView('week')}
            />
          ) : (
            <WeekPanel
              week={week}
              selectedWeekday={activeDay}
              focusCourseId={focusCourseId}
              needsBinding={state.needsBinding}
              onSelectDay={handleSelectDay}
              onSelectCourse={handleSelectCourse}
              onSwitchTerm={(term) => void schedule.switchTerm(term)}
              onSync={() => void handleSync()}
              onBind={() => void navigateTo(PAGE_PATHS.identity)}
              onRetry={() => void schedule.load()}
            />
          )}

          <KdyCard
            title='课表工具'
            extra={
              <KdyTag tone={state.syncing ? 'warning' : state.error === null ? 'neutral' : 'danger'}>
                {state.syncing ? '同步中' : state.error === null ? '数据维护' : '同步失败'}
              </KdyTag>
            }
          >
            <Text className='kdy-schedule__muted'>
              课表来自教务系统同步；临时调课可以手动加一节。
            </Text>

            {state.fromCache && state.updatedAt !== null && (
              <Text className='kdy-schedule__muted'>
                当前显示 {formatUpdatedAt(state.updatedAt)} 的缓存数据，联网后会自动刷新。
              </Text>
            )}

            {state.needsBinding && (
              <Text className='kdy-schedule__muted'>
                还没有绑定教务系统，同步前需要先去身份页绑定。
              </Text>
            )}

            <View className='kdy-schedule__actions'>
              <KdyButton size='sm' loading={state.syncing} onClick={() => void handleSync()}>
                同步课表
              </KdyButton>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => setShowAddForm((value) => !value)}
              >
                {showAddForm ? '收起手动添加' : '手动添加课程'}
              </KdyButton>
            </View>

            {state.error !== null && <Text className='kdy-schedule__error'>{state.error}</Text>}
          </KdyCard>

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

              <Text className='kdy-schedule__form-label'>开始节次</Text>
              <View className='kdy-schedule__chips'>
                {SLOT_OPTIONS.map((option) => (
                  <KdyChip
                    key={`start-${option.value}`}
                    active={draft.startSlot === option.value}
                    onClick={() => pickStart(option.value)}
                  >
                    {option.value}
                  </KdyChip>
                ))}
              </View>

              <Text className='kdy-schedule__form-label'>结束节次</Text>
              <View className='kdy-schedule__chips'>
                {SLOT_OPTIONS.filter((option) => option.value >= draft.startSlot).map((option) => (
                  <KdyChip
                    key={`end-${option.value}`}
                    active={draft.endSlot === option.value}
                    onClick={() => pickEnd(option.value)}
                  >
                    {option.value}
                  </KdyChip>
                ))}
              </View>

              <Text className='kdy-schedule__muted'>
                已选：第 {draft.startSlot}–{draft.endSlot} 节（{draft.endSlot - draft.startSlot + 1}{' '}
                节，最多 {MAX_SLOT} 节）
              </Text>

              {formError !== null && <Text className='kdy-schedule__error'>{formError}</Text>}

              <View className='kdy-schedule__actions'>
                <KdyButton size='sm' onClick={() => void handleAddCourse()}>
                  加入课表
                </KdyButton>
              </View>
            </KdyCard>
          )}
        </>
      )}

      <KdyAgentFab module='schedule' page={PAGE_PATHS.schedule} />
    </View>
  )
}

/** 缓存时间：显示到分钟就够，用户只需要判断"是不是很久以前" */
function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
