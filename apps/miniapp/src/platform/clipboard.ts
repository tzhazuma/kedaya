import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import type { PlatformResult } from './failure'

/**
 * 复制**纯文本**到剪贴板。
 *
 * 与 `share.ts` 的 `copyToClipboard` 的区别：那个是分享链接的降级通道
 * （会把标题与小程序路径拼成一句话再复制），这里的输入是调用方给的原文，
 * 用于「复制服务地址」「复制订单号」这类**不该被改写**的内容。
 *
 * - **微信小程序**：`Taro.setClipboardData`，微信自己会弹一个「内容已复制」提示，
 *   所以调用方**不要**再弹一次 toast，否则用户看到两条。
 * - **H5 降级**：Taro 在 H5 端内部降级为 `navigator.clipboard` /
 *   `document.execCommand`，两端行为一致。
 * - 不存在 `UNSUPPORTED` 分支：复制是两端都有的能力，失败只可能是调用出错。
 */
export async function copyText(text: string): Promise<PlatformResult<string>> {
  const trimmed = text.trim()
  if (trimmed === '') {
    return err({ code: 'REJECTED', message: '没有可复制的内容' })
  }

  try {
    await Taro.setClipboardData({ data: trimmed })
    return ok(trimmed)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '复制失败',
    })
  }
}
