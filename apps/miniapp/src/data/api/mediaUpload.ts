import Taro from '@tarojs/taro'
import { AUTH_HEADER, IDEMPOTENCY_HEADER, TRACE_HEADER } from '@kedaya/contracts'
import { err, type Result } from '@kedaya/shared'

import type { WildlifeMedia } from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type { TokenStorePort } from '../../domain/ports/sessionPort'
import type { TracePort } from '../../domain/ports/tracePort'
import type { UploadMediaInput, WildlifeMediaUploaderPort } from '../../domain/ports/wildlifeRepository'
import { buildMediaUploadFormData, parseUploadResponse } from './mediaUploadCodec'
import { buildUrl, parseEnvelope } from './request'

/**
 * 纯编解码（表单字段 / 响应解包）在 `mediaUploadCodec.ts` —— 那个文件不 import Taro，
 * 因此可以被 Vitest（node 环境）完整覆盖。这里再导出一次，方便调用方只 import 一个模块。
 */
export { buildMediaUploadFormData, parseUploadResponse } from './mediaUploadCodec'

/**
 * 照片上传适配器（`POST /api/v1/wildlife/media`，`multipart/form-data`）。
 *
 * 为什么**不能**复用 `ApiClient`：`ApiClient` 只发 JSON
 * （`Content-Type: application/json`，`wx.request` 不支持传文件）。
 * 微信端上传文件必须用 `wx.uploadFile`（Taro 包装为 `Taro.uploadFile`）。
 *
 * 因此本文件是**全项目除 `taroHttpAdapter.ts` 之外唯一**直接调用 Taro 网络 API 的地方，
 * 且**只**用于文件上传。它位于 `data/api/` 内（契约 §7 硬规则 3 允许的网络层），
 * 页面与用例层完全看不到 Taro。
 *
 * 信封解包复用 `request.ts` 的 `parseEnvelope`，语义与其它端点一致
 * （不符合 `ApiEnvelope` 约定的响应一律 `INTERNAL` 失败，绝不放行未校验的数据）。
 *
 * ⚠️ **已知限制（诚实标注）**：本适配器**不做 401 刷新重试**
 * （`ApiClient` 的刷新去重逻辑与 `HttpPort` 耦合，这里没有复用它）。
 * 上传遇到 401 会直接返回 `UNAUTHENTICATED`，由用例层提示用户重新登录后重试。
 * 照片上传是低频、可重试的操作，这个取舍是有意的，不是遗漏。
 *
 * ⚠️ **EXIF 剥离在服务端**（规格 §4.3）：客户端不做、也不能承诺。
 * 只要客户端能绕过就等于没有，因此服务端必须自己断言。
 */

export interface MediaUploaderOptions {
  /** 例如 `https://api.kedaya.example`（不含 `/api/v1`） */
  baseUrl: string
  tokens: TokenStorePort
  trace: TracePort
  timeoutMs?: number
}

export function createTaroMediaUploader(options: MediaUploaderOptions): WildlifeMediaUploaderPort {
  const { baseUrl, tokens, trace, timeoutMs = 30_000 } = options

  return {
    async upload(input: UploadMediaInput): Promise<Result<WildlifeMedia, RepositoryError>> {
      const traceId = trace.next()
      const url = buildUrl(baseUrl, '/wildlife/media')
      const headers: Record<string, string> = {
        [TRACE_HEADER]: traceId,
        Accept: 'application/json',
      }
      const accessToken = tokens.getAccessToken()
      if (accessToken !== null) headers[AUTH_HEADER] = `Bearer ${accessToken}`
      if (input.idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = input.idempotencyKey

      try {
        const response = await Taro.uploadFile({
          url,
          filePath: input.tempFilePath,
          name: 'file',
          header: headers,
          formData: buildMediaUploadFormData(input),
          timeout: timeoutMs,
        })

        // `wx.uploadFile` 的 `data` 是**字符串**，必须自己 parse
        let parsed: unknown = response.data
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch {
            return err({
              code: 'INTERNAL',
              message: '上传响应不是合法 JSON',
              traceId,
            })
          }
        }

        if (response.statusCode >= 400) {
          const envelope = parseEnvelope<unknown>(parsed, traceId)
          if (!envelope.ok) {
            return err({
              code: envelope.error.code,
              message: envelope.error.message,
              traceId,
              ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }),
            })
          }
          return err({ code: 'INTERNAL', message: `上传失败（HTTP ${response.statusCode}）`, traceId })
        }

        return parseUploadResponse(parsed, traceId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isTimeout = /timeout|超时/i.test(message)
        return err({
          code: isTimeout ? 'TIMEOUT' : 'NETWORK',
          message: isTimeout ? '照片上传超时，请重试' : '照片上传失败，请检查网络后重试',
          traceId,
          details: { raw: message },
        })
      }
    },
  }
}
