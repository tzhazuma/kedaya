import { ok, type Result } from '@kedaya/shared'

import type { AuthTokens, UserProfile } from '../../domain/models/session'
import { MOCK_NOW_ISO, MOCK_PROFILE } from './fixtures'

/**
 * Mock 登录 —— 骨架占位。
 *
 * 真实流程（契约 §5）：小程序 `wx.login` → code → 后端换 KedaYa JWT，
 * 校园系统绑定另走 `CampusSessionPort`。这里只伪造一份**形状合法**的 token，
 * 让「参团需要登录」这条链路在无后端时可演示。
 */

export interface MockSignInResult {
  tokens: AuthTokens
  profile: UserProfile
}

export function createMockSignIn(now: () => Date = () => new Date(MOCK_NOW_ISO)) {
  let counter = 0

  return function signIn(): Result<MockSignInResult, string> {
    counter += 1
    const issuedAt = now().getTime()
    return ok({
      tokens: {
        accessToken: `mock-access-${counter}`,
        refreshToken: `mock-refresh-${counter}`,
        expiresAt: new Date(issuedAt + 2 * 3_600_000).toISOString(),
      },
      profile: { ...MOCK_PROFILE },
    })
  }
}
