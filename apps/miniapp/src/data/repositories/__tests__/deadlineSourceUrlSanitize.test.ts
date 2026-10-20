import { describe, expect, it, vi } from 'vitest'

/**
 * 仓储的默认参数会 import `data/storage/taroStorage`（它又 import `@tarojs/taro`）。
 * 单测只验证纯逻辑，不加载 Taro 运行时；和 `campusPoiLocalRepository.test.ts`
 * 一样把这个 adapter 换成空实现，每个用例显式注入自己的 `CachePort`。
 */
vi.mock('../../storage/taroStorage', () => ({
  createTaroStorage: () => ({
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  }),
}))

import type { DeadlineItem } from '@kedaya/contracts'

import {
  createDeadlineLocalRepository,
  DEADLINE_LOCAL_STORAGE_KEY,
} from '../deadlineLocalRepository'

/**
 * `sourceUrl` 的会话令牌清洗。
 *
 * ## 为什么这条必须守
 *
 * 回源链接是用户从浏览器复制的，经常带着**会话凭据**，
 * 形如 `?ticket=ST-1234&session=abc`。
 *
 * 把这种 URL 原样存进本机 storage、再渲染到页面上，等于：
 * - 令牌进了设备存储（任何拿到设备的人都看得到）
 * - 有人截图分享 DDL 时，令牌跟着进了截图
 * - 将来做「导出数据」时，令牌跟着进了导出文件
 *
 * `sanitizeSourceUrl`（从 AgenticCampus 合并）剥掉这类参数。
 * 这组测试锁的是「**读写两条路都清洗**」。
 */
function item(over: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: 'ddl-1',
    title: '作业 3',
    courseId: 'cs101',
    courseName: 'CS101',
    dueAt: '2026-10-20T15:59:00.000Z',
    dueAtRaw: 'Oct 20, 2026 11:59 PM',
    source: 'blackboard',
    kind: 'assignment',
    sourceUrl: '',
    submitted: false,
    weight: null,
    ...over,
  }
}

function memoryCache() {
  const store = new Map<string, unknown>()
  return {
    read<T>(key: string): T | null {
      return (store.get(key) as T) ?? null
    },
    write(key: string, value: unknown): void {
      store.set(key, value)
    },
    remove(key: string): void {
      store.delete(key)
    },
    dump(): Record<string, unknown> {
      return Object.fromEntries(store)
    },
  }
}

describe('DDL 仓储 · sourceUrl 清洗', () => {
  it('⚠️ 写入时剥掉 ticket / session 参数', () => {
    const cache = memoryCache()
    const repository = createDeadlineLocalRepository(cache)

    repository.write([
      item({
        sourceUrl: 'https://courses.example.edu/assignments?ticket=ST-1234&session=abc&course=cs101',
      }),
    ])

    const stored = cache.dump()[DEADLINE_LOCAL_STORAGE_KEY] as DeadlineItem[]
    const url = stored[0]?.sourceUrl ?? ''
    expect(url).not.toContain('ST-1234')
    expect(url).not.toContain('abc')
    // 可读部分保留，用户还能点开去核对
    expect(url).toContain('courses.example.edu')
    expect(url).toContain('cs101')
  })

  it('⚠️ 读取时也清洗（清掉本次改动之前写入的旧数据）', () => {
    const cache = memoryCache()
    // 直接往 storage 塞一条"旧格式"带令牌的数据，绕过 write()
    cache.write(DEADLINE_LOCAL_STORAGE_KEY, [
      item({ sourceUrl: 'https://courses.example.edu/a?ticket=ST-old&x=1' }),
    ])

    const repository = createDeadlineLocalRepository(cache)
    const read = repository.read()
    expect(read).toHaveLength(1)
    expect(read[0]?.sourceUrl ?? '').not.toContain('ST-old')
  })

  it('普通 URL 原样保留', () => {
    const cache = memoryCache()
    const repository = createDeadlineLocalRepository(cache)
    const plain = 'https://www.gradescope.com/courses/123/assignments'

    repository.write([item({ sourceUrl: plain })])
    expect(repository.read()[0]?.sourceUrl).toBe(plain)
  })

  it('空 sourceUrl 不被改坏', () => {
    const cache = memoryCache()
    const repository = createDeadlineLocalRepository(cache)
    repository.write([item({ sourceUrl: '' })])
    expect(repository.read()[0]?.sourceUrl).toBe('')
  })

  it('不可解析的 URL 变成空串（不存原始垃圾）', () => {
    const cache = memoryCache()
    const repository = createDeadlineLocalRepository(cache)
    repository.write([item({ sourceUrl: 'not a url at all' })])
    const stored = cache.dump()[DEADLINE_LOCAL_STORAGE_KEY] as DeadlineItem[]
    expect(stored[0]?.sourceUrl).toBe('')
  })
})
