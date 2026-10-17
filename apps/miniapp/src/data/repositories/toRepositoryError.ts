import type { ApiError } from '@kedaya/contracts'

import type { RepositoryError } from '../../domain/ports/errors'

/**
 * 契约 `ApiError` → 领域 `RepositoryError`。
 *
 * 两者形状几乎一致，唯一区别是领域层允许 `NETWORK` / `TIMEOUT` / `UNKNOWN`
 * 三个纯前端错误码。这里做一次显式映射，避免各 repository 各写一份。
 */
export function toRepositoryError(error: ApiError, traceId?: string): RepositoryError {
  return {
    code: error.code,
    message: error.message,
    ...(traceId === undefined ? {} : { traceId }),
    ...(error.details === undefined ? {} : { details: error.details }),
  }
}
