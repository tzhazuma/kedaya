import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_HOME_ENTRY_IDS, MAX_HOME_ENTRY_IDS } from '../../../domain/models/homeEntries'
import type { CachePort } from '../../../domain/ports/cachePort'
import { createHomeLayoutUseCase } from '../homeLayoutUseCases'

/**
 * 首页布局用例。
 *
 * 分层纪律：`application` 不得 import `data/**`（ESLint 强制），
 * 因此这里用一个 6 行的内存 `CachePort` 替身，而不是复用 `data/storage` 的实现。
 */
function memoryCache(seed: Record<string, unknown> = {}): CachePort & { dump(): Record<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed))
  return {
    read: <T>(key: string): T | null => (store.has(key) ? (store.get(key) as T) : null),
    write: <T>(key: string, value: T): void => {
      store.set(key, value)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
    dump: () => Object.fromEntries(store),
  }
}

const KEY = (viewer: string | null): string => `layout:${viewer ?? 'anonymous'}`

function setup(seed: Record<string, unknown> = {}, viewer: string | null = 'u-1') {
  const cache = memoryCache(seed)
  const useCase = createHomeLayoutUseCase({
    cache,
    viewerId: () => viewer,
    cacheKeyFor: KEY,
  })
  return { cache, useCase }
}

