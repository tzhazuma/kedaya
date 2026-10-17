import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isH5, isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 分享。
 *
 * - **微信小程序**：分享**不能由代码静默触发**。
 *   唯一两条合法路径：
 *   1. 用户点击 `<Button open-type="share">`（触发页面 `onShareAppMessage`）
 *   2. 用户点右上角胶囊里的「转发」（需先 `wx.showShareMenu` 打开菜单项）
 *   因此本模块提供的是「构造分享参数 + 打开转发菜单」，而不是「替他分享」。
 * - **H5 降级**：优先 `navigator.share`（原生分享面板）；
 *   不支持时降级为复制链接到剪贴板。
 */

export interface SharePayload {
  title: string
  /** 小程序内的绝对路径，例如 `/presentation/pages/groupbuy/detail/index?id=gb-1001` */
  path: string
  imageUrl?: string
}

/** 小程序分享路径：原样返回（Taro 的 path 必须是 `/` 开头的应用内路径） */
export function buildSharePath(payload: SharePayload): string {
  return payload.path.startsWith('/') ? payload.path : `/${payload.path}`
}

/** H5 分享链接：补上 origin，便于直接粘到聊天窗口 */
export function buildShareLink(payload: SharePayload, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${buildSharePath(payload)}`
}

/** 打开右上角「转发」菜单项（仅小程序；H5 无此概念，静默成功） */
export async function enableShareMenu(): Promise<PlatformResult<true>> {
  if (!isWeapp()) return ok(true)
  try {
    // Taro 4.3 把微信的 `menus` 统一命名为 `showShareItems`（多端合并后的字段名）
    await Taro.showShareMenu({
      withShareTicket: true,
      showShareItems: ['shareAppMessage', 'shareTimeline'],
    })
    return ok(true)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '打开转发菜单失败',
    })
  }
}

export type ShareChannel = 'native' | 'clipboard' | 'weapp-menu'

/**
 * H5 端「尽力分享」。
 * 小程序端不适用（返回 `weapp-menu`，提示调用方走 open-type="share" 按钮）。
 */
export async function shareToFriend(payload: SharePayload): Promise<PlatformResult<ShareChannel>> {
  if (isWeapp()) {
    // 小程序不允许静默分享，调用方必须改用 <Button open-type="share">
    return ok('weapp-menu')
  }

  if (isH5() && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const origin = typeof location !== 'undefined' ? location.origin : ''
      await navigator.share({ title: payload.title, url: buildShareLink(payload, origin) })
      return ok('native')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 用户取消分享面板不算失败
      if (/abort|cancel/i.test(message)) return err({ code: 'REJECTED', message: '已取消分享' })
      // 其他错误继续走剪贴板降级
    }
  }

  return copyToClipboard(payload)
}

/** 复制分享链接（最后一级降级，H5 与小程序都可用） */
export async function copyToClipboard(payload: SharePayload): Promise<PlatformResult<ShareChannel>> {
  try {
    const origin = typeof location !== 'undefined' ? location.origin : ''
    const link = isWeapp() ? buildSharePath(payload) : buildShareLink(payload, origin)
    await Taro.setClipboardData({ data: `${payload.title} ${link}` })
    return ok('clipboard')
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '复制失败',
    })
  }
}
