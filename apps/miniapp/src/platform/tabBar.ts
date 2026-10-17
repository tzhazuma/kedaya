import Taro from '@tarojs/taro'

import { PAGE_PATHS, tabBarIndex } from '../app/routes'

/**
 * tabBar 角标（站内信未读红点）。
 *
 * 三条约束：
 *   · 角标挂在**消息** tab 上，下标从 `routes.ts` 推导，不在平台层写死数字；
 *   · `setTabBarBadge` / `removeTabBarBadge` 在 H5 与部分基础库版本上会直接抛错，
 *     因此**必须**包 try/catch —— 红点失败绝不能影响页面渲染；
 *   · 微信角标文案上限约 4 个字符，超过 99 一律显示 `99+`（避免被截断成乱码）。
 *
 * 本文件是唯一允许调用 tabBar 角标 API 的地方（契约 §7：平台能力收敛在 `platform/**`）。
 */

const MESSAGES_INDEX = tabBarIndex(PAGE_PATHS.messages)

export function setUnreadBadge(count: number): void {
  if (MESSAGES_INDEX < 0) return
  try {
    if (count <= 0) {
      Taro.removeTabBarBadge({ index: MESSAGES_INDEX })
      return
    }
    Taro.setTabBarBadge({ index: MESSAGES_INDEX, text: count > 99 ? '99+' : String(count) })
  } catch {
    // H5 预览 / 旧基础库不支持角标：静默降级成"没有红点"
  }
}
