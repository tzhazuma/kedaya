import { ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { layoutDayLanes } from '../../../application/schedule/timetable'
import { MAX_SLOT } from '../../../domain/models/schedule'
import type { ScheduleCourseView, ScheduleDayView } from '../../../domain/models/schedule'

import './index.scss'

/**
 * KdyTimetable —— 真正按「星期 × 节次」排布的周课表。
 *
 * ## 版面为什么长这样
 *
 * 课表的用户问题不是"我有哪些课"，而是"**哪天空、什么时候有课**"：
 * 只有把 7 天并排、节次上下对齐，一眼扫过去的形状才有意义。所以：
 *   · 左边是固定的节次轴（1–12），右边是 7 个等宽的日列；
 *   · 一节课占 `endSlot - startSlot + 1` 行 —— 高度就是课时长度，
 *     "周三上午满课"在格子上是一块连着的方块，而不是三行文字；
 *   · 同一时段撞课（教务允许选修冲突 / 手动加课打错节次）**并排成车道**，
 *     不把其中一门盖掉；车道由 `layoutDayLanes()` 纯函数算好。
 *
 * ## 为什么横向滚动而不是压成 7 列
 *
 * 375px 屏上，扣掉节次轴后每列只有 40 多 px：课名会竖着断成单字，
 * 两门课并排后彻底没法读。这里保留 **88px/列**，一屏能看 3 天多一点，
 * 打开时自动滚到"今天"；下面的「某天课程清单」负责把课名读全。
 * 7 天全部塞进一屏是"看起来完整"，代价是"每格都读不出来"。
 *
 * ## 只做展示
 *
 * 组件不请求、不缓存、不做业务判断：`days` / 冲突 id / 选中日全由页面给。
 * 这样换学期、空态、加载态仍然只有页面一处逻辑。
 */

const SLOTS: readonly number[] = Array.from({ length: MAX_SLOT }, (_, index) => index + 1)

/**
 * 构建期常量（Taro 在编译时静态注入，小程序产物里这一行折叠成 `false`）。
 *
 * 不引 `platform/env` 的 `isH5()`：那条路径依赖 `typeof process`，
 * H5 运行时没有 process polyfill，会退化成 unknown（实测）。
 */
const IS_H5_BUILD = process.env.TARO_ENV === 'h5'

/** 把节次夹进 1..MAX_SLOT：脏数据不该把方块画到格子外面 */
function clampSlot(slot: number): number {
  return Math.max(1, Math.min(MAX_SLOT, Math.round(slot)))
}

export interface KdyTimetableProps {
  days: readonly ScheduleDayView[]
  /** 当前选中的星期（1=周一 … 7=周日），用于高亮与滚动 */
  selectedWeekday: number
  /** 冲突涉及的课程 id —— 方块描红边 */
  conflictIds?: ReadonlySet<string>
  onSelectDay: (weekday: number) => void
  onSelectCourse?: (course: ScheduleCourseView) => void
  className?: string
}

export function KdyTimetable({
  days,
  selectedWeekday,
  conflictIds,
  onSelectDay,
  onSelectCourse,
  className,
}: KdyTimetableProps) {
  const classes = ['kdy-timetable', className ?? ''].filter((item) => item !== '').join(' ')

  /**
   * 打开时滚到"今天"。
   *
   * 两个坑：
   *   1. H5 的 web-component 版 scroll-view 只在**属性变化**时执行滚动，
   *      首帧传入的值会被忽略（表现是"打开永远停在周一"）；
   *   2. 页面转场期间容器还没有稳定尺寸，早于布局完成的 scrollIntoView
   *      会被浏览器当成"目标已可见"而跳过。
   *
   * 因此：挂载后延后 ~150ms 再滚；H5 直接调 DOM 的 `scrollIntoView`
   *（Taro H5 的属性监听实测不可靠），小程序仍走 `scroll-into-view`。
   * 两端都带平滑滚动，用户看到的是"滑到今天"，不是跳变。
   *
   * 用 `IS_H5_BUILD`（构建期常量）而不是运行时探测：小程序运行时也有
   * 一层 `document` 垫片，`typeof document` 在两端都成立，不能拿来区分平台。
   */
  const [scrollTarget, setScrollTarget] = useState('')
  useEffect(() => {
    const target = `kdy-timetable-day-${selectedWeekday}`

    if (IS_H5_BUILD && typeof document !== 'undefined') {
      const scrollToTarget = (behavior: ScrollBehavior): void => {
        document.querySelector(`#${target}`)?.scrollIntoView({
          behavior,
          block: 'nearest',
          inline: 'start',
        })
      }
      // 首屏可能还在等数据到位：150ms 平滑滚一次，700ms / 1600ms 若仍停在起点再补
      // （数据刷新会让 scrollLeft 归零；用户已经滚走了就不再打扰）
      const first = setTimeout(() => scrollToTarget('smooth'), 150)
      const retries = [700, 1600].map((delay) =>
        setTimeout(() => {
          const container = document.querySelector('.kdy-timetable__scroll')
          if (container !== null && container.scrollLeft !== 0) return
          scrollToTarget('auto')
        }, delay),
      )
      return () => {
        clearTimeout(first)
        for (const timer of retries) clearTimeout(timer)
      }
    }

    const timer = setTimeout(() => setScrollTarget(target), 150)
    return () => clearTimeout(timer)
  }, [selectedWeekday])

  return (
    <View className={classes}>
      <View className='kdy-timetable__axis'>
        <View className='kdy-timetable__axis-head'>
          <Text className='kdy-timetable__axis-head-text'>节次</Text>
        </View>
        {SLOTS.map((slot) => (
          <View className='kdy-timetable__axis-cell' key={`axis-${slot}`}>
            <Text className='kdy-timetable__axis-text'>{slot}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        className='kdy-timetable__scroll'
        scrollX
        scrollWithAnimation
        scrollIntoView={scrollTarget}
      >
        <View className='kdy-timetable__canvas'>
          <View className='kdy-timetable__head'>
            {days.map((day) => {
              const isSelected = day.weekday === selectedWeekday
              return (
                <View
                  id={`kdy-timetable-day-${day.weekday}`}
                  key={`head-${day.weekday}`}
                  className={[
                    'kdy-timetable__head-cell',
                    day.isToday ? 'kdy-timetable__head-cell--today' : '',
                    isSelected ? 'kdy-timetable__head-cell--selected' : '',
                  ]
                    .filter((item) => item !== '')
                    .join(' ')}
                  onClick={() => onSelectDay(day.weekday)}
                >
                  <Text className='kdy-timetable__head-text'>
                    {day.isToday ? '今天' : day.label}
                  </Text>
                </View>
              )
            })}
          </View>

          <View className='kdy-timetable__body'>
            {days.map((day) => {
              const isSelected = day.weekday === selectedWeekday
              const placements = layoutDayLanes(day.courses)

              return (
                <View
                  key={`day-${day.weekday}`}
                  className={[
                    'kdy-timetable__day',
                    day.isToday ? 'kdy-timetable__day--today' : '',
                    isSelected ? 'kdy-timetable__day--selected' : '',
                  ]
                    .filter((item) => item !== '')
                    .join(' ')}
                  onClick={() => onSelectDay(day.weekday)}
                >
                  {SLOTS.map((slot) => (
                    <View className='kdy-timetable__slot' key={`slot-${day.weekday}-${slot}`} />
                  ))}

                  {placements.map(({ course, lane, lanes }) => {
                    const startSlot = clampSlot(course.startSlot)
                    const endSlot = clampSlot(course.endSlot)
                    const span = Math.max(1, endSlot - startSlot + 1)
                    const isConflict = conflictIds?.has(course.id) === true
                    const compact = span === 1

                    /** 并排时用 1px 缝隙把两门课分开，避免看起来是一门课的两段 */
                    const width = lanes <= 1 ? '100%' : `calc(${100 / lanes}% - 2px)`
                    const left = lanes <= 1 ? '0%' : `calc(${(100 * lane) / lanes}% + 1px)`

                    return (
                      <View
                        key={course.id}
                        className={[
                          'kdy-timetable__course',
                          isConflict ? 'kdy-timetable__course--conflict' : '',
                          compact ? 'kdy-timetable__course--compact' : '',
                        ]
                          .filter((item) => item !== '')
                          .join(' ')}
                        style={{
                          // 上下各留 1px：相邻两节课之间露出格子线，方块不会糊成一片
                          top: `calc(${((startSlot - 1) / MAX_SLOT) * 100}% + 1px)`,
                          height: `calc(${(span / MAX_SLOT) * 100}% - 2px)`,
                          left,
                          width,
                        }}
                        aria-label={`${day.label} 第 ${course.startSlot}-${course.endSlot} 节 ${course.courseName}${
                          course.location === null ? '' : `，${course.location}`
                        }`}
                        onClick={(event) => {
                          // 点课程是"看这门课"，不是"切到这一天"；事件冒泡会让日列也做一次同样的事，
                          // 这里显式停掉，避免上层再把选中态覆盖掉。
                          event.stopPropagation()
                          onSelectDay(day.weekday)
                          onSelectCourse?.(course)
                        }}
                      >
                        <Text className='kdy-timetable__course-name'>{course.courseName}</Text>
                        {!compact && course.location !== null && (
                          <Text className='kdy-timetable__course-meta'>{course.location}</Text>
                        )}
                      </View>
                    )
                  })}
                </View>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

export default KdyTimetable
