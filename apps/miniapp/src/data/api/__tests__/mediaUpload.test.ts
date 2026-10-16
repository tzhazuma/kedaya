import { describe, expect, it } from 'vitest'

import { buildMediaUploadFormData, parseUploadResponse } from '../mediaUploadCodec'
import type { UploadMediaInput } from '../../../domain/ports/wildlifeRepository'

/**
 * 照片上传的**纯函数**部分测试（不触碰 Taro）。
 *
 * `createTaroMediaUploader()` 本体依赖 `wx.uploadFile`，只能在真机/开发者工具里验证；
 * 因此这里把「表单字段构造」与「响应解包」抽成纯函数单独测 ——
 * 它们是**幂等与去重**的依据（规格 §4.5），错了会导致重复存储或 UI 拿到 `undefined`。
 */

const INPUT: UploadMediaInput = {
  tempFilePath: 'wxfile://tmp/a.jpg',
  widthPx: 1200,
  heightPx: 900,
  byteSize: 300_000,
  mimeType: 'image/jpeg',
  clientPhotoId: 'cp-abc',
  idempotencyKey: 'cp-abc',
}

describe('wildlife · 照片上传 · 表单字段', () => {
  it('带上 clientPhotoId 与尺寸/类型（服务端据此做幂等与去重）', () => {
    expect(buildMediaUploadFormData(INPUT)).toEqual({
      clientPhotoId: 'cp-abc',
      widthPx: '1200',
      heightPx: '900',
      byteSize: '300000',
      mimeType: 'image/jpeg',
    })
  })

  it('不把本地临时路径塞进表单（路径只用于 uploadFile 的 filePath）', () => {
    const form = buildMediaUploadFormData(INPUT)
    expect(JSON.stringify(form)).not.toContain('wxfile://')
  })
})

describe('wildlife · 照片上传 · 响应解包', () => {
  it('合法信封 → WildlifeMedia（含假缩略图 URL 与 exifStripped）', () => {
    const result = parseUploadResponse(
      {
        ok: true,
        data: {
          mediaId: 'wm-1',
          thumbUrl: 'https://cdn.example/thumb.webp',
          exifStripped: true,
          widthPx: 1200,
          heightPx: 900,
          byteSize: 250_000,
          mimeType: 'image/jpeg',
          sha256: 'abc',
          clientPhotoId: 'cp-abc',
        },
        traceId: 't-1',
      },
      'fallback',
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mediaId).toBe('wm-1')
    expect(result.value.exifStripped).toBe(true)
    expect(result.value.clientPhotoId).toBe('cp-abc')
  })

  it('缺 mediaId / thumbUrl → 失败（绝不让 UI 拿着 undefined 去渲染图片）', () => {
    const missingId = parseUploadResponse(
      { ok: true, data: { thumbUrl: 'https://cdn.example/t.webp' }, traceId: 't' },
      'fallback',
    )
    expect(missingId.ok).toBe(false)

    const missingThumb = parseUploadResponse(
      { ok: true, data: { mediaId: 'wm-1' }, traceId: 't' },
      'fallback',
    )
    expect(missingThumb.ok).toBe(false)
  })

  it('服务端未声明 exifStripped 时按**未剥离**处理（宁可提示，也不假装安全）', () => {
    const result = parseUploadResponse(
      { ok: true, data: { mediaId: 'wm-1', thumbUrl: 'https://cdn.example/t.webp' }, traceId: 't' },
      'fallback',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.exifStripped).toBe(false)
  })

  it('失败信封 → RepositoryError，带上 code / message / traceId / details', () => {
    const result = parseUploadResponse(
      {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: '图片超过 5MB', details: { reason: 'MEDIA_TOO_LARGE' } },
        traceId: 't-2',
      },
      'fallback',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(result.error.message).toBe('图片超过 5MB')
    expect(result.error.traceId).toBe('t-2')
    expect(result.error.details).toEqual({ reason: 'MEDIA_TOO_LARGE' })
  })

  it('非信封响应（例如 HTML 错误页）→ INTERNAL，不放行未校验数据', () => {
    const result = parseUploadResponse('<html>502 Bad Gateway</html>', 'trace-x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INTERNAL')
    expect(result.error.traceId).toBe('trace-x')
  })

  it('字段类型不对时给出安全默认值（不抛错）', () => {
    const result = parseUploadResponse(
      {
        ok: true,
        data: { mediaId: 'wm-1', thumbUrl: 'https://cdn.example/t.webp', widthPx: 'wide' },
        traceId: 't',
      },
      'fallback',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.widthPx).toBe(0)
      expect(result.value.mimeType).toBe('image/jpeg')
    }
  })
})
