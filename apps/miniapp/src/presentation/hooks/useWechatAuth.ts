import { useState } from 'react'

import { getContainer } from '../../app/container'
import { toast } from '../../platform/navigation'
import { backAfterAuthSuccess } from '../pages/auth/backAfterAuthSuccess'

/**
 * 微信一键登录 / 注册的页面编排。
 *
 * 抽成 hook 的原因：登录页与注册页都提供「微信一键登录」，
 * 而这段流程有三步（取凭证 → 调用例 → 回原页），复制两份必然会有一天改漏一份。
 *
 * 注意 hook 只做**编排**：校验与落盘都在用例层（`application/auth/authAccount.ts`）。
 *
 * ## 为什么不再跳「完善资料」
 *
 * 以前的流程是「首次登录 → 跳 profile/edit?from=wechat → 用户按保存 → 才算登录完成」。
 * 那一步在用户眼里就是一个**登录关卡**：点了一键登录，却还要再填一次、再按一次按钮，
 * 而且填完之后回到的是"我的"而不是他本来要做的事。
 *
 * 昵称与头像在微信侧本来就拿不到（必须由用户主动点 `chooseAvatar` / `type='nickname'`），
 * 所以它天然是**可以后补**的动作，不该挡在登录中间。现在：
 *   · 一键登录成功即进入已登录状态，直接回到用户原来要去的地方；
 *   · 昵称与头像随时可以在「我的 → 编辑资料」里补。
 */
export interface WechatAuthController {
  pending: boolean
  error: string | null
  /** 一键登录 / 注册（两者是同一段流程，只是文案口径不同） */
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
      // 开发模式下的 openid 是本地模拟的，不能冒充真实微信身份（只在 Mock 下出现）
      toast('开发模式：微信身份为本地模拟', 'none')
    } else {
      toast(isNewUser ? '账号已建好，欢迎加入' : '欢迎回来鸭', 'success')
    }

    await backAfterAuthSuccess()
  }

  return { pending, error, loginWithWechat, clearError: () => setError(null) }
}
