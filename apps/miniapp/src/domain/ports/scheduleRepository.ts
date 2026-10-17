import type { Result } from '@kedaya/shared'

import type {
  CreateCourseInput,
  ScheduleSyncResult,
  ScheduleTodayView,
  ScheduleWeekView,
} from '../models/schedule'
import type { RepositoryError } from './errors'

/**
 * 课表仓储端口。
 *
 * 端点（后端 `ScheduleController`）：
 * ```
 * GET  /schedule/today?term=       今日 + 正在上 / 下一节 / 还有几分钟
 * GET  /schedule/week?term=        本周 7 天 + 冲突 + 可切换学期
 * GET  /schedule/next              下一节课（agent / 桌面组件复用）
 * POST /schedule/sync?term=        从教务系统整体同步（未绑定 → CAMPUS_BINDING_REQUIRED）
 * POST /schedule/items             手动加课（老师临时调课时的兜底）
 * ```
 *
 * 高可用：`today` / `week` 的结果会在用例层落本地缓存，
 * 断网时页面仍能显示"上一次看到的课表"并标注时间。
 */
export interface ScheduleRepository {
  today(term?: string): Promise<Result<ScheduleTodayView, RepositoryError>>
  week(term?: string): Promise<Result<ScheduleWeekView, RepositoryError>>
  sync(term?: string): Promise<Result<ScheduleSyncResult, RepositoryError>>
  /** 手动加课（term 由页面从当前视图带入） */
  createCourse(input: CreateCourseInput): Promise<Result<{ id: string }, RepositoryError>>
}
