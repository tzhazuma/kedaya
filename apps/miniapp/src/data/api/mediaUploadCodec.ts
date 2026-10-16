import { err, ok, type Result } from '@kedaya/shared'

import type { WildlifeMedia } from '../../domain/models/wildlife'
import type { RepositoryError } from '../../domain/ports/errors'
import type { UploadMediaInput } from '../../domain/ports/wildlifeRepository'
import { parseEnvelope } from './request'

/**
 * 照片上传的**纯编解码**（不 import Taro）。
 *
 * 为什么单独一个文件：`mediaUpload.ts` 必须 import `@tarojs/taro` 才能调 `wx.uploadFile`，
 * 而 Taro 的运行时在 node 测试环境里加载会直接抛 `ENABLE_INNER_HTML is not defined`。
 * 把「表单字段构造」与「响应解包」这两个**纯函数**挪出来，
 * 它们就能被 Vitest 完整覆盖 —— 而这两件事恰恰是幂等与去重的依据（规格 §4.5）。
 *
 * 依赖方向：本文件只依赖 `domain` 与 `./request`（同样不 import Taro）。
 */

/**
 * 构造 `wx.uploadFile` 的 `formData`。
 *
 * 这些字段是**幂等与去重**的依据（规格 §4.5）：
 * `clientPhotoId` 在重试时必须复用，服务端据此返回**相同**的 `mediaId`。
 *
 * ⚠️ 刻意**不**包含 `tempFilePath` —— 本地路径只用于 `uploadFile` 的 `filePath` 参数，
 * 不应出现在请求体里（那是设备本地信息，与服务端无关）。
 */
export function buildMediaUploadFormData(input: UploadMediaInput): Record<string, string> {
  return {
    clientPhotoId: input.clientPhotoId,
    widthPx: String(input.widthPx),
    heightPx: String(input.heightPx),
    byteSize: String(input.byteSize),
    mimeType: input.mimeType,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 校验并解包上传响应。
 *
 * 只认「形状完整」的 `WildlifeMedia`：缺 `mediaId` 或 `thumbUrl` 一律当失败，
 * 否则 UI 会拿着 `undefined` 去渲染图片。
 *
 * `exifStripped` 未声明时按 **false** 处理 —— 宁可提示「未确认已剥离」，
 * 也不假装安全（规格 §4.3：EXIF 剥离是隐私防线的最后一道）。
 */
export function parseUploadResponse(
  raw: unknown,
  fallbackTraceId: string,
): Result<WildlifeMedia, RepositoryError> {
  const envelope = parseEnvelope<unknown>(raw, fallbackTraceId)
  if (!envelope.ok) {
    return err({
      code: envelope.error.code,
      message: envelope.error.message,
      traceId: envelope.traceId,
      ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }),
    })
  }

  const data = envelope.data
  if (!isRecord(data) || typeof data.mediaId !== 'string' || typeof data.thumbUrl !== 'string') {
    return err({
      code: 'INTERNAL',
      message: '上传响应缺少 mediaId / thumbUrl',
      traceId: envelope.traceId,
      details: data,
    })
  }

  return ok({
    mediaId: data.mediaId,
    thumbUrl: data.thumbUrl,
    exifStripped: data.exifStripped === true,
    widthPx: typeof data.widthPx === 'number' ? data.widthPx : 0,
    heightPx: typeof data.heightPx === 'number' ? data.heightPx : 0,
    byteSize: typeof data.byteSize === 'number' ? data.byteSize : 0,
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'image/jpeg',
    sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
    clientPhotoId: typeof data.clientPhotoId === 'string' ? data.clientPhotoId : '',
  })
}
