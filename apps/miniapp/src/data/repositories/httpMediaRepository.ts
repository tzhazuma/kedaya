import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { MediaCapabilities, UploadedImage } from '../../domain/models/media'
import type { RepositoryError } from '../../domain/ports/errors'
import type { MediaRepository } from '../../domain/ports/mediaRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端媒体仓储。
 *
 * 上传走 base64 JSON（不是 multipart）—— 与后端 `MediaController` 的取舍一致，
 * 也让这条链路与既有头像链路共用同一套客户端处理。
 */
export function createHttpMediaRepository(client: ApiClient): MediaRepository {
  return {
    async capabilities(): Promise<Result<MediaCapabilities, RepositoryError>> {
      const result = await client.get<MediaCapabilities>(modulePath('media', 'config'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async upload(dataUrl: string): Promise<Result<UploadedImage, RepositoryError>> {
      const result = await client.post<UploadedImage, { dataUrl: string }>(
        modulePath('media', 'images'),
        { dataUrl },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async remove(key: string): Promise<Result<{ key: string }, RepositoryError>> {
      const result = await client.del<{ key: string; deleted: true }>(
        modulePath('media', 'images'),
        { query: { key } },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ key: result.value.key })
    },
  }
}
