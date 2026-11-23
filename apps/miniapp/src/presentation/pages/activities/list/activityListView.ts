import {
  ACTIVITY_TABS,
  ACTIVITY_TAB_LABELS,
  activitySourceMatches,
  activityTabMatches,
  buildActivityTabCounts,
  sortActivities,
  type ActivitySourceFilter,
  type ActivityTab,
  type ActivityView,
} from '../../../../domain/models/activity'

/**
 * 活动列表的**页面视图模型**（纯函数，不 import Taro）。
 *
 * 列表一次拿到全部条目，tab 与来源筛选都在客户端即时完成 ——
 * 切 tab 不必等网络，也不会因为服务端分页把「今天」拆到第二页。
 *
 * 空态文案按「为什么空」分三种：完全没有数据 / 这个来源没有 / 这个 tab 没有。
 * 只写一句「暂无数据」会让用户不知道该去导入、换来源，还是去确认候选。
 */

export interface ActivityListFilters {
  tab: ActivityTab
  source: ActivitySourceFilter
}

export interface ActivityListView {
  tab: ActivityTab
  source: ActivitySourceFilter
  counts: Record<ActivityTab, number>
  rows: ActivityView[]
  emptyTitle: string
  emptyDescription: string
}

const TAB_EMPTY_COPY: Readonly<Record<ActivityTab, { title: string; description: string }>> = {
  pending: {
    title: '没有待确认的活动',
    description: '新的公众号文章或校园邮件会先出现在这里，确认后才进日程。',
  },
  today: {
    title: '今天没有已加入日程的活动',
    description: '待确认的活动确认后会出现在这里。',
  },
  week: {
    title: '本周没有已加入日程的活动',
    description: '待确认的活动确认后会出现在这里。',
  },
  all: {
    title: '还没有活动',
    description: '从公众号导入一篇，或到「校园邮箱」同步最近的邮件。',
  },
}

export function buildActivityListView(
  items: readonly ActivityView[],
  filters: ActivityListFilters,
  now: Date,
): ActivityListView {
  const counts = buildActivityTabCounts(items, now)
  const matched = items.filter(
    (item) => activityTabMatches(item, filters.tab, now) && activitySourceMatches(item, filters.source),
  )
  const rows = sortActivities(matched, filters.tab)

  const copy = TAB_EMPTY_COPY[filters.tab]
  const emptyTitle =
    rows.length === 0 && filters.source !== 'all'
      ? `这个来源下${ACTIVITY_TAB_LABELS[filters.tab]}没有活动`
      : copy.title
  const emptyDescription =
    rows.length === 0 && filters.source !== 'all'
      ? '换一个来源看看，或导入新的活动。'
      : copy.description

  return {
    tab: filters.tab,
    source: filters.source,
    counts,
    rows,
    emptyTitle,
    emptyDescription,
  }
}

/** tab 顺序（页面渲染用，避免每页自己排一遍） */
export const ACTIVITY_TAB_ORDER = ACTIVITY_TABS
