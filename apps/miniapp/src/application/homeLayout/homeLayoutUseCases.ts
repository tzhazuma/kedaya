import {
  DEFAULT_HOME_ENTRY_IDS,
  MAX_HOME_ENTRY_IDS,
  addableHomeEntryIds,
  homeEntryById,
  isHomeEntryId,
  isLockedHomeEntry,
  normalizeHomeEntryIds,
} from '../../domain/models/homeEntries'
import type { HomeEntry } from '../../domain/models/homeEntries'
import type { CachePort } from '../../domain/ports/cachePort'

/**
 * 「首页展示哪些内容」用例（首页宫格 + `我的 → 首页管理`）。
 *
 * ## 与「隐私与数据」相反的一条规则
 *
 * 隐私开关**绝不乐观更新**（"以为关掉了其实没关"不可接受）；首页布局
 * 则**允许乐观更新**：它只是本机的界面状态，写入失败最坏是「下次进来自定义没生效」，
 * 用户当下看到的宫格立刻变好才是对的。因此这里同步写缓存、同步通知订阅者，
 * 不做 loading / busy 态 —— 点一下就该立刻动。
 *
 * ## 为什么按用户分片
 *
 * 同一台手机上换账号是真实场景（家庭成员、宿舍同学的手机）。缓存 key 里拼 `viewerId`：
 * 换号后 `hydrate()` 发现 key 变了会**重读一次**，而不是把上一个人的常用服务留在首页。
 *
 * ## 为什么要有 `hydrate()` 与 `load()` 的区分
 *
 * 这里没有服务端调用（偏好只存本机），所以 `hydrate()` 就是全部：
 * 契约 §8 的第 1 步（同步读缓存）在这里直接就是终态。页面在 `useDidShow` 里调用它，
 * 保证从「首页管理」页改完返回首页时立刻是新布局。
 */

export interface HomeLayoutState {
  /** 首页当前展示的入口 id（已规范化：含固定入口、去重、截断） */
  ids: readonly string[]
  /** 是否已经读过一次缓存（false 只出现在首帧之前） */
  hydrated: boolean
  /** 当前缓存 key 对应的用户（`null` = 未登录，匿名一份） */
  viewerId: string | null
}

export interface HomeLayoutUseCase {
  getSnapshot(): HomeLayoutState
  subscribe(listener: () => void): () => void
  /** 同步读缓存（幂等；换用户会重读）。返回最新状态，便于页面直接拿来渲染。 */
  hydrate(): HomeLayoutState
  /** 首页要渲染的入口（顺序即展示顺序） */
  selectedEntries(): readonly HomeEntry[]
  /** 「首页管理」页的「可添加」列表 */
  addableEntries(): readonly HomeEntry[]
  /** 是否已达上限（UI 用它禁用「添加」并给出说明，而不是点了没反应） */
  canAdd(): boolean
  /** 增 / 删一个入口（已在首页则移除，否则添加） */
  toggle(id: string): LayoutActionResult
  /** 上移 / 下移（`-1` 向上，`1` 向下；固定入口不可移动） */
  move(id: string, direction: -1 | 1): LayoutActionResult
  /** 恢复默认布局 */
  reset(): LayoutActionResult
  /** 用户是否改过（用于「恢复默认」的禁用态与文案） */
  isCustomized(): boolean
}

export interface LayoutActionResult {
  ok: boolean
  message: string
}

export interface HomeLayoutUseCaseDeps {
  cache: CachePort
  /** 当前登录用户（`null` = 未登录）；做成函数以便登录/登出后立刻生效 */
  viewerId: () => string | null
  /** 缓存 key 由装配层给（application 不得 import `data/**`） */
  cacheKeyFor: (viewerId: string | null) => string
}

export function createHomeLayoutUseCase(deps: HomeLayoutUseCaseDeps): HomeLayoutUseCase {
  const { cache, viewerId, cacheKeyFor } = deps

  let state: HomeLayoutState = { ids: DEFAULT_HOME_ENTRY_IDS, hydrated: false, viewerId: null }
  const listeners = new Set<() => void>()

  function patch(next: Partial<HomeLayoutState>): HomeLayoutState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  /** 把 id 列表写回缓存并更新状态（唯一的写入点） */
  function commit(ids: readonly string[]): HomeLayoutState {
    const normalized = normalizeHomeEntryIds([...ids])
    cache.write(cacheKeyFor(viewerId()), normalized)
    return patch({ ids: normalized, hydrated: true, viewerId: viewerId() })
  }

  function current(): readonly string[] {
    return state.ids
  }

  function hasRoom(): boolean {
    return current().length < MAX_HOME_ENTRY_IDS
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate(): HomeLayoutState {
      const viewer = viewerId()
      // 读过同一个人 → 直接返回（幂等，页面每次 useDidShow 都会调）
      if (state.hydrated && state.viewerId === viewer) return state

      const cached = cache.read<unknown>(cacheKeyFor(viewer))
      return patch({
        ids: normalizeHomeEntryIds(cached),
        hydrated: true,
        viewerId: viewer,
      })
    },
    selectedEntries(): readonly HomeEntry[] {
      return state.ids
        .map((id) => homeEntryById(id))
        .filter((entry): entry is HomeEntry => entry !== undefined)
    },
    addableEntries(): readonly HomeEntry[] {
      return addableHomeEntryIds(current())
        .map((id) => homeEntryById(id))
        .filter((entry): entry is HomeEntry => entry !== undefined)
    },
    canAdd: hasRoom,
    toggle(id: string): LayoutActionResult {
      if (!isHomeEntryId(id)) return { ok: false, message: '这个服务已经不在契约里了' }

      const selected = current()
      const isSelected = selected.includes(id)

      if (isSelected) {
        if (isLockedHomeEntry(id)) {
          const entry = homeEntryById(id)
          const reason = entry?.lockedReason ?? '固定入口'
          return {
            ok: false,
            message: `${entry?.label ?? id} 固定在首页，不能移除（${reason}）`,
          }
        }
        commit(selected.filter((item) => item !== id))
        return { ok: true, message: '已从首页移除' }
      }

      if (!hasRoom()) {
        return { ok: false, message: `首页最多放 ${MAX_HOME_ENTRY_IDS} 个服务，先移除一个再添加` }
      }

      commit([...selected, id])
      return { ok: true, message: '已添加到首页' }
    },
    move(id: string, direction: -1 | 1): LayoutActionResult {
      const selected = [...current()]
      const index = selected.indexOf(id)

      if (index === -1) return { ok: false, message: '这个服务不在首页上' }
      if (isLockedHomeEntry(id)) return { ok: false, message: '固定入口不参与排序' }

      const target = index + direction
      // 固定入口永远在最前面：普通入口不能越过它们
      const firstMovable = selected.filter((item) => isLockedHomeEntry(item)).length
      if (target < firstMovable || target >= selected.length) {
        return { ok: false, message: direction === -1 ? '已经排在最前了' : '已经排在最后了' }
      }

      const neighbour = selected[target]
      selected[target] = id
      selected[index] = neighbour as string
      commit(selected)
      return { ok: true, message: direction === -1 ? '已上移' : '已下移' }
    },
    reset(): LayoutActionResult {
      commit(DEFAULT_HOME_ENTRY_IDS)
      return { ok: true, message: '已恢复默认首页' }
    },
    isCustomized(): boolean {
      const selected = current()
      return (
        selected.length !== DEFAULT_HOME_ENTRY_IDS.length ||
        selected.some((id, index) => id !== DEFAULT_HOME_ENTRY_IDS[index])
      )
    },
  }
}
