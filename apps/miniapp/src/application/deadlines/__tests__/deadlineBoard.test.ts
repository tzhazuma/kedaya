import type { DeadlineItem } from '@kedaya/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildDeadlineBoardView,
  createDeadlineBoardUseCase,
  formatDueAt,
  formatRelativeDue,
  type DeadlineLocalStore,
} from '../deadlineBoard'

/**
 * 「DDL 聚合」用例与视图模型的回归测试。
 *
 * 覆盖的全是**不会报错、只会显示错**的地方：
 *   · 时区（设备在伦敦时不能把上海 23:59 显示成 15:59）；
 *   · 「已逾期」文案（写成「-3 小时」用户会以为自己还有时间）；
 *   · 汇总口径（已提交的算进 total，但不进任何待办分档）；
 *   · 手动添加的幂等 id（同一份作业加两次不能变成两条）。
 */

const NOW = new Date('2026-10-19T04:00:00.000Z') // 北京时间 10 月 19 日（周一）12:00

function item(overrides: Partial<DeadlineItem> & Pick<DeadlineItem, 'id' | 'dueAt'>): DeadlineItem {
  return {
    source: 'blackboard',
    kind: 'assignment',
    title: '作业 1',
    courseId: 'cs101',
    courseName: 'CS101 操作系统',
    dueAtRaw: 'Oct 19, 2026 11:59 PM',
    sourceUrl: '',
    submitted: false,
    weight: null,
    ...overrides,
  }
}

describe('formatDueAt', () => {
  it('按学校时区（Asia/Shanghai）渲染，不跟着设备时区走', () => {
    // UTC 15:59 = 北京时间次日 23:59
    expect(formatDueAt('2026-10-20T15:59:00.000Z', NOW)).toBe('10月20日 周二 23:59')
  })

  it('跨年时补年份', () => {
    expect(formatDueAt('2027-01-05T15:59:00.000Z', NOW)).toBe('2027年1月5日 周二 23:59')
  })

  it('解析不出的时间给占位文案而不是 Invalid Date', () => {
    expect(formatDueAt('not-a-date', NOW)).toBe('时间待定')
  })
})

describe('formatRelativeDue', () => {
  it('未到期显示还有多久', () => {
    expect(formatRelativeDue(new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString(), NOW)).toBe(
      '还有 3 小时',
    )
    expect(formatRelativeDue(new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(), NOW)).toBe(
      '还有 30 分钟',
    )
    expect(
      formatRelativeDue(new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000 + 1000).toISOString(), NOW),
    ).toBe('还有 2 天')
  })

  it('已过期必须出现「已逾期」三个字（不能是负数）', () => {
    expect(
      formatRelativeDue(new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(), NOW),
    ).toBe('已逾期 2 小时')
    expect(
      formatRelativeDue(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), NOW),
    ).toBe('已逾期 2 天')
  })

  it('刚好到点时按已逾期处理', () => {
    expect(formatRelativeDue(NOW.toISOString(), NOW)).toBe('已逾期 1 分钟')
  })
})

describe('buildDeadlineBoardView', () => {
  const items: DeadlineItem[] = [
    item({ id: 'later', dueAt: '2026-11-01T12:00:00.000Z' }),
    item({ id: 'overdue', dueAt: '2026-10-19T01:00:00.000Z' }),
    item({ id: 'week', dueAt: '2026-10-21T12:00:00.000Z', title: '小测' }),
    item({ id: 'done', dueAt: '2026-10-19T12:00:00.000Z', submitted: true }),
    item({ id: 'today', dueAt: '2026-10-19T12:00:00.000Z', source: 'gradescope' }),
  ]

  it('汇总只把未提交的条目算进待办分档，total 包含全部', () => {
    const view = buildDeadlineBoardView(items, NOW)
    expect(view.summary).toEqual({ overdue: 1, dueToday: 1, dueThisWeek: 1, total: 5 })
  })

  it('排序：已逾期 → 今天 → 本周 → 更远 → 已提交', () => {
    const view = buildDeadlineBoardView(items, NOW)
    expect(view.rows.map((row) => row.id)).toEqual(['overdue', 'today', 'week', 'later', 'done'])
  })

  it('来源与类型文案来自契约常量', () => {
    const view = buildDeadlineBoardView(items, NOW)
    const today = view.rows.find((row) => row.id === 'today')
    expect(today?.sourceLabel).toBe('Gradescope')
    expect(today?.kindLabel).toBe('作业')
  })

  it('筛选只影响列表，不影响汇总', () => {
    const overdue = buildDeadlineBoardView(items, NOW, 'overdue')
    expect(overdue.rows.map((row) => row.id)).toEqual(['overdue'])
    expect(overdue.summary.total).toBe(5)

    const done = buildDeadlineBoardView(items, NOW, 'today').rows.find((row) => row.id === 'done')
    expect(done).toBeUndefined()
  })
})

