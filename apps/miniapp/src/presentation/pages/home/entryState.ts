import { getModule } from '@kedaya/contracts'

import { homeEntryPath } from '../../../app/routes'
import type { HomeEntry } from '../../../domain/models/homeEntries'
import type { KdyTagTone } from '../../components'

/**
 * 入口的**状态角标** —— 首页宫格与服务大厅共用一份（两页各写一遍必然漂移：
 * 首页说「已上线」、服务大厅说「开发中」，用户只会觉得整个应用不可信）。
 *
 * 一条纪律：**没有问题就不挂角标**。全部入口都挂着「已上线」等于没有角标，
 * 还会把真正需要注意的两类（需二次同意 / 高敏感）淹掉。
 * 因此只有下面三种情况才返回标签，其余返回 `null`（不渲染）。
 */
export interface EntryState {
  /** 需要提示时的角标文案；无需提示时为 `null` */
  label: string | null
  tone: KdyTagTone
  /** 有没有落地页；`false` 时点击要如实说明「开发中」 */
  available: boolean
}

export function homeEntryState(entry: HomeEntry): EntryState {
  if (homeEntryPath(entry.id) === null) {
    return { label: '开发中', tone: 'neutral', available: false }
  }

  const modules = entry.moduleIds
    .map((id) => getModule(id))
    .filter((module) => module !== undefined)

  // 二次同意排在前面：它同时是"点进去会先看到同意门"的预告
  if (modules.some((module) => module.requiresConsent)) {
    return { label: '需二次同意', tone: 'danger', available: true }
  }
  if (modules.some((module) => module.sensitivity === 'high' || module.sensitivity === 'critical')) {
    return { label: '高敏感', tone: 'warning', available: true }
  }
  return { label: null, tone: 'neutral', available: true }
}
