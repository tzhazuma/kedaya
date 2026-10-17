import { describe, expect, it, vi } from 'vitest'
import { err, ok, type Result } from '@kedaya/shared'

import { createMediaUseCases } from '../mediaUseCases'
import type { MediaAvailability } from '../mediaUseCases'
import { MAX_IMAGES_PER_ITEM, type MediaCapabilities, type UploadedImage } from '../../../domain/models/media'
import type { RepositoryError } from '../../../domain/ports/errors'
import type { ImagePickerPort, PickImagesOptions } from '../../../domain/ports/mediaPort'
import type { MediaRepository } from '../../../domain/ports/mediaRepository'

/**
 * 图片用例的规格。
 *
 * 这一层最需要被守住的是**可用性状态机**：图片能力取决于部署期有没有配对象存储，
 * 三种情况（没配 / 问不通 / 配好了）必须给出三种不同的 UI 行为 ——
 * 写错任何一支都会变成"点了必然失败的按钮"或"功能凭空消失"，两者都是死路。
 *
 * 其次是**并发去重**：三个发布页先后挂载时只应该真的发一次 `GET /media/config`。
 */

const CAPABILITIES: MediaCapabilities = {
  enabled: true,
  kind: 's3',
  maxBytes: 5 * 1024 * 1024,
  maxCount: 9,
  accept: ['image/jpeg', 'image/png'],
}

function makeRepository(
  capabilities: Result<MediaCapabilities, RepositoryError>,
): MediaRepository & { capabilitiesCalls: number } {
  const repo = {
    capabilitiesCalls: 0,
    async capabilities(): Promise<Result<MediaCapabilities, RepositoryError>> {
      repo.capabilitiesCalls += 1
      // 模拟真实网络：让并发调用真的重叠
      await new Promise((resolve) => setTimeout(resolve, 5))
      return capabilities
    },
    async upload(dataUrl: string): Promise<Result<UploadedImage, RepositoryError>> {
      return ok({ key: 'k.jpg', url: `https://cdn/${dataUrl.slice(0, 4)}`, bytes: 1, width: null, height: null })
    },
    async remove(key: string): Promise<Result<{ key: string }, RepositoryError>> {
      return ok({ key })
    },
  }
  return repo
}

function makePicker(): ImagePickerPort & { lastOptions: PickImagesOptions | null } {
  const picker = {
    lastOptions: null as PickImagesOptions | null,
    isAvailable: () => true,
    async pickImages(options: PickImagesOptions) {
      picker.lastOptions = options
      return ok({ accepted: [{ dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 1, width: null, height: null }], skipped: [] })
    },
  }
  return picker
}

function snapshot(useCases: ReturnType<typeof createMediaUseCases>): MediaAvailability {
  return useCases.availability.getSnapshot()
}

