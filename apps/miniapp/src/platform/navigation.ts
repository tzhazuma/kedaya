import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isTabBarPath } from '../app/routes'
import type { PlatformResult } from './failure'

/**
 * 路由跳转。
 *
 * 平台差异：
 * - weapp：`wx.navigateTo` 最多 10 层页面栈；`wx.switchTab` 只能跳 tabBar 页。
 * - H5：Taro Router 用 history API，行为基本一致，但**浏览器前进/后退**会让
 *   「页面栈深度」的假设失效 —— 因此这里不暴露 `getCurrentPages` 相关能力。
 */

export async function navigateTo(path: string): Promise<PlatformResult<true>> {
  try {
    // tabBar 页面必须用 switchTab，否则微信会直接报错
    if (isTabBarPath(path)) {
      await Taro.switchTab({ url: path.split('?')[0] ?? path })
    } else {
      await Taro.navigateTo({ url: path })
    }
    return ok(true)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '页面跳转失败',
    })
  }
}

export async function redirectTo(path: string): Promise<PlatformResult<true>> {
  try {
    await Taro.redirectTo({ url: path })
    return ok(true)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '页面重定向失败',
    })
  }
}

export async function navigateBack(delta = 1): Promise<PlatformResult<true>> {
  try {
    await Taro.navigateBack({ delta })
    return ok(true)
  } catch (error) {
    return err({
      code: 'FAILED',
      message: error instanceof Error ? error.message : '返回失败',
    })
  }
}

/** 轻提示（两端都支持） */
export function toast(title: string, icon: 'success' | 'error' | 'none' = 'none'): void {
  void Taro.showToast({ title, icon, duration: 1800 })
}

export function showLoading(title = '加载中'): void {
  void Taro.showLoading({ title, mask: true })
}

export function hideLoading(): void {
  void Taro.hideLoading()
}
