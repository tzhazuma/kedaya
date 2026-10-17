import { API_BASE_PATH, TRACE_HEADER, toResult } from '@kedaya/contracts'
import type { ApiError } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { isAuthTokens } from '../../domain/models/session'
import type { AuthTokens } from '../../domain/models/session'
import type { HttpPort } from '../../domain/ports/httpPort'
import type { AuthRefresherPort } from '../../domain/ports/sessionPort'
import type { TracePort } from '../../domain/ports/tracePort'
import { parseEnvelope, transportErrorToApiError } from './request'

/**
 * access token 刷新（契约 §6.1：`POST /api/v1/auth/refresh`）。
 *
 * 刻意**不**复用 `ApiClient`：刷新请求本身不能再走「401 自动刷新重试」，
 * 否则 `ApiClient ↔ AuthRefresher` 形成循环依赖。
 */
export interface AuthRefresherOptions {
  baseUrl: string
  http: HttpPort
  trace: TracePort
  timeoutMs?: number
}

export function createAuthRefresher(options: AuthRefresherOptions): AuthRefresherPort {
  const { baseUrl, http, trace, timeoutMs = 10_000 } = options

  return {
    async refresh(refreshToken: string): Promise<Result<AuthTokens, ApiError>> {
      const traceId = trace.next()
      try {
        const response = await http.send({
          url: `${baseUrl.replace(/\/+$/, '')}${API_BASE_PATH}/auth/refresh`,
          method: 'POST',
          headers: {
            [TRACE_HEADER]: traceId,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: { refreshToken },
          timeoutMs,
        })

        const result = toResult(parseEnvelope<unknown>(response.data, traceId))
        if (!result.ok) return err(result.error)
        const data = result.value as { accessToken?: unknown; expiresIn?: unknown } | null
        if (data && typeof data.accessToken === 'string' && typeof data.expiresIn === 'number' && data.expiresIn > 0) {
          return ok({ accessToken: data.accessToken, refreshToken, expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString() })
        }
        if (!isAuthTokens(result.value)) {
          return err({ code: 'INTERNAL', message: '刷新接口返回的 token 形状不合法' })
        }
        return ok(result.value)
      } catch (error) {
        return err(transportErrorToApiError(error))
      }
    },
  }
}
