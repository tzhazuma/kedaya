import type { Result } from '@kedaya/shared'

import type { RepositoryError } from './errors'

/**
 * 客户端事件类型（白名单）。
 *
 * ⚠️ 必须与服务端 `services/api/src/modules/telemetry/domain/telemetry.domain.ts`
 * 的 `CLIENT_EVENT_KINDS` 保持一致 —— 服务端对未知 kind **不报错**（归为 `error`），
 * 所以漂移不会红，只会让分类统计错位。改这里时请一并改服务端。
 */
export type ClientEventKind =
  | 'error'
  | 'unhandled-rejection'
  | 'page-not-found'
  | 'api-failure'
  | 'render-error'

/** 客户端能提供的字段；`route` / `platform` / `appVersion` 由 reporter 补齐 */
export interface ClientEventDraft {
  kind: ClientEventKind
  message: string
  stack?: string
  /** 出错时的页面路径（一般由 reporter 自动填，API 失败时调用方也可以显式给） */
  route?: string
  /** 出错请求的 trace id，用于和后端日志对齐同一次请求（契约 §6.1） */
  traceId?: string
  /** 标量补充信息（会自动脱敏与截断） */
  context?: Record<string, string | number | boolean | null>
}

/** 落到线上的完整载荷 */
export interface ClientEventPayload extends ClientEventDraft {
  platform: string
  appVersion: string
}

export interface TelemetryRepository {
  /**
   * 发送一条事件。
   *
   * 实现**必须**吞掉一切异常并返回 `Result`：
   * 遥测是旁路，任何失败都不该冒泡成用户可见的错误。
   */
  send(payload: ClientEventPayload): Promise<Result<{ accepted: boolean }, RepositoryError>>
}
