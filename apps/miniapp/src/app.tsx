import { useLaunch } from '@tarojs/taro'
import type { PropsWithChildren } from 'react'

import './app.scss'
import { bootstrapSync, refreshInBackground } from './app/bootstrap'
import { getContainer } from './app/container'

/**
 * 小程序根组件 —— 启动时序（契约 §8）的装配点。
 *
 * ```
 * useLaunch
 *   ├─ bootstrapSync(container)        ← 第 1 步：同步 hydrate（禁止网络）
 *   │     └─ 返回后页面立刻渲染缓存数据  ← 第 2 步
 *   └─ refreshInBackground(container)  ← 第 3 步：不 await，失败静默降级
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
  })

  return <>{children}</>
}

export default App
