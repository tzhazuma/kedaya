import { useState } from 'react'

import { getContainer } from '../../app/container'
import { PAGE_PATHS } from '../../app/routes'
import { navigateTo, toast } from '../../platform/navigation'
import { backAfterAuthSuccess } from '../pages/auth/backAfterAuthSuccess'

/**
 * 微信一键登录 / 注册的页面编排。
 *
 * 抽成 hook 的原因：登录页与注册页都提供「微信快捷入口」，
 * 而这段流程有四步（取凭证 → 调用例 → 首次建号则去完善资料 → 否则回原页），
 * 复制两份必然会有一天改漏一份。
 *
 * 注意 hook 只做**编排**：校验与落盘都在用例层（`application/auth/authAccount.ts`）。
 */
export interface WechatAuthController {
  pending: boolean
  error: string | null
  /** 一键登录；`from='register'` 时文案改成「注册」口径 */
  loginWithWechat: () => Promise<void>
  clearError: () => void
}

export function useWechatAuth(): WechatAuthController {
  const auth = getContainer().useCases.auth
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loginWithWechat(): Promise<void> {
    if (pending) return
    setError(null)
    setPending(true)

    const result = await auth.loginWithWechat()
    setPending(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    const { isNewUser, simulated } = result.value
    if (simulated) {
      // 明确标注：开发模式下的 openid 是本地模拟的，不能当成真实微信身份
      toast('开发模式：微信身份为本地模拟', 'none')
    }

    if (isNewUser) {
      // 首次微信登录：兜底昵称是「微信用户xxxx」，引导用户补上真实昵称与头像
      await navigateTo(`${PAGE_PATHS.profileEdit}?from=wechat`)
      return
    }

    toast('欢迎回来鸭', 'success')
    await backAfterAuthSuccess()
  }

  return { pending, error, loginWithWechat, clearError: () => setError(null) }
}
