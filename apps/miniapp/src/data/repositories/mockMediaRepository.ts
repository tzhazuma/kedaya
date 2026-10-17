import { err, ok, type Result } from '@kedaya/shared'

import type { MediaCapabilities, UploadedImage } from '../../domain/models/media'
import { DEFAULT_MAX_IMAGE_BYTES, MAX_IMAGES_PER_ITEM } from '../../domain/models/media'
import type { RepositoryError } from '../../domain/ports/errors'
import type { MediaRepository } from '../../domain/ports/mediaRepository'

/**
 * mock 媒体仓储 —— 离线演示用。
 *
 * 与真后端**行为契约一致**的关键点：**返回的 `url` 必须能直接渲染**。
 * 真后端返回对象存储的 https 地址；mock 没有对象存储，于是原样返回 data URL
 * （`<Image src>` 接受 data URL）。这样"选图 → 列表/详情看到图"这条链路
 * 在没有后端、没有云存储的情况下**依然成立**，而不是画个假占位图糊弄过去。
 *
 * 三点必要说明：
 *   · mock 明确标注 `kind: 'mock'`，且**不做 EXIF 剥离**（没有服务端）。
 *     因此 mock 只用于演示，真实发布路径必须走服务端（契约 A2.5 的落点在那里）；
 *   · data URL 会进内存 / Taro 存储，所以这里对单张体积更严（默认 2 MB 同后端）；
 *   · key 用「mock- + 时间戳 + 序号」而不是 uuid —— 便于在调试时一眼看出是假数据。
 */
export interface MockMediaRepositoryOptions {
  latencyMs?: number
  /** 单张上限；默认与后端一致 */
  maxBytes?: number
}

export function createMockMediaRepository(
  options: MockMediaRepositoryOptions = {},
): MediaRepository {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES
  let sequence = 0

  return {
    async capabilities(): Promise<Result<MediaCapabilities, RepositoryError>> {
      return ok({
        // mock 恒为 true：演示环境要能把"带图的发布"整条链路走完
        enabled: true,
        kind: 'mock',
        maxBytes,
        maxCount: MAX_IMAGES_PER_ITEM,
        accept: ['image/jpeg', 'image/png'],
      })
    },

    async upload(dataUrl: string): Promise<Result<UploadedImage, RepositoryError>> {
      if (!dataUrl.startsWith('data:image/')) {
        return err({ code: 'VALIDATION_FAILED', message: '只支持 JPG / PNG 图片' })
      }
      sequence += 1
      const key = `mock-${Date.now()}-${sequence}.jpg`
      return ok({
        key,
        // 关键：返回 data URL 本身，保证离线也能真渲染
        url: dataUrl,
        bytes: Math.floor((dataUrl.length * 3) / 4),
        width: null,
        height: null,
      })
    },

    async remove(key: string): Promise<Result<{ key: string }, RepositoryError>> {
      return ok({ key })
    },
  }
}