describe('能力探测（availability）', () => {
  it('初始是 unknown：UI 显示入口但禁用 + 「正在确认」', () => {
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker: makePicker() })
    expect(snapshot(useCases)).toEqual({ status: 'unknown' })
  })

  it('服务端配好了对象存储 → enabled，并放出能力值', async () => {
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker: makePicker() })
    await useCases.ensureAvailability()
    expect(snapshot(useCases)).toEqual({ status: 'enabled', capabilities: CAPABILITIES })
  })

  it('服务端 enabled=false → disabled(not-configured)：UI 整块不渲染入口', async () => {
    const useCases = createMediaUseCases({
      repository: makeRepository(ok({ ...CAPABILITIES, enabled: false, kind: 'disabled' })),
      picker: makePicker(),
    })
    await useCases.ensureAvailability()
    const state = snapshot(useCases)
    expect(state.status).toBe('disabled')
    if (state.status !== 'disabled') throw new Error('unreachable')
    expect(state.reason).toBe('not-configured')
    // 说明文案要能让用户对上号（提到 MEDIA_STORAGE，管理员一眼知道改哪儿）
    expect(state.message).toContain('MEDIA_STORAGE')
  })

  it('问不通 → disabled(unavailable)：保留入口 + 可重试，且带上底层原因', async () => {
    const useCases = createMediaUseCases({
      repository: makeRepository(err({ code: 'NETWORK', message: '请求超时' })),
      picker: makePicker(),
    })
    await useCases.ensureAvailability()
    const state = snapshot(useCases)
    expect(state.status).toBe('disabled')
    if (state.status !== 'disabled') throw new Error('unreachable')
    expect(state.reason).toBe('unavailable')
    expect(state.message).toContain('请求超时')
  })

  it('失败后 force 重试能恢复（用户在页面上点「重试」的路径）', async () => {
    const repo = makeRepository(err({ code: 'NETWORK', message: '断网' }))
    const useCases = createMediaUseCases({ repository: repo, picker: makePicker() })
    await useCases.ensureAvailability()
    expect(snapshot(useCases).status).toBe('disabled')

    // 换成"网络恢复"：用同一个仓储对象改行为，模拟重试成功
    repo.capabilities = async () => ok(CAPABILITIES)
    await useCases.ensureAvailability(true)
    expect(snapshot(useCases).status).toBe('enabled')
  })

  it('已成功探测后不再重复请求（页面切换不该打网络）', async () => {
    const repo = makeRepository(ok(CAPABILITIES))
    const useCases = createMediaUseCases({ repository: repo, picker: makePicker() })
    await useCases.ensureAvailability()
    await useCases.ensureAvailability()
    await useCases.ensureAvailability()
    expect(repo.capabilitiesCalls).toBe(1)
  })

  it('没配存储时不反复重试（这是部署事实，不是临时故障）', async () => {
    const repo = makeRepository(ok({ ...CAPABILITIES, enabled: false }))
    const useCases = createMediaUseCases({ repository: repo, picker: makePicker() })
    await useCases.ensureAvailability()
    await useCases.ensureAvailability()
    expect(repo.capabilitiesCalls).toBe(1)
  })

  it('并发调用只发一次请求（三个发布页先后挂载）', async () => {
    const repo = makeRepository(ok(CAPABILITIES))
    const useCases = createMediaUseCases({ repository: repo, picker: makePicker() })
    await Promise.all([
      useCases.ensureAvailability(),
      useCases.ensureAvailability(),
      useCases.ensureAvailability(),
    ])
    expect(repo.capabilitiesCalls).toBe(1)
    expect(snapshot(useCases).status).toBe('enabled')
  })

  it('订阅者会在状态变化时被通知（`useStore` 依赖这一点）', async () => {
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker: makePicker() })
    const listener = vi.fn()
    const unsubscribe = useCases.availability.subscribe(listener)
    await useCases.ensureAvailability()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('选图上限与体积上限', () => {
  it('未探测到能力时用保守默认值（不会因为还没问到就放开 100 张）', () => {
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker: makePicker() })
    expect(useCases.maxCount()).toBe(MAX_IMAGES_PER_ITEM)
    expect(useCases.maxBytes()).toBe(2 * 1024 * 1024)
  })

  it('探测到能力后用服务端的值（体积上限以服务端为准，避免白传一趟）', async () => {
    const picker = makePicker()
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker })
    await useCases.ensureAvailability()

    await useCases.pickImages(9)
    expect(picker.lastOptions).toEqual({ count: 9, maxBytes: 5 * 1024 * 1024 })
  })

  it('「还能加几张」比服务端上限小时以剩余额度为准', async () => {
    const picker = makePicker()
    const useCases = createMediaUseCases({ repository: makeRepository(ok(CAPABILITIES)), picker })
    await useCases.ensureAvailability()

    await useCases.pickImages(2)
    expect(picker.lastOptions?.count).toBe(2)
  })

  it('服务端上限小于客户端常量时取小（任一放宽都不会越界）', async () => {
    const picker = makePicker()
    const useCases = createMediaUseCases({
      repository: makeRepository(ok({ ...CAPABILITIES, maxCount: 4 })),
      picker,
    })
    await useCases.ensureAvailability()
    expect(useCases.maxCount()).toBe(4)

    await useCases.pickImages(9)
    expect(picker.lastOptions?.count).toBe(4)
  })
})

describe('上传', () => {
  it('透传仓储结果（不在用例层吞错误 —— 页面要显示原因并允许重试）', async () => {
    const repository: MediaRepository = {
      capabilities: async () => ok(CAPABILITIES),
      upload: async () => err({ code: 'VALIDATION_FAILED', message: '只支持 JPG / PNG' }),
      remove: async (key) => ok({ key }),
    }
    const useCases = createMediaUseCases({ repository, picker: makePicker() })
    const result = await useCases.upload('data:image/gif;base64,AAAA')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toBe('只支持 JPG / PNG')
  })

  it('删除也透传（用户「传了又不要」时由 hook 调它清理孤儿对象）', async () => {
    const removed: string[] = []
    const repository: MediaRepository = {
      capabilities: async () => ok(CAPABILITIES),
      upload: async () => ok({ key: 'k.jpg', url: 'https://cdn/k.jpg', bytes: 1, width: null, height: null }),
      remove: async (key) => {
        removed.push(key)
        return ok({ key })
      },
    }
    const useCases = createMediaUseCases({ repository, picker: makePicker() })
    await useCases.remove('media-20261017-abc.jpg')
    expect(removed).toEqual(['media-20261017-abc.jpg'])
  })
})
