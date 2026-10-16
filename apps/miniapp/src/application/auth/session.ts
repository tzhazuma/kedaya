import { isAccessTokenExpired, isAuthenticated } from '../../domain/models/session'
import type { AuthTokens, Session, UserProfile } from '../../domain/models/session'
import type { SessionStorePort } from '../../domain/ports/sessionPort'

/**
 * 会话用例 —— presentation 访问身份状态的唯一入口。
 *
 * 契约 §5：这里只处理**第一级身份层**（KedaYa JWT）。
 * 「已登录但未绑定校园系统」是合法状态（`profile.campusBound === false`），
 * 此时校园功能应由后端返回 `CAMPUS_BINDING_REQUIRED`。
 */

export interface SessionUseCase {
  getSnapshot(): Session
  subscribe(listener: () => void): () => void
  /** 契约 §8 第 1 步：同步 hydrate */
  hydrate(): Session
  isAuthenticated(): boolean
  /** access token 是否已过期（或即将过期），决定是否需要在后台刷新 */
  needsRefresh(): boolean
  signIn(tokens: AuthTokens, profile: UserProfile): Session
  markCampusBound(bound: boolean): Session
  signOut(): void
}

export interface SessionUseCaseOptions {
  /** 提前多少毫秒视为「即将过期」 */
  refreshLeewayMs?: number
  now?: () => Date
}

export function createSessionUseCase(
  store: SessionStorePort,
  options: SessionUseCaseOptions = {},
): SessionUseCase {
  const { refreshLeewayMs = 60_000, now = () => new Date() } = options

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    hydrate: () => store.read(),

    isAuthenticated(): boolean {
      return isAuthenticated(store.getSnapshot())
    },

    needsRefresh(): boolean {
      const tokens = store.getSnapshot().tokens
      if (tokens === null) return false
      const current = now()
      if (isAccessTokenExpired(tokens, current)) return true
      const expiresAt = new Date(tokens.expiresAt).getTime()
      return expiresAt - current.getTime() <= refreshLeewayMs
    },

    signIn(tokens: AuthTokens, profile: UserProfile): Session {
      store.setTokens(tokens)
      return store.setProfile(profile)
    },

    markCampusBound(bound: boolean): Session {
      const profile = store.getSnapshot().profile
      if (profile === null) return store.getSnapshot()
      return store.setProfile({ ...profile, campusBound: bound })
    },

    signOut(): void {
      store.signOut()
    },
  }
}
