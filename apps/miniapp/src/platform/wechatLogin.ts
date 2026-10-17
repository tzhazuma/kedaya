import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 微信登录凭证（`wx.login` 的一次性 code）。
 *
 * ## 为什么校园卡绑定需要它
 *
 * 校园卡走**独立的 OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦。
 * 绑定它需要的不是校园卡密码，而是「这个微信用户是谁」——
 * 也就是 **openid**。
 *
 * ## ⚠️ 客户端**拿不到** openid
 *
 * `wx.login` 只返回一个**一次性 code**（5 分钟有效，用后即焚）。
 * openid 必须由**服务端**用 `code2session` 换取（需要 AppSecret，
 * 客户端持有它是严重的安全事故）。
 *
 * 因此本适配器返回的是 **code**，字段名也刻意叫 `code` ——
 * 不让后来者误以为它是 openid。
 *
 * ## 平台差异
 *
 * - **微信小程序**：`Taro.login()` → `wx.login`。
 * - **H5**：没有微信登录能力 → `UNSUPPORTED`，UI 必须如实降级提示
 *   （而不是静默失败或假装成功）。
 */

export interface WechatLoginCode {
  /** 一次性 code（**不是** openid、**不是** session_key） */
  code: string
}

export async function requestWechatLoginCode(): Promise<PlatformResult<WechatLoginCode>> {
  if (!isWeapp()) {
    return err({
      code: 'UNSUPPORTED',
      message: '微信登录仅在微信小程序内可用；H5 端无法完成校园卡的 OPENID 绑定',
    })
  }

  try {
    const result = await Taro.login()
    const code = result.code
    if (typeof code !== 'string' || code === '') {
      return err({ code: 'FAILED', message: '微信没有返回登录凭证，请稍后重试' })
    }
    return ok({ code })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // ⚠️ 失败信息里**不带** code 本身：它是一次性凭证，不该进任何日志/上报
    return err({ code: 'FAILED', message: `微信登录失败：${message}` })
  }
}
