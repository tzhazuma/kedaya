import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  DEADLINE_SOURCE_LABELS,
  DEADLINE_SOURCES,
  type DeadlineSource,
} from '@kedaya/contracts'
import { parseDueText } from '@kedaya/shared'
import { useEffect, useState } from 'react'

import {
  SCHOOL_TIME_ZONE,
  buildDeadlineBoardView,
  createDeadlineBoardUseCase,
  type DeadlineBoardFilter,
  type DeadlineRowView,
} from '../../../application/deadlines/deadlineBoard'
import { buildDemoDeadlineItems } from '../../../application/deadlines/deadlineDemo'
import { createDeadlineLocalRepository } from '../../../data/repositories/deadlineLocalRepository'
import { toast } from '../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyField,
  KdyListSkeleton,
  KdyTag,
} from '../../components'
import { KdyDemoTools } from '../../components/KdyDemoTools'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'

import './index.scss'

/**
 * 「DDL 聚合」—— 今天要交什么、这周还差什么。
 *
 * ## 数据从哪来
 *
 * 这一轮**没有 DDL 后端模块**（`services/` 里还没有），所以条目只来自本机：
 * 用户粘贴/手动补的 DDL 由 `deadlineLocalRepository` 写进微信 storage，
 * 本页同步读出来渲染。页面不请求网络，也就不演「同步失败 / 正在拉取」。
 *
 * ## 三条时间纪律
 *
 * 1. 所有截止时刻按**学校时区**（`Asia/Shanghai`）格式化，不用
 *    `toLocaleString()`（那会跟着设备时区漂 8 小时）；
 * 2. 「还有 3 小时 / 已逾期 2 天」基于**当前时刻**每 30 秒重算一次；
 * 3. 排序与汇总全部交给 `@kedaya/shared` 的 `sortByUrgency` / `summarizeDeadlines`，
 *    页面不自己定义「今天」的边界。
 *
 * ## 演示数据
 *
 * 收在折叠的「演示与调试工具」里，只在**没有任何真实条目**时出现，
 * 并且常驻「演示数据」标签、不可标记已交 / 删除 —— 它不是用户的数据。
 */

/** 用例是页面级单例：切页返回时 useDidShow 会重新 hydrate，storage 是唯一真相 */
const board = createDeadlineBoardUseCase({
  store: createDeadlineLocalRepository(),
})

/** 相对时间每 30 秒刷新一次（分钟级文案不需要更密） */
const CLOCK_TICK_MS = 30 * 1000

