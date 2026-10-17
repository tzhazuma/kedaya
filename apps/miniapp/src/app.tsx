import { useLaunch } from '@tarojs/taro'
import Taro from '@tarojs/taro'
import type { PropsWithChildren } from 'react'

import './app.scss'
import { bootstrapSync, refreshInBackground } from './app/bootstrap'
import { getContainer } from './app/container'
import { KdyErrorBoundary, resetErrorBoundary } from './presentation/components'

/**
 * 小程序根组件 —— 启动时序（契约 §8）的装配点。
 *
 * ```
 * useLaunch
 *   ├─ bootstrapSync(container)        ← 第 1 步：同步 hydrate（禁止网络）
 *   │     └─ 返回后页面立刻渲染缓存数据  ← 第 2 步
 *   ├─ refreshInBackground(container)  ← 第 3 步：不 await，失败静默降级
 *   └─ 挂全局错误钩子                   ← 旁路：不改变上面任何一步
 * ```
 *
 * 注意 `refreshInBackground` 返回 void 而非 Promise：这是刻意的类型约束，
 * 防止后来者手滑 await 它，把启动变回「阻塞等待网络」。
 */
function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    const container = getContainer()
    bootstrapSync(container)
    refreshInBackground(container)

    /**
     * 全局错误钩子（`wx.onError` / `onUnhandledRejection` / `onPageNotFound`）。
     *
     * 这三类错误**不会**经过 React 的错误边界 —— 它们发生在组件树之外
     * （异步回调、定时器、事件处理函数里的未捕获 rejection）。
     * 不挂钩子的话，用户手机上的崩溃在服务端完全不可见，只能等用户来投诉。
     */
    container.telemetry.installGlobalHandlers()

    /**
     * 路由变化时复位错误边界。
     *
     * 不复位的话，用户从出错的页面跳到别的页面，看到的**还是那张兜底页** ——
     * 「返回首页」于是也成了死路。
     *
     * `onAppRoute` 需要基础库 2.11+，且 Taro 的类型定义里没有它，
     * 所以走一次显式收窄的探测；拿不到时只是失去自动复位（兜底页上的按钮仍然可用），
     * 不影响启动的任何一步。
     */
    const routeListener = Taro as unknown as {
      onAppRoute?: (callback: () => void) => void
    }
    try {
      routeListener.onAppRoute?.(() => {
        resetErrorBoundary()
      })
    } catch {
      /* 该环境不支持，兜底页按钮仍可用 */
    }
  })

  /**
   * 错误边界包在**最外层**：任何页面渲染期抛错都会退化成
   * 「一句说明 + 重试 / 返回首页」，而不是整屏空白。
   */
  return <KdyErrorBoundary>{children}</KdyErrorBoundary>
}

export default App
