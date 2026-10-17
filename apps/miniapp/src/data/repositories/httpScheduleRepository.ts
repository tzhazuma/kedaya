import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type {
  CreateCourseInput,
  ScheduleSyncResult,
  ScheduleTodayView,
  ScheduleWeekView,
} from '../../domain/models/schedule'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ScheduleRepository } from '../../domain/ports/scheduleRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/** 真后端课表仓储（端点见 `scheduleRepository.ts` 顶部注释） */
export function createHttpScheduleRepository(client: ApiClient): ScheduleRepository {
  const base = modulePath('schedule')

  return {
    async today(term?: string): Promise<Result<ScheduleTodayView, RepositoryError>> {
      const result = await client.get<ScheduleTodayView>(`${base}/today`, { term })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async week(term?: string): Promise<Result<ScheduleWeekView, RepositoryError>> {
      const result = await client.get<ScheduleWeekView>(`${base}/week`, { term })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async sync(term?: string): Promise<Result<ScheduleSyncResult, RepositoryError>> {
      const result = await client.post<ScheduleSyncResult, Record<string, never>>(
        `${base}/sync`,
        {},
        term === undefined ? undefined : { query: { term } },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async createCourse(input: CreateCourseInput): Promise<Result<{ id: string }, RepositoryError>> {
      const result = await client.post<{ id: string }, CreateCourseInput>(
        // 后端 CRUD 的 create 要求 userId 字段；服务端会用登录主体补全，这里留空字符串即可被覆盖
        `${base}/items`,
        { ...input, userId: '' } as CreateCourseInput & { userId: string },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ id: result.value.id })
    },
  }
}