export default function DeadlinesPage() {
  const state = useStore(board)

  const [now, setNow] = useState<Date>(() => new Date())
  const [filter, setFilter] = useState<DeadlineBoardFilter>('all')
  const [showDemo, setShowDemo] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [title, setTitle] = useState('')
  const [courseName, setCourseName] = useState('')
  const [dueText, setDueText] = useState('')
  const [source, setSource] = useState<DeadlineSource>('manual')
  const [formError, setFormError] = useState<string | null>(null)

  // 从粘贴页 / 手动添加返回时立刻反映 storage 的最新内容
  useDidShow(() => {
    board.hydrate()
    setNow(new Date())
  })

  useEffect(() => {
    board.hydrate()
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const loading = state.status === 'idle'
  const isDemo = state.items.length === 0 && showDemo
  const items = isDemo ? buildDemoDeadlineItems(now) : state.items
  const view = buildDeadlineBoardView(items, now, filter)
  const summary = view.summary

  const filters: ReadonlyArray<{ id: DeadlineBoardFilter; label: string }> = [
    { id: 'all', label: `全部 ${summary.total}` },
    { id: 'overdue', label: `已逾期 ${summary.overdue}` },
    { id: 'today', label: `今天 ${summary.dueToday}` },
    { id: 'thisWeek', label: `本周 ${summary.dueThisWeek}` },
  ]

  function handleSubmit(): void {
    const trimmedTitle = title.trim()
    const trimmedCourse = courseName.trim()
    if (trimmedTitle === '') {
      setFormError('标题不能为空')
      return
    }
    if (trimmedCourse === '') {
      setFormError('课程名不能为空（例如 CS101）')
      return
    }

    // 时区必传：平台上的时间都是学校时区，设备在别的时区也不能漂
    const dueAt = parseDueText(dueText, new Date(), SCHOOL_TIME_ZONE)
    if (dueAt === null) {
      setFormError('认不出这个时间，试试「10月20日 23:59」或「2026-10-20 23:59」')
      return
    }

    const created = board.add({
      title: trimmedTitle,
      courseName: trimmedCourse,
      dueAt,
      dueAtRaw: dueText,
      source,
    })
    if (created === null) {
      setFormError('保存失败，请检查标题、课程与时间')
      return
    }

    setFormError(null)
    setTitle('')
    setCourseName('')
    setDueText('')
    setSource('manual')
    setShowForm(false)
    setNow(new Date())
    toast('已保存')
  }

  async function handleRemove(id: string): Promise<void> {
    const result = await Taro.showModal({
      title: '删除这条 DDL',
      content: '只删除本机记录，不会影响平台上的作业。',
      confirmText: '删除',
    })
    if (result.confirm) board.remove(id)
  }

  async function handleClearAll(): Promise<void> {
    const result = await Taro.showModal({
      title: '清空本机 DDL',
      content: '会删除这台手机上保存的全部 DDL 记录（含手动添加的）。',
      confirmText: '清空',
    })
    if (result.confirm) {
      board.clear()
      setShowDemo(false)
      toast('已清空')
    }
  }

  function renderRow(row: DeadlineRowView) {
    const relativeClass =
      row.submitted === true
        ? 'kdy-ddl__relative'
        : row.urgency === 'overdue'
          ? 'kdy-ddl__relative kdy-ddl__relative--overdue'
          : row.urgency === 'today'
            ? 'kdy-ddl__relative kdy-ddl__relative--today'
            : 'kdy-ddl__relative'

    return (
      <View
        className={row.submitted ? 'kdy-ddl__item kdy-ddl__item--done' : 'kdy-ddl__item'}
        key={row.id}
      >
        <View className='kdy-ddl__item-tags'>
          <KdyTag tone='neutral'>{row.sourceLabel}</KdyTag>
          <KdyTag tone='brand'>{row.kindLabel}</KdyTag>
          {row.submitted && <KdyTag tone='success'>已交</KdyTag>}
          {!row.submitted && row.urgency === 'overdue' && <KdyTag tone='warning'>已逾期</KdyTag>}
          {row.stale && <KdyTag tone='warning'>上次采集</KdyTag>}
        </View>

        <Text className='kdy-ddl__item-title'>{row.title}</Text>
        <Text className='kdy-ddl__item-course'>{row.courseName}</Text>

        <View className='kdy-ddl__item-foot'>
          <View className='kdy-ddl__item-time'>
            <Text className='kdy-ddl__item-due'>{row.dueLabel}</Text>
            <Text className={relativeClass}>{row.relativeLabel}</Text>
          </View>

          {/* 演示数据不属于用户，不给「标记已交 / 删除」这种会让人误以为真的写入了的操作 */}
          {!isDemo && (
            <View className='kdy-ddl__item-actions'>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => board.toggleSubmitted(row.id)}
              >
                {row.submitted ? '撤销已交' : '标记已交'}
              </KdyButton>
              <KdyButton size='sm' variant='ghost' onClick={() => void handleRemove(row.id)}>
                删除
              </KdyButton>
            </View>
          )}
        </View>
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-ddl'>
      <KdyHeading
        title='DDL 聚合'
        subtitle='把 Blackboard / Gradescope / Piazza / e云平台 的截止日期放在一起。'
      />

      {isDemo && (
        <View className='kdy-ddl__demo-note'>
          <KdyTag tone='warning'>演示数据</KdyTag>
          <Text className='kdy-ddl__demo-note-text'>
            下面的是演示数据，不是你的作业；关掉演示就不会再出现。
          </Text>
        </View>
      )}

      {loading ? (
        <View className='kdy-ddl__loading'>
          <KdyListSkeleton rows={3} />
        </View>
      ) : (
        <>
          {items.length === 0 && !showForm && (
            <KdyEmpty
              mode='empty'
              title='还没有 DDL'
              description='粘贴一份作业列表试试；也可以先手动加一条。'
              actionText='手动添加一条'
              onAction={() => setShowForm(true)}
            />
          )}

          {showForm && (
            <KdyCard title='手动添加一条' className='kdy-ddl__form'>
              <KdyField
                label='标题'
                required
                value={title}
                onChange={setTitle}
                placeholder='例如 作业 3：进程调度'
                maxLength={60}
              />
              <KdyField
                label='课程'
                required
                value={courseName}
                onChange={setCourseName}
                placeholder='例如 CS101'
                maxLength={30}
              />
              <KdyField
                label='截止时间'
                required
                value={dueText}
                onChange={setDueText}
                placeholder='例如 10月20日 23:59'
                hint='按学校时区（北京时间）理解'
                maxLength={40}
              />

              <Text className='kdy-ddl__form-label'>来源</Text>
              <View className='kdy-ddl__form-sources'>
                {DEADLINE_SOURCES.map((item) => (
                  <KdyChip
                    key={item}
                    active={source === item}
                    onClick={() => setSource(item)}
                  >
                    {DEADLINE_SOURCE_LABELS[item]}
                  </KdyChip>
                ))}
              </View>

              {formError !== null && <Text className='kdy-ddl__form-error'>{formError}</Text>}

              <View className='kdy-ddl__form-actions'>
                <KdyButton size='sm' variant='ghost' onClick={() => setShowForm(false)}>
                  取消
                </KdyButton>
                <KdyButton size='sm' variant='primary' onClick={handleSubmit}>
                  保存
                </KdyButton>
              </View>
            </KdyCard>
          )}

          {items.length > 0 && (
            <>
              <KdyCard elevated className='kdy-ddl__summary'>
                <View className='kdy-ddl__summary-head'>
                  <Text className='kdy-ddl__summary-title'>这学期还剩 {summary.total} 条</Text>
                  <KdyTag tone={summary.overdue > 0 ? 'warning' : 'neutral'}>
                    {summary.overdue > 0 ? `已逾期 ${summary.overdue}` : '暂无逾期'}
                  </KdyTag>
                </View>

                <View className='kdy-ddl__stats'>
                  <View
                    className={
                      summary.overdue > 0
                        ? 'kdy-ddl__stat kdy-ddl__stat--overdue'
                        : 'kdy-ddl__stat'
                    }
                  >
                    <Text className='kdy-ddl__stat-value'>{summary.overdue}</Text>
                    <Text className='kdy-ddl__stat-label'>已逾期</Text>
                  </View>
                  <View className='kdy-ddl__stat'>
                    <Text className='kdy-ddl__stat-value'>{summary.dueToday}</Text>
                    <Text className='kdy-ddl__stat-label'>今天</Text>
                  </View>
                  <View className='kdy-ddl__stat'>
                    <Text className='kdy-ddl__stat-value'>{summary.dueThisWeek}</Text>
                    <Text className='kdy-ddl__stat-label'>本周</Text>
                  </View>
                  <View className='kdy-ddl__stat'>
                    <Text className='kdy-ddl__stat-value'>{summary.total}</Text>
                    <Text className='kdy-ddl__stat-label'>全部</Text>
                  </View>
                </View>

                <Text className='kdy-ddl__hint'>{view.hint}</Text>
              </KdyCard>

              <View className='kdy-ddl__filters'>
                {filters.map((item) => (
                  <KdyChip
                    key={item.id}
                    active={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </KdyChip>
                ))}
              </View>
            </>
          )}

          {items.length > 0 && view.rows.length === 0 && (
            <KdyEmpty
              mode='empty'
              description='这个筛选下没有 DDL。'
              actionText='看全部'
              onAction={() => setFilter('all')}
            />
          )}

          {view.rows.length > 0 && (
            <View className='kdy-ddl__list'>{view.rows.map((row) => renderRow(row))}</View>
          )}

          {!showForm && items.length > 0 && (
            <View className='kdy-ddl__add'>
              <KdyButton block variant='secondary' onClick={() => setShowForm(true)}>
                手动添加一条
              </KdyButton>
            </View>
          )}
        </>
      )}

      <KdyDemoTools>
        <View className='kdy-ddl__demo-body'>
          <Text className='kdy-ddl__demo-text'>
            本页没有后端，条目只存在这台手机上。
            {state.items.length === 0
              ? '先看一份演示数据，能看清汇总、排序和逾期样式。'
              : `本机已有 ${state.items.length} 条记录，演示数据暂时隐藏。`}
          </Text>
          {state.items.length === 0 && (
            <KdyButton
              size='sm'
              variant='secondary'
              onClick={() => setShowDemo((current) => !current)}
            >
              {showDemo ? '隐藏演示数据' : '查看演示数据'}
            </KdyButton>
          )}
          {state.items.length > 0 && (
            <KdyButton size='sm' variant='ghost' onClick={() => void handleClearAll()}>
              清空本机 DDL
            </KdyButton>
          )}
        </View>
      </KdyDemoTools>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