describe('createDeadlineBoardUseCase', () => {
  function createStore(initial: DeadlineItem[] = []): DeadlineLocalStore & {
    writes: DeadlineItem[][]
    cleared: number
  } {
    let items = initial
    const writes: DeadlineItem[][] = []
    const store = {
      writes,
      cleared: 0,
      read: () => items,
      write(next: readonly DeadlineItem[]) {
        items = [...next]
        writes.push([...next])
      },
      clear() {
        items = []
        store.cleared += 1
      },
    }
    return store
  }

  it('hydrate 同步读本机，读出空列表也是 ready', () => {
    const useCase = createDeadlineBoardUseCase({
      store: createStore(),
    })
    expect(useCase.getSnapshot()).toEqual({ status: 'idle', items: [] })
    expect(useCase.hydrate()).toEqual({ status: 'ready', items: [] })
  })

  it('每次 hydrate 都重读：粘贴页写入后返回本页能看到', () => {
    const store = createStore([item({ id: 'pasted-1', dueAt: '2026-10-20T15:59:00.000Z' })])
    const useCase = createDeadlineBoardUseCase({ store })
    expect(useCase.hydrate().items.map((entry) => entry.id)).toEqual(['pasted-1'])
    store.write([item({ id: 'pasted-2', dueAt: '2026-10-21T15:59:00.000Z' })])
    expect(useCase.hydrate().items.map((entry) => entry.id)).toEqual(['pasted-2'])
  })

  it('手动添加会落本机、补全默认字段，并返回创建的条目', () => {
    const store = createStore()
    const useCase = createDeadlineBoardUseCase({ store })

    const created = useCase.add({
      title: '  作业 3  ',
      courseName: ' CS101 ',
      dueAt: '2026-10-20T15:59:00.000Z',
      dueAtRaw: '10月20日 23:59',
    })

    expect(created).not.toBeNull()
    expect(created?.title).toBe('作业 3')
    expect(created?.courseName).toBe('CS101')
    expect(created?.source).toBe('manual')
    expect(created?.submitted).toBe(false)
    expect(created?.id.startsWith('ddl-manual-')).toBe(true)
    expect(store.writes).toHaveLength(1)
    expect(useCase.getSnapshot().items).toHaveLength(1)
  })

  it('同一条 DDL 加两次是覆盖而不是两条（否则汇总数字会翻倍）', () => {
    const store = createStore()
    const useCase = createDeadlineBoardUseCase({ store })
    const input = {
      title: '作业 3',
      courseName: 'CS101',
      dueAt: '2026-10-20T15:59:00.000Z',
      dueAtRaw: '10月20日 23:59',
    }

    const first = useCase.add(input)
    const second = useCase.add(input)

    expect(first?.id).toBe(second?.id)
    expect(useCase.getSnapshot().items).toHaveLength(1)
  })

  it('标题/课程为空或时间不可解析时不写入（页面给表单提示）', () => {
    const store = createStore()
    const useCase = createDeadlineBoardUseCase({ store })
    const base = {
      title: '作业',
      courseName: 'CS101',
      dueAt: '2026-10-20T15:59:00.000Z',
      dueAtRaw: '10月20日 23:59',
    }

    expect(useCase.add({ ...base, title: '   ' })).toBeNull()
    expect(useCase.add({ ...base, courseName: '' })).toBeNull()
    expect(useCase.add({ ...base, dueAt: '10月20日 23:59' })).toBeNull()
    expect(store.writes).toHaveLength(0)
  })

  it('标记已交 / 删除 / 清空都会立刻写回本机', () => {
    const store = createStore([item({ id: 'a', dueAt: '2026-10-20T15:59:00.000Z' })])
    const useCase = createDeadlineBoardUseCase({ store })
    useCase.hydrate()

    useCase.toggleSubmitted('a')
    expect(store.writes.at(-1)?.[0]?.submitted).toBe(true)

    useCase.toggleSubmitted('a')
    expect(store.writes.at(-1)?.[0]?.submitted).toBe(false)

    useCase.remove('a')
    expect(useCase.getSnapshot().items).toEqual([])
    expect(store.writes.at(-1)).toEqual([])

    useCase.clear()
    expect(store.cleared).toBe(1)
    expect(useCase.getSnapshot()).toEqual({ status: 'ready', items: [] })
  })
})