describe('createHomeLayoutUseCase', () => {
  let cache: ReturnType<typeof memoryCache>
  let useCase: ReturnType<typeof createHomeLayoutUseCase>

  beforeEach(() => {
    const created = setup()
    cache = created.cache
    useCase = created.useCase
  })

  it('没有缓存时给出默认布局（含固定入口）', () => {
    expect(useCase.getSnapshot().ids).toEqual(DEFAULT_HOME_ENTRY_IDS)
    expect(useCase.selectedEntries().map((entry) => entry.id)).toEqual(DEFAULT_HOME_ENTRY_IDS)
  })

  it('hydrate 读缓存并规范化（旧缓存里的未知 id 会被丢掉）', () => {
    const seeded = setup({ [KEY('u-1')]: ['wildlife', 'gone-module', 'cou', 'cou'] })

    seeded.useCase.hydrate()

    expect(seeded.useCase.getSnapshot().ids).toEqual(['wellbeing', 'wildlife', 'cou'])
    expect(seeded.useCase.getSnapshot().hydrated).toBe(true)
  })

  it('hydrate 是幂等的（页面每次 useDidShow 都会调）', () => {
    const seeded = setup({ [KEY('u-1')]: ['cou'] })

    seeded.useCase.hydrate()
    seeded.useCase.hydrate()

    expect(seeded.useCase.getSnapshot().ids).toEqual(['wellbeing', 'cou'])
  })

  it('换账号后重新读一份布局，不会串味', () => {
    const cache = memoryCache({
      [KEY('u-1')]: ['cou', 'wildlife'],
      [KEY('u-2')]: ['flea-market'],
    })
    let viewer: string | null = 'u-1'
    const useCase = createHomeLayoutUseCase({ cache, viewerId: () => viewer, cacheKeyFor: KEY })

    useCase.hydrate()
    expect(useCase.getSnapshot().ids).toEqual(['wellbeing', 'cou', 'wildlife'])

    viewer = 'u-2'
    expect(useCase.hydrate().ids).toEqual(['wellbeing', 'flea-market'])

    viewer = 'u-1'
    expect(useCase.hydrate().ids).toEqual(['wellbeing', 'cou', 'wildlife'])
  })

  it('toggle 增删入口，并同步写回缓存', () => {
    useCase.hydrate()

    // 已在首页 → 再点一次是移除
    expect(useCase.toggle('lost-found').ok).toBe(true)
    expect(useCase.getSnapshot().ids).not.toContain('lost-found')

    // 不在首页 → 添加
    expect(useCase.toggle('forum').ok).toBe(true)
    expect(useCase.getSnapshot().ids).toContain('forum')

    // 再加一次 → 移除
    expect(useCase.toggle('forum').ok).toBe(true)
    expect(useCase.getSnapshot().ids).not.toContain('forum')
    expect(cache.dump()[KEY('u-1')]).toEqual(useCase.getSnapshot().ids)
  })

  it('固定入口（心理支持）不能移除', () => {
    useCase.hydrate()

    const result = useCase.toggle('wellbeing')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('安全出口')
    expect(useCase.getSnapshot().ids).toContain('wellbeing')
  })

  it('达到上限后拒绝添加，并说清该怎么办', () => {
    useCase.hydrate()
    for (const entry of useCase.addableEntries()) {
      if (!useCase.canAdd()) break
      useCase.toggle(entry.id)
    }

    expect(useCase.getSnapshot().ids.length).toBe(MAX_HOME_ENTRY_IDS)
    expect(useCase.canAdd()).toBe(false)

    // 上限之后仍有没被选中的入口（19 个入口 vs 12 个位置上限），
    // 点它必须被明确拒绝，而不是静默什么都不做
    const addable = useCase.addableEntries()
    expect(addable.length).toBeGreaterThan(0)
    const rejected = useCase.toggle(addable[0]?.id ?? 'forum')
    expect(rejected.ok).toBe(false)
    expect(rejected.message).toContain(`最多放 ${MAX_HOME_ENTRY_IDS} 个`)
  })

  it('不认识的服务 id 直接被拒绝（不是静默什么都不做）', () => {
    const result = useCase.toggle('not-a-module')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('契约')
  })

  it('move 上移 / 下移，且不会越过固定入口', () => {
    useCase.hydrate() // ['wellbeing', 'cou', 'canteen', 'flea-market', ...]

    expect(useCase.move('canteen', -1)).toEqual({ ok: true, message: '已上移' })
    expect(useCase.getSnapshot().ids.slice(0, 3)).toEqual(['wellbeing', 'canteen', 'cou'])

    // 再往上一步就会越过固定入口
    expect(useCase.move('canteen', -1).ok).toBe(false)
    expect(useCase.getSnapshot().ids.slice(0, 3)).toEqual(['wellbeing', 'canteen', 'cou'])

    expect(useCase.move('canteen', 1)).toEqual({ ok: true, message: '已下移' })
    expect(useCase.getSnapshot().ids.slice(0, 3)).toEqual(['wellbeing', 'cou', 'canteen'])
  })

  it('move 在两端与固定入口上给出明确提示', () => {
    useCase.hydrate()

    expect(useCase.move('wellbeing', -1).ok).toBe(false)
    expect(useCase.move('wellbeing', 1).ok).toBe(false)

    const last = useCase.getSnapshot().ids.at(-1) as string
    expect(useCase.move(last, 1).ok).toBe(false)
    expect(useCase.move('not-in-layout', -1).ok).toBe(false)
  })

  it('reset 恢复默认布局', () => {
    useCase.hydrate()
    useCase.toggle('forum')
    expect(useCase.isCustomized()).toBe(true)

    expect(useCase.reset().ok).toBe(true)
    expect(useCase.getSnapshot().ids).toEqual(DEFAULT_HOME_ENTRY_IDS)
    expect(useCase.isCustomized()).toBe(false)
  })

  it('每次改动都会通知订阅者（首页与「首页管理」页共用一份状态）', () => {
    const listener = vi.fn()
    const unsubscribe = useCase.subscribe(listener)

    useCase.toggle('forum')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    useCase.toggle('forum')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('可添加列表排除了已选项，选中项排除了固定入口之外的一切未知项', () => {
    useCase.hydrate()

    const addable = useCase.addableEntries().map((entry) => entry.id)
    for (const id of useCase.getSnapshot().ids) expect(addable).not.toContain(id)
    expect(addable).toContain('forum')
    expect(addable).not.toContain('wellbeing')
  })
})
