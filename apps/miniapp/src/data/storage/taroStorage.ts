import Taro from '@tarojs/taro'

import type { CachePort } from '../../domain/ports/cachePort'

/**
 * Taro 同步存储适配器。
 *
 * 平台差异：
 * - weapp：底层 `wx.getStorageSync` / `wx.setStorageSync`，单 key 上限 1MB、总量 10MB。
 * - H5：Taro 落到 `localStorage`，隐私模式下可能**直接抛异常**，因此全部包 try/catch。
 *
 * 契约 §8 要求启动 hydrate 是同步的，所以这里只用 `*Sync` API。
 * 任何存储异常都静默降级为「没有缓存」，绝不阻塞启动。
 */
export function createTaroStorage(): CachePort {
  return {
    read<T>(key: string): T | null {
      try {
        const value = Taro.getStorageSync(key) as unknown
        if (value === '' || value === undefined || value === null) return null
        return value as T
      } catch {
        return null
      }
    },
    write<T>(key: string, value: T): void {
      try {
        Taro.setStorageSync(key, value)
      } catch {
        // 存储写满 / 隐私模式：缓存是尽力而为，失败不影响主流程
      }
    },
    remove(key: string): void {
      try {
        Taro.removeStorageSync(key)
      } catch {
        // 同上
      }
    },
  }
}
