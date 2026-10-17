import type { ApiError } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type { AuthTokens, Session, UserProfile } from '../models/session'

/**
 * 会话持久化端口 —— 同步读写（契约 §8 启动时序第 1 步禁止网络）。
 */
export interface SessionPort {
  read(): Session
  persist(session: Session): void
  clear(): void
}

/**
 * Token 读写端口 —— 给网络层用，粒度比 `SessionPort` 更细，
 * 保证「刷新后的 token」能立刻写回，而不必整体重写会话。
 */
export interface TokenStorePort {
  getAccessToken(): string | null
  getRefreshToken(): string | null
  setTokens(tokens: AuthTokens): void
  /** 只清 token，保留 profile（契约 §5：「已登录但未绑定」是合法状态） */
  clear(): void
}

/**
 * Token 刷新端口。
 *
 * 刻意与 `ApiClient` 解耦：刷新请求本身不能再走「401 自动刷新重试」的路径，
 * 否则会形成循环依赖。实现见 `data/api/authRefresh.ts`（直接用 `HttpPort`）。
 */
export interface AuthRefresherPort {
  refresh(refreshToken: string): Promise<Result<AuthTokens, ApiError>>
}

/** 会话变更订阅（供 React 的 useSyncExternalStore 使用） */
export type SessionListener = () => void

export interface SessionStorePort extends SessionPort {
  subscribe(listener: SessionListener): () => void
  /**
   * 引用稳定的快照 —— `useSyncExternalStore` 的硬要求：
   * 未发生变更时必须返回**同一个引用**，否则会无限重渲染。
   */
  getSnapshot(): Session
  /** tokens 传 null = 清除登录态（保留 profile） */
  setTokens(tokens: AuthTokens | null): Session
  setProfile(profile: UserProfile | null): Session
  signOut(): Session
}
