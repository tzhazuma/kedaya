import { useSyncExternalStore } from 'react'

/**
 * 把用例层的外部 store 接到 React。
 *
 * 为什么用 `useSyncExternalStore`（React 18 起可用）而不是 `useState + useEffect`：
 * - 用例的 state 在**用例内部**演进（后台刷新、参团成功后更新），
 *   React 需要的是「订阅 + 快照」，而不是把状态抄一份到组件里。
 * - 它天然处理 tearing：同一个 store 被多个组件订阅时不会读到不一致的快照。
 *
 * 前提：`getSnapshot()` 必须在无变更时返回**同一个引用**
 * （`data/storage/sessionStore.ts` 与 `application/**` 的 store 都满足这一点）。
 */
export interface ExternalStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export function useStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
