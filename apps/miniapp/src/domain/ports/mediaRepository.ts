import type { Result } from '@kedaya/shared'

import type { MediaCapabilities, UploadedImage } from './mediaPort'
import type { RepositoryError } from './errors'
/**
 * 媒体仓储端口（图片上传）。
 *
 * 端点（与后端 `MediaController` 一一对应）：
 * ```
 * GET    /media/config          能力（公开）：能不能传、多大、几张
 * POST   /media/images          上传一张（需登录），body = { dataUrl }
 * DELETE /media/images?key=...  删除（需登录，幂等）
 * ```
 *
 * 为什么先问 `config` 再显示入口：
 *   对象存储是**部署期**才配置的（`MEDIA_STORAGE=s3` + 一堆密钥）。
 *   如果客户端不问就显示"添加图片"，用户在未配置的部署上点一次失败一次 ——
 *   那是死路。问一次、缓存住，`enabled=false` 就整块不渲染，并说明原因。
 */
export interface MediaRepository {
  /** 读取能力（实现方负责缓存，见 `application/media/mediaUseCases.ts`） */
  capabilities(): Promise<Result<MediaCapabilities, RepositoryError>>
  /** 上传一张 data URL 图片，返回可访问地址 */
  upload(dataUrl: string): Promise<Result<UploadedImage, RepositoryError>>
  /** 删除一张图（幂等；失败也不该阻塞主流程） */
  remove(key: string): Promise<Result<{ key: string }, RepositoryError>>
}
