import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getContainer } from '../../app/container'
import type { MediaAvailability } from '../../application/media/mediaUseCases'
import { toast } from '../../platform/navigation'
import { useStore } from './useStore'

/**
 * 图片附件的页面状态机（三个发布页共用）。
 *
 * 为什么抽成 hook：跳蚤 / 失物 / 论坛三个发布页都要「选图 → 逐张上传 →
 * 显示每张的状态 → 失败可重试 → 提交时得到一串 URL」，这段状态机写三遍
 * 必然有一遍忘记处理失败重试。
 *
 * 四个产品决定：
 *   1. **选完立刻上传**，而不是提交时才传。用户能马上看到哪张失败了，
 *      而不是在点「发布」之后等半分钟再收到一句「有图片上传失败」；
 *   2. **串行上传**：弱网下并发上传的成功率明显更差，且失败时用户分不清
 *      是哪张在失败；
 *   3. **单张失败不影响其它张**，但失败是**可见且必须处理**的
 *      （`failedCount` / `ready`），不允许静默丢图；
 *   4. **data URL 只留在内存**里做预览，落库的永远是服务端返回的地址
 *      （mock 模式返回的就是 data URL，因此离线也能看到图）。
 */

export type AttachmentStatus = 'uploading' | 'done' | 'failed'

export interface AttachmentItem {
  /** 本地 id（React key 与重试寻址都靠它） */
  id: string
  /** 预览地址：上传中/失败时是本地 data URL，成功后是服务端地址 */
  previewUrl: string
  status: AttachmentStatus
  /** 失败原因（展示在图上） */
  message?: string
  /** 上传成功后的服务端 key（删除时用；初值来自既有记录时为 undefined） */
  key?: string
  url?: string
}

export interface ImageAttachmentsController {
  items: AttachmentItem[]
  /** 服务端可用性（页面据此决定显示入口 / 禁用 / 说明原因） */
  availability: MediaAvailability
  /** 已达上限（页面据此隐藏"添加"入口） */
  full: boolean
  /** 有图正在上传 —— 提交按钮据此禁用 */
  uploading: boolean
  failedCount: number
  /** 能提交吗：没有正在上传的图（失败的会以 `failedCount` 提示，但不阻断提交） */
  ready: boolean
  /** 已成功上传的地址（提交时放进 `imageUrls`） */
  urls: string[]
  maxCount: number
  add(): Promise<void>
  remove(id: string): void
  retry(id: string): Promise<void>
}

