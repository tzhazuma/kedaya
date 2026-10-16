import type { CachePort } from '../../domain/ports/cachePort'

/**
 * 纯内存缓存实现。
 *
 * 用途：
 * - Vitest（node 环境没有 Taro 存储 API）
 * - Taro 存储不可用时的兜底（隐私模式 / 存储写满）
 * - 测试里预置「本地已有缓存」的场景
 */
export interface MemoryStorage extends CachePort {
  snapshot(): Record<string, unknown>
  size(): number
}

export function createMemoryStorage(seed?: Record<string, unknown>): MemoryStorage {
  const store = new Map<string, unknown>(Object.entries(seed ?? {}))

  return {
    read<T>(key: string): T | null {
      if (!store.has(key)) return null
      return store.get(key) as T
    },
    write<T>(key: string, value: T): void {
      store.set(key, value)
    },
    remove(key: string): void {
      store.delete(key)
    },
    snapshot(): Record<string, unknown> {
      return Object.fromEntries(store)
    },
    size(): number {
      return store.size
    },
  }
}
