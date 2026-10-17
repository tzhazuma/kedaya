import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { DEV_WECHAT_CODE_PREFIX } from '../domain/ports/wechatPort'
import type { WechatCodePort, WechatCodeRequest } from '../domain/ports/wechatPort'
import type { RepositoryError } from '../domain/ports/errors'
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

/* ------------------------------------------------------------------ *
 * 账号体系的微信快捷登录端口（`WechatCodePort`）
 *
 * 与上面的 `requestWechatLoginCode` 是**同一条链路的两层**：
 *   · `requestWechatLoginCode` 是平台原子能力（取一次性 code，失败即失败）；
 *   · `createWechatCodePort` 在其上加「服务端是否配置了真实密钥」的策略 ——
 *     真实链路走 `Taro.login()`，开发链路退回稳定的 `dev:<设备标识>`，
 *     因此「同一台设备反复登录 = 同一个账号」，可完整演示
 *     「首次注册 → 完善资料 → 再次登录 → 绑定/解绑」。
 * ------------------------------------------------------------------ */

const DEVICE_ID_KEY = 'kedaya.wechat.deviceId'

/** 读取（或首次生成）本地设备标识。存储不可用时退回本次会话内稳定的随机值 */
function readDeviceId(): string {
  try {
    const cached = Taro.getStorageSync(DEVICE_ID_KEY)
    if (typeof cached === 'string' && cached.length > 0) return cached
  } catch {
    // 存储被禁用：继续用随机 id，不阻塞登录
  }

  const id = `ui-${Math.random().toString(36).slice(2, 10)}`
  try {
    Taro.setStorageSync(DEVICE_ID_KEY, id)
  } catch {
    // 同上：写不进去也不影响本次流程
  }
  return id
}

function failure(message: string): RepositoryError {
  return { code: 'UNKNOWN', message }
}

export function createWechatCodePort(): WechatCodePort {
  return {
    async requestCode({ preferReal }) {
      if (preferReal && isWeapp()) {
        try {
          const result = await Taro.login()
          const code = result?.code
          if (typeof code === 'string' && code.length > 0) {
            return ok({ code, simulated: false } satisfies WechatCodeRequest)
          }
          return err(failure('微信登录失败：未拿到凭证，请确认小程序 AppID 已正确配置'))
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误'
          return err(failure(`微信登录失败：${message}`))
        }
      }

      return ok({
        code: `${DEV_WECHAT_CODE_PREFIX}${readDeviceId()}`,
        simulated: true,
      } satisfies WechatCodeRequest)
    },
  }
}
