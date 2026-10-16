import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import {
  WILDLIFE_COMPRESS_MAX_BYTES,
  WILDLIFE_COMPRESS_MAX_EDGE_PX,
  WILDLIFE_COMPRESS_QUALITY,
  WILDLIFE_MAX_PHOTOS,
} from '../domain/models/wildlife'
import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 选择并压缩照片（规格 §4.2）。
 *
 * - **微信小程序**：`wx.chooseMedia`（**不用**已废弃的 `wx.chooseImage`），
 *   `mediaType: ['image']`、`sizeType: ['compressed']`（让微信先压一次）、
 *   `sourceType: ['album', 'camera']`（允许拍照）。
 *   若任一边 > 2048px 或 > 2MB，再用 `wx.compressImage({ quality: 80 })` 压一次。
 * - **H5 降级**：`chooseMedia` 是微信专有能力 → 返回 `UNSUPPORTED`，
 *   由 UI 提示「请在微信小程序内上报」。H5 端本期不做相册选图。
 *
 * ⚠️ 压缩是**降低上传失败率**的手段，**不是**隐私手段。
 * EXIF（含 GPS）的剥离由**服务端**强制完成（规格 §4.3）——
 * 客户端压缩后 EXIF 可能仍在，因此绝不能把「已压缩」当作「已脱敏」。
 *
 * ⚠️ 本文件是**平台适配层**：它只负责拿到本地文件与尺寸，
 * `clientPhotoId`（幂等键）由用例层生成并在重试时复用（规格 §4.5）。
 */

/** 客户端选好的照片（尚未生成幂等键、尚未上传） */
export interface PickedPhoto {
  /** 本地临时路径（`tempFilePath`）。重试时**保留**，不重新选图 */
  tempFilePath: string
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
}

export interface ChoosePhotosOptions {
  /** 默认 3（契约 `photoUrls` ≤3） */
  count?: number
}

/** `wx.chooseMedia` 的 `tempFiles[i]` 形状（只声明我们用到的字段） */
interface TaroTempFile {
  tempFilePath?: string
  size?: number
  width?: number
  height?: number
  fileType?: string
}

function normalizeMime(fileType: string | undefined, path: string): string {
  if (fileType === 'image' || fileType === undefined) {
    const lower = path.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    return 'image/jpeg'
  }
  return `image/${fileType}`
}

export async function choosePhotos(
  options: ChoosePhotosOptions = {},
): Promise<PlatformResult<PickedPhoto[]>> {
  if (!isWeapp()) {
    return err({
      code: 'UNSUPPORTED',
      message: '当前端不支持相册选图（wx.chooseMedia 是微信专有能力），请在微信小程序内上报',
    })
  }

  const count = Math.max(1, Math.min(options.count ?? WILDLIFE_MAX_PHOTOS, WILDLIFE_MAX_PHOTOS))

  try {
    const result = await Taro.chooseMedia({
      count,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    })

    const files = (result.tempFiles ?? []) as TaroTempFile[]
    const photos: PickedPhoto[] = []
    for (const file of files) {
      if (file.tempFilePath === undefined) continue
      photos.push({
        tempFilePath: file.tempFilePath,
        widthPx: file.width ?? 0,
        heightPx: file.height ?? 0,
        byteSize: file.size ?? 0,
        mimeType: normalizeMime(file.fileType, file.tempFilePath),
      })
    }

    if (photos.length === 0) {
      return err({ code: 'FAILED', message: '没有选中任何照片' })
    }
    return ok(photos)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 用户主动取消时微信抛出 "chooseMedia:fail cancel"
    if (/cancel/i.test(message)) return err({ code: 'REJECTED', message: '已取消选择照片' })
    return err({ code: 'FAILED', message })
  }
}

/** 是否需要压缩（规格 §4.2 的客户端阈值） */
export function needsCompression(photo: PickedPhoto): boolean {
  const longEdge = Math.max(photo.widthPx, photo.heightPx)
  return longEdge > WILDLIFE_COMPRESS_MAX_EDGE_PX || photo.byteSize > WILDLIFE_COMPRESS_MAX_BYTES
}

/**
 * 按需压缩单张照片。
 *
 * 压缩失败**不阻塞上报** —— 保留原图继续（宁可传大一点，也不要让用户白填一遍表单）。
 * 这与「分类失败降级为手动」是同一种设计取向：增强能力失败不得阻塞主流程。
 */
export async function compressPhoto(photo: PickedPhoto): Promise<PlatformResult<PickedPhoto>> {
  if (!needsCompression(photo)) return ok(photo)
  if (!isWeapp()) return ok(photo)

  try {
    const result = await Taro.compressImage({
      src: photo.tempFilePath,
      quality: WILDLIFE_COMPRESS_QUALITY,
    })
    return ok({
      ...photo,
      tempFilePath: result.tempFilePath,
      // 压缩后尺寸未知（`compressImage` 不返回宽高）→ 保留原值，
      // 真实尺寸以服务端处理结果为准（`POST /media` 会回传 widthPx / heightPx）。
      byteSize: 0,
    })
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '压缩失败，已使用原图',
    })
  }
}

/** 选图 + 按需压缩（UI 直接调用这一个函数即可） */
export async function chooseAndCompressPhotos(
  options: ChoosePhotosOptions = {},
): Promise<PlatformResult<PickedPhoto[]>> {
  const picked = await choosePhotos(options)
  if (!picked.ok) return picked

  const out: PickedPhoto[] = []
  for (const photo of picked.value) {
    const compressed = await compressPhoto(photo)
    // 压缩失败 → 用原图（见 `compressPhoto` 的注释）
    out.push(compressed.ok ? compressed.value : photo)
  }
  return ok(out)
}
