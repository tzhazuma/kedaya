/**
 * 本地缓存端口。
 *
 * 契约 §8 启动时序第 1 步要求**同步** hydrate，因此这个端口刻意只有同步方法
 * （微信小程序侧实现为 `Taro.setStorageSync` / `wx.setStorageSync`）。
 *
 * 约定：写入的值必须是 JSON 可序列化的普通对象。
 */
export interface CachePort {
  read<T>(key: string): T | null
  write<T>(key: string, value: T): void
  remove(key: string): void
}
