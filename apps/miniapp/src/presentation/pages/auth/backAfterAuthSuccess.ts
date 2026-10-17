import Taro from '@tarojs/taro'

import { PAGE_PATHS } from '../../../app/routes'
import { navigateBack, navigateTo } from '../../../platform/navigation'

/**
 * 登录/注册成功后的返回逻辑。
 *
 * 场景：用户可能从「我的」点进登录页，也可能从「发布商品 → 需要登录」被拦进来。
 *   · 页面栈里还有上一页 → `navigateBack()`，回到原来的位置（不打断用户当前任务）；
 *   · 直接从登录页打开（栈里只有一页）→ 去「我的」，那里有账号信息与退出入口。
 *
 * H5 下 `getCurrentPages()` 可能不存在，因此整段逻辑要能容忍它缺席。
 */
export async function backAfterAuthSuccess(): Promise<void> {
  const pages = Taro.getCurrentPages?.() ?? []
  if (pages.length > 1) {
    await navigateBack()
    return
  }
  await navigateTo(PAGE_PATHS.profile)
}
