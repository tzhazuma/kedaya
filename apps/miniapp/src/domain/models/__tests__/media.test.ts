import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_ITEM,
  dataUrlMime,
  formatBytes,
  imageCountLabel,
  imageDataUrlBytes,
  imageSummary,
  isRenderableImageUrl,
  sniffBase64Image,
} from '../media'

/**
 * 图片领域规则的规格。
 *
 * 重点在 `sniffBase64Image`：它是**客户端唯一一次判断图片真实类型**的地方
 * （不信任扩展名 / MIME 声明），实现里为了避开小程序没有的 Node `Buffer`
 * 手写了 base64 解码 —— 手写的解码最容易在边界上错（位数凑不满、非法字符、
 * 载荷太短），所以就按边界来测。
 */

/** 一小段合法的 PNG / JPEG 头部（尾部的 'AAAA' 是填充，模拟真实 base64） */
const PNG_HEAD = 'iVBORw0KGgoAAAANSUhEUg'
const JPEG_HEAD = '/9j/4AAQSkZJRgABAQAAAQ'

describe('sniffBase64Image', () => {
  it('认出 JPEG（FF D8）', () => {
    expect(sniffBase64Image(JPEG_HEAD)).toBe('image/jpeg')
  })

  it('认出 PNG（8 字节签名）', () => {
    expect(sniffBase64Image(PNG_HEAD)).toBe('image/png')
  })

  it('GIF / WebP 一律认不出（服务端也拒绝这两种，因为无法可靠剥离元数据）', () => {
    // 'GIF89a' 的 base64 是 R0lGODlh
    expect(sniffBase64Image('R0lGODlhAIAAPAAA')).toBeNull()
    // 'RIFF....WEBP' 的 base64 是 UklGRg...
    expect(sniffBase64Image('UklGRgAAAABXRUJQ')).toBeNull()
  })

  it('载荷太短 / 非法字符 → null（而不是抛异常）', () => {
    expect(sniffBase64Image('')).toBeNull()
    expect(sniffBase64Image('AAAA')).toBeNull()
    expect(sniffBase64Image('不是base64$$$')).toBeNull()
  })

  it('只在需要时解出头部字节 —— 与 Buffer 的结果一致', () => {
    const payload = `${JPEG_HEAD}${'A'.repeat(400)}`
    expect(sniffBase64Image(payload)).toBe('image/jpeg')
    // 用 Buffer 交叉验证前 3 字节（Node 里能跑，运行时不用它）
    const bytes = Buffer.from(payload, 'base64')
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })
})

describe('imageDataUrlBytes / dataUrlMime / formatBytes', () => {
  it('字节数按 base64 载荷估算（含 padding 补偿）', () => {
    // 'AA==' → 1 字节
    expect(imageDataUrlBytes('data:image/png;base64,AA==')).toBe(1)
    // 'AAA=' → 2 字节
    expect(imageDataUrlBytes('data:image/png;base64,AAA=')).toBe(2)
    // 'AAAA' → 3 字节
    expect(imageDataUrlBytes('data:image/png;base64,AAAA')).toBe(3)
  })

  it('MIME 取不到时按 jpeg 处理（不返回 undefined 让调用方崩）', () => {
    expect(dataUrlMime('data:image/png;base64,AAAA')).toBe('image/png')
    expect(dataUrlMime('乱七八糟')).toBe('image/jpeg')
  })

  it('人类可读的体积（避免把 6 位数字甩给用户）', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('张数文案与上限同源', () => {
    expect(imageCountLabel(0)).toBe(`0/${MAX_IMAGES_PER_ITEM}`)
    expect(imageCountLabel(3, 9)).toBe('3/9')
  })
})

describe('imageSummary（列表缩略图）', () => {
  it('取第一张 + 总数', () => {
    expect(imageSummary(['a.jpg', 'b.jpg'])).toEqual({ thumbnailUrl: 'a.jpg', imageCount: 2 })
  })

  it('undefined / null / 空数组都退化成「没有图」，不抛异常', () => {
    expect(imageSummary(undefined)).toEqual({ thumbnailUrl: null, imageCount: 0 })
    expect(imageSummary(null)).toEqual({ thumbnailUrl: null, imageCount: 0 })
    expect(imageSummary([])).toEqual({ thumbnailUrl: null, imageCount: 0 })
  })
})

describe('isRenderableImageUrl', () => {
  it('http/https/协议相对地址都能渲染', () => {
    expect(isRenderableImageUrl('https://cdn.example/a.jpg')).toBe(true)
    expect(isRenderableImageUrl('http://localhost:3999/api/v1/media/files/a.jpg')).toBe(true)
    expect(isRenderableImageUrl('//cdn.example/a.jpg')).toBe(true)
  })

  it('mock 模式的 data URL 也算可渲染（离线演示要真出图）', () => {
    expect(isRenderableImageUrl('data:image/png;base64,AAAA')).toBe(true)
  })

  it('空串 / 相对路径不算（`<Image>` 加载不出来但又不报错，最难排查）', () => {
    expect(isRenderableImageUrl('')).toBe(false)
    expect(isRenderableImageUrl('/api/v1/media/files/a.jpg')).toBe(false)
  })
})

describe('默认上限', () => {
  it('单张 2 MB，与后端 MEDIA_MAX_BYTES 默认值一致', () => {
    expect(DEFAULT_MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
  })
})
