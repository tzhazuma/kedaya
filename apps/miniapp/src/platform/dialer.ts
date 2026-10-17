import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 拨号。
 *
 * **为什么必须走平台层**：这是危机出口上唯一的"行动"按钮，
 * 页面直接用 `Taro.makePhoneCall` 会让三种失败（端不支持 / 用户取消 / 真的拨不出去）
 * 在同一层被压成一个 catch，UI 只能一律报错 —— 而"用户点了取消"报错是错的。
 *
 * - **微信小程序**：`Taro.makePhoneCall` 会弹系统确认框，**用户确认后才拨出**。
 *   因此调用方**不要**再加一层自己的确认弹层：紧急场景多一步确认就是成本。
 * - **H5 降级**：Taro 走 `tel:` 链接；桌面浏览器没有拨号能力 → `UNSUPPORTED`，
 *   调用方应展示号码让用户手动拨（不要假装拨出去了）。
 * - 用户在系统确认框点「取消」→ `REJECTED`：这是正常操作，调用方**应静默**。
 */
export async function makePhoneCall(number: string): Promise<PlatformResult<string>> {
  const trimmed = number.trim()
  if (trimmed === '') {
    return err({ code: 'REJECTED', message: '没有可拨打的号码' })
  }

  if (!isWeapp) {
    return err({ code: 'UNSUPPORTED', message: '当前环境不支持直接拨号，请手动拨打' })
  }

  try {
    await Taro.makePhoneCall({ phoneNumber: trimmed })
    return ok(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 微信在用户取消时 reject `makePhoneCall:fail cancel`；
    // 把它归到 REJECTED，UI 才不会为"用户自己点的取消"弹一条错误。
    const cancelled = message.toLowerCase().includes('cancel')
    return err({ code: cancelled ? 'REJECTED' : 'FAILED', message: cancelled ? '已取消' : message })
  }
}
