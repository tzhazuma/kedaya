import type { Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'

/**
 * 通用「详情用例」骨架。
 *
 * 详情页比列表简单，但仍有三件事必须做对，否则每个模块都会重复踩：
 *   1. 三种状态齐全（loading / ready / error），且错误态带可读文案；
 *   2. **领域动作**（预定、接单、加入、认领、标记售出 …）成功后要用服务端返回的
 *      最新实体替换本地详情，而不是乐观改本地字段 —— 后端的校验结果才是真相；
 *   3. 动作失败要保留原详情（不能因为一次预定失败就把整页清空）。
 *
 * 因此这里暴露 `mutate()`：把它包在动作外面，成功即刷新、失败即原样保留并返回错误。
 */

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface DetailState<T> {
  status: DetailStatus
  data: T | null
  error: string | null
  /** 是否有动作正在执行（按钮 loading 用） */
  mutating: boolean
}

export interface DetailUseCase<T> {
  getSnapshot(): DetailState<T>
  subscribe(listener: () => void): () => void
  /** 拉取详情；同一 id 可重复调用（下拉刷新） */
  load(id: string): Promise<DetailState<T>>
  /** 用已知数据直接填充（列表页点进来时可以先秒开，再后台刷新） */
  seed(data: T): DetailState<T>
  /**
   * 执行一个领域动作：成功 → 用返回的实体替换详情；失败 → 保留原详情并挂上错误。
   * 返回 `Result` 便于页面决定跳转 / 弹提示。
   */
  mutate(action: () => Promise<Result<T, RepositoryError>>): Promise<Result<T, RepositoryError>>
  reset(): void
}

const INITIAL: DetailState<never> = {
  status: 'idle',
  data: null,
  error: null,
  mutating: false,
}

export function createDetailUseCase<T>(fetch: (id: string) => Promise<Result<T, RepositoryError>>): DetailUseCase<T> {
  let state: DetailState<T> = INITIAL
  const listeners = new Set<() => void>()

  function patch(next: Partial<DetailState<T>>): DetailState<T> {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    seed(data: T): DetailState<T> {
      return patch({ status: 'ready', data, error: null })
    },

    async load(id: string): Promise<DetailState<T>> {
      patch({ status: state.data === null ? 'loading' : 'ready', error: null })
      const result = await fetch(id)
      if (!result.ok) {
        // 已有的详情不清空 —— 一次刷新失败不该把用户正在看的内容弄丢
        return patch({
          status: state.data === null ? 'error' : 'ready',
          error: result.error.message,
        })
      }
      return patch({ status: 'ready', data: result.value, error: null })
    },

    async mutate(action: () => Promise<Result<T, RepositoryError>>) {
      patch({ mutating: true, error: null })
      const result = await action()
      if (!result.ok) {
        patch({ mutating: false, error: result.error.message })
        return result
      }
      patch({ mutating: false, status: 'ready', data: result.value, error: null })
      return result
    },

    reset(): void {
      state = INITIAL
      for (const listener of listeners) listener()
    },
  }
}
