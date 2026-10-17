/**
 * 站内信（`notifications`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 站内信与其它模块最大的不同：**它是"别人替我写的"内容**。
 * 因此这里做的三件事都不能省：
 *   1. `link` 必须当成**外部输入**对待 —— 只有能匹配到本地已知页面时才可点击，
 *      否则一律当"不可点"。绝不能直接 `navigateTo` 一个服务端给的字符串：
 *      服务端版本升级、路径改名、数据被写脏，都会让用户点进白屏页（微信不报错）。
 *   2. 已读/未读是唯一的状态位，UI 的"标为已读 / 全部已读"都走它；
 *   3. 时间一律走 `formatRelativeTime`，不在这里自己拼"几分钟前"。
 */

import { formatRelativeTime } from '@kedaya/shared'

/** 服务端登记的来源白名单（与后端 `NOTIFICATION_SOURCES` 一一对应） */
export const NOTIFICATION_SOURCES = [
  'system',
  'groupbuy',
  'errand',
  'flea-market',
  'forum',
  'campus-card',
  'schedule',
] as const

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number]

/** 后端返回的原始行（字段名与 API 视图一致，不做改名映射） */
export interface NotificationItem {
  id: string
  title: string
  body: string
  source: string
  /** 服务端下发的小程序页面路径（可能带查询串）；null 表示这条通知没有可跳转目标 */
  link: string | null
  readAt: string | null
  createdAt: string
}

/** 卡片直接可读的派生摘要 —— UI 只读这个，不在组件里重复计算 */
export interface NotificationSummary {
  id: string
  title: string
  body: string
  source: NotificationSource
  sourceLabel: string
  unread: boolean
  timeLabel: string
  /**
   * 可跳转的页面路径。
   *
   * `null` 有两层含义，UI 都必须当成"不可点"处理（不要假装可点、更不要 toast 报错）：
   *   · 服务端明确没给 link；
   *   · 给了 link，但不是已知的小程序页面（版本漂移/脏数据）。
   */
  link: string | null
}

const SOURCE_LABELS: Readonly<Record<NotificationSource, string>> = {
  system: '系统',
  groupbuy: '拼单',
  errand: '跑腿',
  'flea-market': '跳蚤',
  forum: '论坛',
  'campus-card': '校园卡',
  schedule: '课表',
}

export function isNotificationSource(value: unknown): value is NotificationSource {
  return typeof value === 'string' && (NOTIFICATION_SOURCES as readonly string[]).includes(value)
}

/** 来源标签。未登记的来源（服务端新增而小程序还没跟上）降级成"通知"，不抛错。 */
export function sourceLabel(source: string): string {
  return isNotificationSource(source) ? SOURCE_LABELS[source] : '通知'
}

/**
 * 判定 link 是否是一个**已知的**小程序页面路径。
 *
 * `knownPaths` 由装配层传入 `Object.values(PAGE_PATHS)` —— domain 不 import
 * `app/routes`（那会把应用层常量带进领域层，也会让 domain 依赖构建期配置）。
 */
export function resolveLink(link: string | null, knownPaths: readonly string[]): string | null {
  if (link === null || link.length === 0) return null
  const [base] = link.split('?')
  if (base === undefined || !knownPaths.includes(base)) return null
  return link
}

export function summarizeNotification(
  item: NotificationItem,
  now: Date,
  knownPaths: readonly string[],
): NotificationSummary {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    source: isNotificationSource(item.source) ? item.source : 'system',
    sourceLabel: sourceLabel(item.source),
    unread: item.readAt === null,
    timeLabel: formatRelativeTime(item.createdAt, now),
    link: resolveLink(item.link, knownPaths),
  }
}
