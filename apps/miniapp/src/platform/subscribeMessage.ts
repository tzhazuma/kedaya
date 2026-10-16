import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 订阅消息。
 *
 * - **微信小程序特有**：底层是 `wx.requestSubscribeMessage`。
 *   硬约束：必须在**用户点击**的同步调用栈里发起；用户必须点「允许」才会下发。
 *   一次性订阅 = 允许一次只能推一条，所以每次关键动作都要重新申请。
 * - **H5 降级**：微信订阅消息在 H5 无对应能力 → 返回 `UNSUPPORTED`，
 *   UI 应改为展示「站内信」并引导用户到小程序内开启。
 */

/** 模板 ID 集中在此登记（真实项目应从后端配置下发，避免写死在端上） */
export const SUBSCRIBE_TEMPLATES = {
  /** 拼单成团通知 */
  groupBuyFull: 'TMPL_GROUPBUY_FULL_PLACEHOLDER',
  /** 拼单即将截止 */
  groupBuyDeadline: 'TMPL_GROUPBUY_DEADLINE_PLACEHOLDER',
} as const

export async function requestSubscribeMessage(
  templateIds: readonly string[],
): Promise<PlatformResult<string[]>> {
  if (templateIds.length === 0) {
    return err({ code: 'FAILED', message: '没有配置订阅消息模板 ID' })
  }

  if (!isWeapp()) {
    return err({
      code: 'UNSUPPORTED',
      message: '当前端不支持微信订阅消息，请在小程序内开启通知',
    })
  }

  try {
    // Taro 4.3 的 requestSubscribeMessage 类型把微信的 `tmplIds` 与支付宝的 `entityIds`
    // 合并成了「都必填」（多端类型生成所致）。weapp 只需要 tmplIds，
    // 这里显式收窄一次并注明原因，而不是用 `as any` 掩盖类型问题。
    type SubscribeOption = Parameters<typeof Taro.requestSubscribeMessage>[0]
    const option = { tmplIds: [...templateIds] } as unknown as SubscribeOption

    const result = await Taro.requestSubscribeMessage(option)
    const decisions = result as unknown as Record<string, unknown>
    const accepted = templateIds.filter((id) => decisions[id] === 'accept')

    if (accepted.length === 0) {
      return err({ code: 'REJECTED', message: '你拒绝了订阅消息，可在小程序设置里重新开启' })
    }
    return ok(accepted)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '订阅消息调用失败',
    })
  }
}
