import { err, ok } from '@kedaya/shared'
import Taro from '@tarojs/taro'

import {
  DEV_WECHAT_CODE_PREFIX,
  type WechatCodePort,
  type WechatCodeRequest,
} from '../domain/ports/wechatPort'
import { isWeapp } from './env'
import type { RepositoryError } from '../domain/ports/errors'

/**
 * 微信登录凭证的**平台实现**。
 *
 * 真实链路（服务端配置了小程序密钥，且当前在微信内）：
 *   `Taro.login()` → code → 后端 `jscode2session` → openid
 *
 * 开发链路（其余情况）：
 *   返回稳定的 `dev:<设备标识>`。设备标识持久化在本地存储，
 *   因此「同一台设备反复登录 = 同一个账号」，可以完整演示
 *   「首次注册 → 完善资料 → 再次登录 → 绑定/解绑」。
 */

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
