import type { Result } from '@kedaya/shared'

import type { PickImagesResult, PickedImage, MediaCapabilities, UploadedImage } from '../models/media'
import type { RepositoryError } from './errors'

/**
 * 本地头像选择端口 —— application 只依赖本接口，实现见 `platform/avatarPicker.ts`。
 *
 * 微信侧的现状（2022-10 之后）：
 *   `getUserInfo` 已不再返回真实昵称与头像，官方推荐 `<button open-type="chooseAvatar">`
 *   + `<input type="nickname">`。`chooseAvatar` 回调给的是**临时文件路径**
 *   （`wxfile://` / `http://tmp/...`），会随小程序重启失效 —— 必须转成可持久化的形式。
 *
 * 头像继续走 data URL（后端限 64 KB，只有一张、只属于本人）。
 * 内容图片（闲置 / 失物 / 帖子）**不走**这条路 —— 见下面的 `ImagePickerPort`。
 */

export interface PickedAvatar {
  /** `data:image/jpeg;base64,...` */
  dataUrl: string
  /** 解码后的字节数（用于 UI 提示） */
  bytes: number
}

export interface AvatarPickerPort {
  /** 当前端是否支持从本地选择头像（微信小程序内为 true；H5 无此能力） */
  isAvailable(): boolean
  /** 把 `chooseAvatar` 拿到的临时文件压缩成 ≤64KB 的 data URL */
  readAsDataUrl(tempFilePath: string): Promise<Result<PickedAvatar, RepositoryError>>
}

/**
 * 相册选图端口（平台实现见 `platform/imagePicker.ts`）。
 *
 * 与头像选择分开的理由：
 *   · 头像走系统专用入口（`open-type="chooseAvatar"`，一次一张、400 KB 以内）；
 *   · 内容图要走相册多选 + 逐张压缩到几百 KB，且**必须**在服务端再剥离一次 EXIF
 *     （客户端压缩只是"顺手"，不可信 —— 契约 A2.5）。
 */
export interface ImagePickerPort {
  /** 当前端是否支持相册选图（微信小程序内为 true） */
  isAvailable(): boolean
  pickImages(options: PickImagesOptions): Promise<Result<PickImagesResult, RepositoryError>>
}

export interface PickImagesOptions {
  /** 这次最多还能选几张（= 上限 - 已选） */
  count: number
  /** 单张上限（字节）。来自服务端 `GET /media/config`，避免"白传一趟再被拒" */
  maxBytes: number
}

export type { MediaCapabilities, PickedImage, UploadedImage }
