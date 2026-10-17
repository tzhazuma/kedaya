import { dataUrlBytes } from './profile'

/**
 * 内容图片（闲置 / 失物 / 帖子）的领域规则 —— 纯 TypeScript，零框架依赖。
 *
 * 与后端 `services/api/src/common/media/*` **必须一致**：
 *   · 单条内容最多 9 张（后端 `MAX_IMAGES_PER_ITEM`）；
 *   · 单张不超过 2 MB（后端 `MEDIA_MAX_BYTES` 默认值）。
 * 客户端的这些数字只用于**即时提示与压缩前拦截**，服务端才是最终裁决。
 */

/** 单条内容最多几张图（与后端 `MAX_IMAGES_PER_ITEM` 对齐） */
export const MAX_IMAGES_PER_ITEM = 9

/** 单张图片默认上限（字节，与后端 `MEDIA_MAX_BYTES` 默认值对齐） */
export const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** 压缩质量梯度：先保证清晰度，超限再逐级降质（与头像压缩同一套思路） */
export const IMAGE_QUALITY_LADDER: readonly number[] = [80, 60, 40]

/** `data:image/jpeg;base64,...` 载荷的字节数（复用头像那套算法，避免两处实现漂移） */
export function imageDataUrlBytes(dataUrl: string): number {
  return dataUrlBytes(dataUrl)
}

/** `1536 KB` → `1.5 MB`；用于「图片太大」类提示，避免用户看到 6 位数字 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 已选 N 张 / 上限 M 张 */
export function imageCountLabel(count: number, max: number = MAX_IMAGES_PER_ITEM): string {
  return `${count}/${max}`
}

/** 从 data URL 里取 MIME（拿不到时按 jpeg 处理） */
export function dataUrlMime(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl)
  return match?.[1] ?? 'image/jpeg'
}

/* ------------------------------------------------------------------ *
 * 图片类型嗅探（不信任扩展名 / MIME 声明）
 * ------------------------------------------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 只解出载荷头部的前几个字节。
 *
 * 为什么不用 `Buffer.from(payload, 'base64')`：**小程序运行时没有 Node 的 Buffer**
 * （那是构建期的东西）。这里手写一个"只解前 N 字节"的小解码器 ——
 * 既避开了运行时缺失的全局对象，也避免为了看 12 个字节把整张图解进内存。
 */
function decodeBase64Head(payload: string, maxBytes: number): number[] {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const char of payload) {
    if (char === '=') break
    const value = BASE64_ALPHABET.indexOf(char)
    if (value < 0) return [] // 非法字符：调用方按"认不出来"处理
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      if (bytes.length >= maxBytes) break
    }
  }
  return bytes
}

/**
 * 按魔数判断 base64 载荷的真实类型。
 *
 * 与后端 `sniffImageType` 同源（JPEG 的 `FF D8`、PNG 的 8 字节签名）——
 * 前端先判一次只是为了**少传一趟**、把错误提示说清楚；真正的裁决仍在服务端。
 */
export function sniffBase64Image(payload: string): 'image/jpeg' | 'image/png' | null {
  const bytes = decodeBase64Head(payload, 12)
  if (bytes.length < 3) return null

  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }
  return null
}

/** 服务端返回的图片地址是否是可渲染的绝对地址（mock 模式返回 data URL 也算） */
export function isRenderableImageUrl(url: string): boolean {
  return /^(https?:)?\/\//i.test(url) || url.startsWith('data:image/')
}

/**
 * 把一串图片地址压成列表卡片需要的两个字段。
 *
 * 抽出来的理由：跳蚤 / 失物 / 论坛三个 `summarize()` 都要算「有没有图」「第一张是啥」，
 * 三处各写一遍 `urls[0] ?? null` 必然会有一处忘了处理 `undefined`（老数据没有该字段）。
 */
export function imageSummary(urls: readonly string[] | undefined | null): {
  /** 列表缩略图用的第一张（没有图时为 null） */
  thumbnailUrl: string | null
  imageCount: number
} {
  const list = urls ?? []
  return { thumbnailUrl: list[0] ?? null, imageCount: list.length }
}

/* ------------------------------------------------------------------ *
 * 类型：与后端 media 端点一一对应
 * ------------------------------------------------------------------ */
/** 服务端下发的媒体能力（`GET /media/config`） */
export interface MediaCapabilities {
  /** false = 服务端**没有配置对象存储**，客户端必须隐藏选图入口 */
  enabled: boolean
  kind: string
  maxBytes: number
  maxCount: number
  accept: readonly string[]
}

/** 上传成功后的图片 */
export interface UploadedImage {
  /** 服务端生成的对象 key（删除时用它） */
  key: string
  /** 可直接给 `<Image src>` 用的地址 */
  url: string
  bytes: number
  width: number | null
  height: number | null
}

/** 相册选出来、已压缩的一张图（尚未上传） */
export interface PickedImage {
  /** `data:image/jpeg;base64,...` —— 已按上限压缩过 */
  dataUrl: string
  /** 压缩后的字节数 */
  bytes: number
  /** 宽高（拿不到时为 null，仅用于提示） */
  width: number | null
  height: number | null
}

/**
 * 选图结果。
 *
 * `skipped` 而不是整体失败：用户一次选了 5 张、其中 1 张是 HEIC 时，
 * 正确的做法是「收下 4 张 + 明确告知 1 张为什么没收」，
 * 而不是把 5 张一起退回去让用户自己猜。
 */
export interface PickImagesResult {
  accepted: PickedImage[]
  /** 被跳过的原因（已按人话组织好，页面直接 toast / 列表展示） */
  skipped: string[]
}