export function useImageAttachments(initialUrls: readonly string[] = []): ImageAttachmentsController {
  const container = getContainer()
  const media = container.useCases.media
  const availability = useStore(media.availability)

  const [items, setItems] = useState<AttachmentItem[]>(() =>
    initialUrls.map((url, index) => ({
      id: `initial-${index}`,
      previewUrl: url,
      status: 'done' as const,
      url,
    })),
  )
  const counter = useRef(0)

  // 进页面就探测能力（幂等；多个页面先后挂载也只会真的请求一次）
  useEffect(() => {
    void media.ensureAvailability()
  }, [media])

  const upload = useCallback(
    async (id: string, dataUrl: string): Promise<void> => {
      const result = await media.upload(dataUrl)
      setItems((previous) =>
        previous.map((item) => {
          if (item.id !== id) return item
          if (!result.ok) return { ...item, status: 'failed', message: result.error.message }
          return {
            ...item,
            status: 'done',
            key: result.value.key,
            url: result.value.url,
            // 预览换成服务端地址：用户看到的和别人将看到的是同一张图
            previewUrl: result.value.url,
            message: undefined,
          }
        }),
      )
    },
    [media],
  )

  const add = useCallback(async (): Promise<void> => {
    const maxCount = media.maxCount()
    const remaining = Math.max(0, maxCount - items.length)
    if (remaining === 0) {
      toast(`最多只能添加 ${maxCount} 张图片`)
      return
    }

    const picked = await media.pickImages(remaining)
    if (!picked.ok) {
      toast(picked.error.message, 'error')
      return
    }
    if (picked.value.skipped.length > 0) {
      // 如实告知被跳过的原因（格式不支持 / 太大），而不是静默少收几张
      toast(picked.value.skipped.join('；'))
    }
    if (picked.value.accepted.length === 0) return

    const fresh: AttachmentItem[] = picked.value.accepted.map((image) => {
      counter.current += 1
      return {
        id: `local-${counter.current}`,
        previewUrl: image.dataUrl,
        status: 'uploading' as const,
      }
    })
    setItems((previous) => [...previous, ...fresh])

    for (const [index, image] of picked.value.accepted.entries()) {
      const target = fresh[index]
      if (target === undefined) continue
      await upload(target.id, image.dataUrl)
    }
  }, [items.length, media, upload])

  const remove = useCallback(
    (id: string): void => {
      const target = items.find((item) => item.id === id)
      setItems((previous) => previous.filter((item) => item.id !== id))
      /**
       * 刚传成功又被删掉的图，顺手把服务端对象也删掉 —— 否则每次「传了又不要」
       * 都会在存储里留下一个永远不会被引用的文件。
       * best-effort：失败不提示（用户要的是「这条内容里不要这张图」）。
       */
      if (target?.key !== undefined) void media.remove(target.key)
    },
    [items, media],
  )

  const retry = useCallback(
    async (id: string): Promise<void> => {
      const target = items.find((item) => item.id === id)
      // 只有"本地 data URL 还在"的失败项能重试；否则只能删掉重选
      if (target === undefined) return
      if (!target.previewUrl.startsWith('data:image/')) {
        remove(id)
        toast('这张图需要重新选择')
        return
      }
      setItems((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, status: 'uploading', message: undefined } : item,
        ),
      )
      await upload(id, target.previewUrl)
    },
    [items, remove, upload],
  )

  const failedCount = items.filter((item) => item.status === 'failed').length
  const uploading = items.some((item) => item.status === 'uploading')
  const urls = useMemo(
    () =>
      items
        .filter((item) => item.status === 'done' && item.url !== undefined)
        .map((item) => item.url as string),
    [items],
  )

  return {
    items,
    availability,
    maxCount: media.maxCount(),
    full: items.length >= media.maxCount(),
    uploading,
    failedCount,
    ready: !uploading,
    urls,
    add,
    remove,
    retry,
  }
}

/**
 * 发布前的图片检查（三个发布页共用同一句文案）。
 *
 * **有图没传成功时不允许提交**：那不是"少了一张图"，而是用户以为发出去的照片
 * 其实没发出去 —— 比直接报错更糟。要么重试、要么自己删掉，由用户决定。
 */
export function imageSubmitProblem(
  controller: Pick<ImageAttachmentsController, 'failedCount' | 'uploading'>,
): string | null {
  if (controller.uploading) return '图片还在上传，请稍等'
  if (controller.failedCount > 0) {
    return `有 ${controller.failedCount} 张图片没传成功，点图重试或删除后再发布`
  }
  return null
}

/** 页面用的能力速查 —— 把状态机翻译成「要不要显示入口、要不要禁用」 */
export interface UploaderAvailabilityView {
  /** 是否允许点「添加图片」 */
  canAdd: boolean
  /** 入口是否要渲染出来（`not-configured` 时整块不渲染，改为说明文字） */
  showEntry: boolean
  /** 给用户看的说明（null = 不需要额外说明） */
  note: string | null
}

export function describeAvailability(availability: MediaAvailability): UploaderAvailabilityView {
  switch (availability.status) {
    case 'enabled':
      return { canAdd: true, showEntry: true, note: null }
    case 'loading':
    case 'unknown':
      return { canAdd: false, showEntry: true, note: '正在确认图片服务…' }
    case 'disabled':
      return {
        canAdd: false,
        /**
         * `not-configured` 时整块不渲染选图入口 —— 这个部署就是没有图片能力，
         * 给一个必然失败的按钮才是死路。`unavailable` 相反：能力可能没问题，
         * 只是这次没问到，所以入口保留（禁用）+ 让用户重试。
         */
        showEntry: availability.reason === 'unavailable',
        note: availability.message,
      }
  }
}
