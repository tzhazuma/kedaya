import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { CardLostReport, CardOverview } from '../../domain/models/campusCard'
import type { RepositoryError } from '../../domain/ports/errors'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/** 真后端校园卡仓储 */
export function createHttpCampusCardRepository(client: ApiClient): CampusCardRepository {
  const base = modulePath('campus-card')

  return {
    async overview(thresholdFen?: number): Promise<Result<CardOverview, RepositoryError>> {
      const result = await client.get<CardOverview>(`${base}/overview`, { thresholdFen })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async lostReport(reason?: string): Promise<Result<CardLostReport, RepositoryError>> {
      const result = await client.get<CardLostReport>(`${base}/lost-report`, { reason })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
