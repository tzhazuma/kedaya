import type { Result } from '@kedaya/shared'

import type { RepositoryError } from './errors'

/**
 * 本地头像选择端口 —— application 只依赖本接口，实现见 `platform/avatarPicker.ts`。
 *
 * 微信侧的现状（2022-10 之后）：
 *   `getUserInfo` 已不再返回真实昵称与头像，官方推荐 `<button open-type="chooseAvatar">`
 *   + `<input type="nickname">`。`chooseAvatar` 回调给的是**临时文件路径**
 *   （`wxfile://` / `http://tmp/...`），会随小程序重启失效 —— 必须转成可持久化的形式。
 *
 * 当前里程碑没有对象存储，因此这里把图片压缩后转成 base64 data URL
 * 交给后端存进 `User.avatarUrl`（后端限 64 KB，见 `domain/models/profile.ts`）。
 * 接入 OSS 后只需把 `readAsDataUrl` 换成「上传并返回 URL」，页面无需改动。
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
