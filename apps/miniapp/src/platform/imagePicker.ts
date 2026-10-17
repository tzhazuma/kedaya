import { err, ok, type Result } from '@kedaya/shared'
import Taro from '@tarojs/taro'

import {
  IMAGE_QUALITY_LADDER,
  formatBytes,
  imageDataUrlBytes,
  sniffBase64Image,
  type PickImagesResult,
  type PickedImage,
} from '../domain/models/media'
import type { RepositoryError } from '../domain/ports/errors'
import type { ImagePickerPort, PickImagesOptions } from '../domain/ports/mediaPort'
import { isWeapp } from './env'
import { readFileAsBase64 } from './fileSystem'

/**
 * 相册选图 + 逐张压缩（平台实现）。
 *
 * 三个刻意的决定：
 *
 * 1. **压缩在客户端做，剥离 EXIF 在服务端做**。两者不能互相替代：
 *    客户端压缩是为了省流量（一张手机原图 3–8 MB），而 `wx.compressImage`
 *    是否保留 EXIF 由平台决定、且客户端代码可以被抓包绕过 ——
 *    所以 A2.5 要求的「GPS 必须被剥离」只能由服务端保证（见后端 `image-metadata.ts`）。
 *
 * 2. **按魔数判断类型，不信任扩展名**。iOS 的 HEIC、微信改名过的文件都可能带
 *    误导性的后缀。这里解出 base64 的头几个字节自己判；判不出来就明确跳过，
 *    并给出「请先转成 JPG/PNG」这种用户能照做的提示 —— 而不是让它白传一趟
 *    换来服务端一句「只支持 JPG/PNG」。
 *
 * 3. **一张失败不影响其它张**（`skipped` 语义）。见 `PickImagesResult` 的注释。
 *
 * 压缩策略与头像一致的思路：质量梯度 80 → 60 → 40，第一个装进上限的胜出。
 * 注意 `compressImage` 对 PNG 的 `quality` 无效（微信只在 jpg 上生效），
 * 因此超大 PNG 会被如实跳过，而不是反复重试同一个结果。
 */

const UNSUPPORTED: RepositoryError = {
  code: 'UNKNOWN',
  message: '相册选图需要在微信小程序内使用',
}

/** 一次最多允许用户勾选几张 —— 与后端 `MEDIA_MAX_COUNT` 同量级，避免选 50 张再逐张拒 */
const MAX_PICK_AT_ONCE = 9

export function createImagePickerPort(): ImagePickerPort {
  return {
    isAvailable: () => isWeapp(),

    async pickImages(options: PickImagesOptions): Promise<Result<PickImagesResult, RepositoryError>> {
      if (!isWeapp()) return err(UNSUPPORTED)

      const wanted = Math.max(0, Math.min(options.count, MAX_PICK_AT_ONCE))
      if (wanted === 0) {
        return ok({ accepted: [], skipped: ['最多只能再添加 0 张图片'] })
      }

      let tempFiles: { tempFilePath: string; width?: number; height?: number }[]
      try {
        const picked = await Taro.chooseMedia({
          count: wanted,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          // 'compressed'：让微信先粗压一遍，我们再按质量梯度精压，省内存
          sizeType: ['compressed'],
        })
        tempFiles = (picked.tempFiles ?? []).map((file) => ({
          tempFilePath: file.tempFilePath,
          ...(file.width === undefined ? {} : { width: file.width }),
          ...(file.height === undefined ? {} : { height: file.height }),
        }))
      } catch (error) {
        // 用户取消不算错误：返回空结果，页面不做任何提示
        const message = error instanceof Error ? error.message : String(error ?? '')
        if (/cancel|取消/i.test(message)) return ok({ accepted: [], skipped: [] })
        return err({ code: 'UNKNOWN', message: `打开相册失败：${message || '请稍后重试'}` })
      }

      const accepted: PickedImage[] = []
      const skipped: string[] = []

      for (const [index, file] of tempFiles.entries()) {
        const label = `第 ${index + 1} 张`
        const result = await compressOne(file.tempFilePath, options.maxBytes)
        if (result.ok) {
          accepted.push({
            ...result.value,
            width: file.width ?? null,
            height: file.height ?? null,
          })
        } else {
          skipped.push(`${label}：${result.error}`)
        }
      }

      return ok({ accepted, skipped })
    },
  }
}

/** 逐级降质，直到装进 `maxBytes`（或质量已到底） */
async function compressOne(
  tempFilePath: string,
  maxBytes: number,
): Promise<Result<PickedImage, string>> {
  let smallest = Number.POSITIVE_INFINITY

  for (const quality of IMAGE_QUALITY_LADDER) {
    let compressedPath: string
    try {
      const compressed = await Taro.compressImage({ src: tempFilePath, quality })
      compressedPath = compressed.tempFilePath
    } catch (error) {
      const message = error instanceof Error ? error.message : '压缩失败'
      return err(`图片处理失败（${message}）`)
    }

    let payload: string
    try {
      payload = await readFileAsBase64(compressedPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取失败'
      return err(`图片读取失败（${message}）`)
    }

    const bytes = imageDataUrlBytes(`data:image/jpeg;base64,${payload}`)
    smallest = Math.min(smallest, bytes)

    if (bytes > maxBytes) continue

    const mime = sniffBase64Image(payload)
    if (mime === null) return err('暂不支持这种图片格式，请先转成 JPG 或 PNG')

    return ok({ dataUrl: `data:${mime};base64,${payload}`, bytes, width: null, height: null })
  }

  // 质量到底仍然超标：如实说明当前多大、上限多少，用户才知道该怎么做
  return err(
    `压缩后仍有 ${formatBytes(smallest === Number.POSITIVE_INFINITY ? 0 : smallest)}，` +
      `超过单张上限 ${formatBytes(maxBytes)}`,
  )
}
