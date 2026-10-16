import { EMPTY_SESSION, isSession } from '../../domain/models/session'
import type { AuthTokens, Session, UserProfile } from '../../domain/models/session'
import type { CachePort } from '../../domain/ports/cachePort'
import type { SessionListener, SessionStorePort, TokenStorePort } from '../../domain/ports/sessionPort'
import { StorageKeys } from './keys'

/**
 * 会话存储 —— 契约 §8 启动时序第 1 步的实现载体。
 *
 * 关键设计：**内存快照 + 引用稳定**。
 * `useSyncExternalStore` 要求 `getSnapshot()` 在无变更时返回同一引用，
 * 因此这里把 hydrate 结果缓存起来，只在变更时替换引用并通知订阅者。
 */
export function createSessionStore(cache: CachePort): SessionStorePort {
  let snapshot: Session | null = null
  const listeners = new Set<SessionListener>()

  function hydrate(): Session {
    if (snapshot !== null) return snapshot
    const raw = cache.read<unknown>(StorageKeys.session)
    snapshot = isSession(raw) ? raw : EMPTY_SESSION
    return snapshot
  }

  function commit(next: Session): Session {
    snapshot = next
    if (next.tokens === null && next.profile === null) {
      cache.remove(StorageKeys.session)
    } else {
      cache.write(StorageKeys.session, next)
    }
    for (const listener of listeners) listener()
    return next
  }

  return {
    read: hydrate,
    getSnapshot: hydrate,

    persist(session: Session): void {
      commit(session)
    },

    clear(): void {
      commit(EMPTY_SESSION)
    },

    subscribe(listener: SessionListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setTokens(tokens: AuthTokens | null): Session {
      return commit({ ...hydrate(), tokens })
    },

    setProfile(profile: UserProfile | null): Session {
      return commit({ ...hydrate(), profile })
    },

    signOut(): Session {
      return commit(EMPTY_SESSION)
    },
  }
}

/**
 * 把会话存储适配成网络层需要的 `TokenStorePort`。
 * 共享同一个 store，保证「刷新后的 token」立即落盘且 UI 同步可见。
 */
export function createTokenStore(session: SessionStorePort): TokenStorePort {
  /** 空字符串等同「没有」—— 后端/缓存里出现过空串，必须在这里收口，否则会拿空 token 发请求 */
  function readToken(pick: (tokens: AuthTokens) => string): string | null {
    const tokens = session.getSnapshot().tokens
    if (tokens === null) return null
    const value = pick(tokens)
    return value === '' ? null : value
  }

  return {
    getAccessToken: () => readToken((tokens) => tokens.accessToken),
    getRefreshToken: () => readToken((tokens) => tokens.refreshToken),
    setTokens: (tokens: AuthTokens) => {
      session.setTokens(tokens)
    },
    clear: () => {
      session.setTokens(null)
    },
  }
}
