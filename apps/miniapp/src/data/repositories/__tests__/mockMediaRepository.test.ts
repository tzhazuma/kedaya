import { describe, expect, it } from 'vitest'

import { createMockMediaRepository } from '../mockMediaRepository'
import { MAX_IMAGES_PER_ITEM } from '../../../domain/models/media'

/**
 * mock 媒体仓储的规格。
 *
 * 这里守的是一个容易被忽视的契约：**mock 返回的 `url` 必须能直接渲染**。
 * 如果 mock 返回一个假的 https 地址（很多人会这么写），离线演示时图全是裂的，
 * 而"图片链路能不能跑通"恰恰是这段代码唯一的价值。
 */

describe('mock 媒体仓储', () => {
  it('能力为 enabled（演示环境要能把带图的发布走完），但明确标 mock', async () => {
    const repository = createMockMediaRepository()
    const result = await repository.capabilities()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.enabled).toBe(true)
    expect(result.value.kind).toBe('mock')
    expect(result.value.maxCount).toBe(MAX_IMAGES_PER_ITEM)
    expect([...result.value.accept]).toEqual(['image/jpeg', 'image/png'])
  })

  it('上传返回 data URL 本身 —— 离线也能真渲染', async () => {
    const repository = createMockMediaRepository()
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ'
    const result = await repository.upload(dataUrl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.url).toBe(dataUrl)
    expect(result.value.key.startsWith('mock-')).toBe(true)
  })

  it('key 每次都不一样（同一张图传两次不该覆盖）', async () => {
    const repository = createMockMediaRepository()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const first = await repository.upload(dataUrl)
    const second = await repository.upload(dataUrl)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(first.value.key).not.toBe(second.value.key)
  })

  it('非图片 data URL 直接拒绝（不做"反正 mock 随便过"的假宽容）', async () => {
    const repository = createMockMediaRepository()
    const result = await repository.upload('data:text/plain;base64,SGVsbG8=')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })
})
