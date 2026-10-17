import { useCallback, useEffect, useState } from 'react'

import { getContainer } from '../../app/container'
import type { ReportTargetType } from '../../domain/models/report'

/**
 * 「举报入口」的页面状态（五个详情页共用）。
 *
 * 抽成 hook 的理由和 `useImageAttachments` 一样：五处各写一遍，
 * 必然有一处忘记处理"已经举报过"或忘记在提交后更新文案 ——
 * 而举报是合规能力，缺失/错乱的那一处正好就是提审被驳回的理由。
 *
 * 两个产品决定：
 *   1. **进页面就查一次是否已举报**（走用例层缓存，不会每页发一次请求）：
 *      让用户知道自己的举报还在处理中，而不是打开一次就想"我上次举报没成功？"；
 *   2. **提交成功后立刻改文案**，不等下一次进页面再变。
 */
export interface ReportEntryView {
  /** 我是否已经举报过这条内容 */
  reported: boolean
  /** 弹层是否打开 */
  open: boolean
  openSheet: () => void
  closeSheet: () => void
  /** 由弹层在提交成功时调用 */
  markSubmitted: () => void
}

export function useReportEntry(targetType: ReportTargetType, targetId: string): ReportEntryView {
  const [reported, setReported] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getContainer()
      .useCases.report.hasReported(targetType, targetId)
      .then((value) => {
        if (!cancelled) setReported(value)
      })
      .catch(() => {
        /* 查询失败就当作没举报过：真正的去重由服务端唯一索引把关 */
      })
    return () => {
      cancelled = true
    }
  }, [targetType, targetId])

  const openSheet = useCallback(() => {
    setOpen(true)
  }, [])

  const closeSheet = useCallback(() => {
    setOpen(false)
  }, [])

  const markSubmitted = useCallback(() => {
    setReported(true)
  }, [])

  return { reported, open, openSheet, closeSheet, markSubmitted }
}
