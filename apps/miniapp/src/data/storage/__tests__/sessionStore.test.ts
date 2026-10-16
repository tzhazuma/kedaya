import { describe, expect, it } from 'vitest'

import { EMPTY_SESSION } from '../../../domain/models/session'
import type { AuthTokens } from '../../../domain/models/session'
import { StorageKeys } from '../keys'
import { createMemoryStorage } from '../memoryStorage'
import { createSessionStore, createTokenStore } from '../sessionStore'

/**
 * 会话存储测试 —— 契约 §8 第 1 步（同步 hydrate）与 §5（身份分层）的实现验收。
 *
 * 关键不变量：`getSnapshot()` 在无变更时必须返回**同一引用**，
 * 否则 React 的 `useSyncExternalStore` 会无限重渲染。
 */

const TOKENS: AuthTokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-10-16T14:00:00.000Z',
}

const PROFILE = {
  id: 'u-me',
  nickname: '可达鸭测试号',
  studentId: '20260001',
  campusBound: false,
}

describe('sessionStore · hydrate 与持久化', () => {
  it('空缓存 → EMPTY_SESSION（且不抛异常）', () => {
    const store = createSessionStore(createMemoryStorage())
    expect(store.read()).toEqual(EMPTY_SESSION)
  })

  it('缓存形状非法 → 退回 EMPTY_SESSION（防御旧版本 / 被篡改的缓存）', () => {
    const cache = createMemoryStorage({ [StorageKeys.session]: { tokens: 'oops' } })
    const store = createSessionStore(cache)
    expect(store.read()).toEqual(EMPTY_SESSION)
  })

  it('setTokens / setProfile 会写回缓存', () => {
    const cache = createMemoryStorage()
    const store = createSessionStore(cache)

    store.setTokens(TOKENS)
    store.setProfile(PROFILE)

    const persisted = cache.read<{ tokens: AuthTokens | null; profile: typeof PROFILE | null }>(
      StorageKeys.session,
    )
    expect(persisted?.tokens?.accessToken).toBe('access-1')
    expect(persisted?.profile?.nickname).toBe('可达鸭测试号')
  })

  it('缓存里已有会话时，read() 直接 hydrate 出登录态', () => {
    const cache = createMemoryStorage({
      [StorageKeys.session]: { tokens: TOKENS, profile: PROFILE },
    })
    const store = createSessionStore(cache)

    expect(store.getSnapshot().tokens?.accessToken).toBe('access-1')
    expect(store.getSnapshot().profile?.id).toBe('u-me')
  })

  it('setTokens(null) 只清 token，保留 profile（「已登录但未绑定」是合法状态）', () => {
    const store = createSessionStore(createMemoryStorage())
    store.setTokens(TOKENS)
    store.setProfile(PROFILE)

    const next = store.setTokens(null)

    expect(next.tokens).toBeNull()
    expect(next.profile?.id).toBe('u-me')
  })

  it('signOut 清空整个会话并从缓存里删除 key', () => {
    const cache = createMemoryStorage()
    const store = createSessionStore(cache)
    store.setTokens(TOKENS)
    store.setProfile(PROFILE)

    store.signOut()

    expect(store.getSnapshot()).toEqual(EMPTY_SESSION)
    expect(cache.read(StorageKeys.session)).toBeNull()
  })
})

describe('sessionStore · 快照引用稳定性', () => {
  it('未变更时 getSnapshot 返回同一引用', () => {
    const store = createSessionStore(createMemoryStorage())
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('变更后引用被替换', () => {
    const store = createSessionStore(createMemoryStorage())
    const before = store.getSnapshot()
    store.setTokens(TOKENS)
    expect(store.getSnapshot()).not.toBe(before)
  })

  it('订阅者在每次变更时收到通知，取消订阅后不再收到', () => {
    const store = createSessionStore(createMemoryStorage())
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })

    store.setTokens(TOKENS)
    expect(notified).toBe(1)

    store.setProfile(PROFILE)
    expect(notified).toBe(2)

    unsubscribe()
    store.signOut()
    expect(notified).toBe(2)
  })
})

describe('tokenStore（网络层视图）', () => {
  it('读写与 sessionStore 共享同一份状态', () => {
    const store = createSessionStore(createMemoryStorage())
    const tokens = createTokenStore(store)

    expect(tokens.getAccessToken()).toBeNull()

    tokens.setTokens(TOKENS)
    expect(tokens.getAccessToken()).toBe('access-1')
    expect(tokens.getRefreshToken()).toBe('refresh-1')
    // 同一个 store，会话视图立即可见
    expect(store.getSnapshot().tokens?.accessToken).toBe('access-1')
  })

  it('clear 只清 token', () => {
    const store = createSessionStore(createMemoryStorage())
    store.setProfile(PROFILE)
    const tokens = createTokenStore(store)
    tokens.setTokens(TOKENS)

    tokens.clear()

    expect(tokens.getAccessToken()).toBeNull()
    expect(store.getSnapshot().profile?.id).toBe('u-me')
  })
})
