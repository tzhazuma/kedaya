import Taro from '@tarojs/taro'

import { HttpTransportError } from '../../domain/ports/httpPort'
import type { HttpPort, HttpRequest, HttpResponse } from '../../domain/ports/httpPort'

/**
 * `Taro.request` 适配器 —— 全项目**唯一**直接调用 Taro 网络 API 的地方。
 *
 * 平台差异：
 * - weapp：底层是 `wx.request`，**必须**在微信公众平台配置 request 合法域名（https）。
 * - H5：底层是 `fetch`/XHR，受浏览器 CORS 限制。
 * 两者对上层完全透明。
 */

type TaroRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD'

function normalizeHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = String(value)
  }
  return out
}

export function createTaroHttpPort(): HttpPort {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      try {
        const response = await Taro.request({
          url: request.url,
          method: request.method as TaroRequestMethod,
          header: request.headers,
          data: request.body as Record<string, unknown> | undefined,
          timeout: request.timeoutMs,
          dataType: 'json',
        })

        return {
          statusCode: response.statusCode,
          data: response.data,
          headers: normalizeHeaders(response.header),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const kind = /timeout|超时/i.test(message) ? 'timeout' : 'network'
        throw new HttpTransportError(kind, message, error)
      }
    },
  }
}
