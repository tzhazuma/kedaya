import { err, ok } from '@kedaya/shared'
import Taro from '@tarojs/taro'

import { AVATAR_MAX_BYTES, dataUrlBytes } from '../domain/models/profile'
import type { RepositoryError } from '../domain/ports/errors'
import type { AvatarPickerPort, PickedAvatar } from '../domain/ports/mediaPort'
import { isWeapp } from './env'
import { readFileAsBase64 } from './fileSystem'

/**
 * 头像选择的**平台实现**（微信 `chooseAvatar` → 可持久化的 data URL）。
 *
 * 为什么需要这一层：
 *   `open-type="chooseAvatar"` 回调给的是**临时文件路径**，小程序重启即失效，
 *   直接存库等于存了个死链。这里做三件事：
 *     1. `compressImage` 逐级降质（70 → 50 → 30），直到装进 64 KB；
 *     2. `FileSystemManager.readFile(encoding: 'base64')` 转成 data URL；
 *     3. 仍超标就明确失败（而不是把一张 500 KB 的图塞进身份表）。
 *
 * 当前里程碑没有对象存储，所以用 data URL 顶一下；接 OSS 后把本文件换成
 * 「上传并返回 https URL」即可，端口契约（`AvatarPickerPort`）不变。
 */

/** 压缩质量梯度：先保证清晰度，超限再降 */
const QUALITY_LADDER = [70, 50, 30] as const

const UNSUPPORTED: RepositoryError = {
  code: 'UNKNOWN',
  message: '头像选择需要在微信小程序内使用',
}

function readBase64(filePath: string): Promise<string> {
  return readFileAsBase64(filePath)
}

export function createAvatarPickerPort(): AvatarPickerPort {
  return {
    isAvailable: () => isWeapp(),

    async readAsDataUrl(tempFilePath) {
      if (!isWeapp()) return err(UNSUPPORTED)
      if (typeof tempFilePath !== 'string' || tempFilePath.length === 0) {
        return err({ code: 'VALIDATION_FAILED', message: '没有拿到可用的图片' })
      }

      let last: PickedAvatar | null = null
      for (const quality of QUALITY_LADDER) {
        let compressedPath: string
        try {
          const compressed = await Taro.compressImage({ src: tempFilePath, quality })
          compressedPath = compressed.tempFilePath
        } catch (error) {
          const message = error instanceof Error ? error.message : '图片处理失败'
          return err({ code: 'UNKNOWN', message: `头像处理失败：${message}` })
        }

        try {
          const base64 = await readBase64(compressedPath)
          const dataUrl = `data:image/jpeg;base64,${base64}`
          const bytes = dataUrlBytes(dataUrl)
          last = { dataUrl, bytes }
          if (bytes <= AVATAR_MAX_BYTES) return ok(last)
        } catch (error) {
          const message = error instanceof Error ? error.message : '读取图片失败'
          return err({ code: 'UNKNOWN', message: `头像读取失败：${message}` })
        }
      }

      return err({
        code: 'VALIDATION_FAILED',
        message: `头像压缩后仍有 ${Math.round((last?.bytes ?? 0) / 1024)} KB，超过 64 KB，请换一张更小的图片`,
      })
    },
  }
}
