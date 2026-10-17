import type { Result } from '@kedaya/shared'

import {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_ITEM,
  type MediaCapabilities,
  type PickImagesResult,
  type UploadedImage,
} from '../../domain/models/media'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ImagePickerPort } from '../../domain/ports/mediaPort'
import type { MediaRepository } from '../../domain/ports/mediaRepository'

/**
 * 图片用例 —— presentation 只通过它拿"能不能传 / 选图 / 上传"。
 *
 * ## 为什么要有一个 `availability` 状态机，而不是一个 `enabled` 布尔
 *
 * 对象存储是**部署期**配置的。三种现实情况必须区分开，否则 UI 只有两种
 * 难看的写法（要么永远显示入口、要么永远不显示）：
 *
 * | 情况 | 状态 | UI |
 * |---|---|---|
 * | 还没问过服务端 | `unknown` / `loading` | 入口显示但禁用 + 说明「正在确认」 |
 * | 服务端说没配存储 | `disabled(not-configured)` | 入口不显示 + 说明为什么、找谁 |
 * | 问不通（断网/500） | `disabled(unavailable)` | 入口禁用 + 「重试」 |
 *
 * 第三种刻意**不静默隐藏**，也刻意**不假装可用**：
 * 它多半意味着网络有问题，此时真正该做的是提示 + 重试，
 * 而不是给用户一个点了必然失败的按钮（死路），也不是让功能凭空消失（困惑）。
 */
export type MediaAvailability =
  | { status: 'unknown' }
  | { status: 'loading' }
  | { status: 'enabled'; capabilities: MediaCapabilities }
  | { status: 'disabled'; reason: 'not-configured' | 'unavailable'; message: string }

export interface MediaDeps {
  repository: MediaRepository
  picker: ImagePickerPort
}

export interface MediaUseCases {
  /** 能力状态 —— 直接喂给 `useStore` */
  availability: {
    getSnapshot(): MediaAvailability
    subscribe(listener: () => void): () => void
  }
  /**
   * 确保能力已探测（幂等；并发调用只会发一次请求）。
   * `force` 用于用户主动点「重试」。
   */
  ensureAvailability(force?: boolean): Promise<MediaAvailability>
  /** 相册选图（含压缩）；`remaining` = 还能再加几张 */
  pickImages(remaining: number): Promise<Result<PickImagesResult, RepositoryError>>
  /** 上传一张（data URL → 可访问地址） */
  upload(dataUrl: string): Promise<Result<UploadedImage, RepositoryError>>
  /**
   * 删除已上传的对象（用户刚传完又把它从表单里去掉时，避免在存储里留孤儿文件）。
   *
   * best-effort：调用方**不应该**因为这里失败而阻止用户操作 ——
   * 用户的意图是"这条内容里不要这张图"，不是"必须清理存储"。
   */
  remove(key: string): Promise<Result<{ key: string }, RepositoryError>>
  /** 当前单张上限（未探测到时用默认值，保证选图压缩先按保守值来） */
  maxBytes(): number
  /** 单条内容最多几张 */
  maxCount(): number
}

/** 服务端没配对象存储时的说明 —— 写给**用户**看，但要能让管理员对上号 */
const NOT_CONFIGURED_MESSAGE =
  '这个部署还没有开启图片存储，暂时不能发图。管理员配置对象存储（MEDIA_STORAGE）后即可使用。'

const UNAVAILABLE_MESSAGE = '暂时无法确认图片服务状态，请检查网络后重试。'

export function createMediaUseCases(deps: MediaDeps): MediaUseCases {
  const { repository, picker } = deps

  let state: MediaAvailability = { status: 'unknown' }
  let inFlight: Promise<MediaAvailability> | null = null
  const listeners = new Set<() => void>()

  function publish(next: MediaAvailability): MediaAvailability {
    const changed = JSON.stringify(next) !== JSON.stringify(state)
    state = next
    if (changed) for (const listener of listeners) listener()
    return state
  }

  async function ensureAvailability(force = false): Promise<MediaAvailability> {
    if (!force && state.status === 'enabled') return state
    if (!force && state.status === 'disabled' && state.reason === 'not-configured') return state
    // 并发去重：三个模块同时挂载时只会真的发一次请求
    if (inFlight !== null) return inFlight

    publish({ status: 'loading' })
    inFlight = (async () => {
      const result = await repository.capabilities()
      if (result.ok) {
        return publish(
          result.value.enabled
            ? { status: 'enabled', capabilities: result.value }
            : { status: 'disabled', reason: 'not-configured', message: NOT_CONFIGURED_MESSAGE },
        )
      }
      const detail = result.error.message.trim()
      return publish({
        status: 'disabled',
        reason: 'unavailable',
        // 保留底层原因（"请求超时" / "网络连接失败"），但先给一句能照做的指引
        message: detail === '' || detail === UNAVAILABLE_MESSAGE
          ? UNAVAILABLE_MESSAGE
          : `${UNAVAILABLE_MESSAGE}（${detail}）`,
      })
    })()

    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  function maxBytes(): number {
    return state.status === 'enabled' ? state.capabilities.maxBytes : DEFAULT_MAX_IMAGE_BYTES
  }

  function maxCount(): number {
    if (state.status !== 'enabled') return MAX_IMAGES_PER_ITEM
    // 客户端的 9 与服务的 9 取小：任一放宽都不会让我们越界
    return Math.min(state.capabilities.maxCount, MAX_IMAGES_PER_ITEM)
  }

  return {
    availability: {
      getSnapshot: () => state,
      subscribe(listener: () => void): () => void {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    ensureAvailability,
    maxBytes,
    maxCount,

    async pickImages(remaining: number): Promise<Result<PickImagesResult, RepositoryError>> {
      const capacity = Math.min(remaining, maxCount())
      return picker.pickImages({ count: capacity, maxBytes: maxBytes() })
    },

    upload: (dataUrl: string) => repository.upload(dataUrl),

    remove: (key: string) => repository.remove(key),
  }
}
