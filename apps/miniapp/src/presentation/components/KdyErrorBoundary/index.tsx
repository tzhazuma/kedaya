import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { KdyButton } from '../KdyButton'
import { KdyMascot } from '../KdyMascot'
import './index.scss'

/**
 * KdyErrorBoundary —— 页面级「兜底」，保证**任何渲染异常都不会变成白屏**。
 *
 * ## 为什么必须有它
 *
 * 小程序渲染期抛错（空值访问、接口字段变了、某个组件在特定机型上崩）会把
 * React 树整棵卸载 —— 用户看到的是**一片空白**：没有标题、没有文字、点哪里都没反应。
 * 这是最糟的故障形态：用户不知道是自己手机的问题还是应用坏了，
 * 客服也拿不到任何信息（因为错误只打在用户自己的 vConsole 里）。
 *
 * 有了边界之后，故障形态变成「一个明确的说明 + 两个能出去的动作 + 一条已上报的记录」。
 *
 * ## 两件容易被忽略的事
 *
 * 1. **自动上报**：`componentDidCatch` 里把 message/stack/当前页面报给后端。
 *    没有这一步，"兜底页"只是把白屏换成了一张好看的静止画面。
 * 2. **导航后自动复位**：否则用户从坏页面跳到好页面，看到的还是那张兜底页 ——
 *    于是"能出去的动作"也变成了死路。见 `resetErrorBoundary()`。
 */

/** 供 `app.tsx` 在路由变化时复位（模块级引用：边界实例不对外暴露） */
let activeReset: (() => void) | null = null

export function resetErrorBoundary(): void {
  activeReset?.()
}

export interface KdyErrorBoundaryProps {
  children?: ReactNode
  /** 出错时的附加说明（默认给一句通用文案） */
  hint?: string
}

interface KdyErrorBoundaryState {
  hasError: boolean
}

export class KdyErrorBoundary extends Component<KdyErrorBoundaryProps, KdyErrorBoundaryState> {
  override state: KdyErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): KdyErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidMount(): void {
    activeReset = () => {
      this.setState((previous) => (previous.hasError ? { hasError: false } : previous))
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /**
     * 上报放在 try/catch 里：**兜底机制自己再抛错**会把错误边界也带走，
     * 那就真的白屏了（React 会直接抛出边界之外）。
     */
    try {
      getContainer().telemetry.report({
        kind: 'render-error',
        message: error.message.length > 0 ? error.message : '渲染异常',
        ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
        ...(typeof info.componentStack === 'string' && info.componentStack.length > 0
          ? { context: { componentStack: info.componentStack.slice(0, 200) } }
          : {}),
      })
    } catch {
      /* 上报失败无所谓，重要的是把兜底页显示出来 */
    }
  }

  override componentWillUnmount(): void {
    activeReset = null
  }

  private readonly handleRetry = (): void => {
    // 单纯重渲染：多数渲染异常来自"某次数据恰好是坏的"，重试即恢复
    this.setState({ hasError: false })
  }

  private readonly handleHome = (): void => {
    // 先复位再跳：否则 reLaunch 后如果目标页也渲染失败，兜底页会"粘"在新页面上
    this.setState({ hasError: false })
    void Taro.reLaunch({ url: PAGE_PATHS.home })
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <View className='kdy-error-boundary'>
        <KdyMascot size={72} className='kdy-error-boundary__glyph' />
        <Text className='kdy-error-boundary__title'>这个页面没能打开</Text>
        <Text className='kdy-error-boundary__desc'>
          {this.props.hint ?? '已经自动把问题记下来了，我们会尽快修。你可以重试，或回到首页。'}
        </Text>
        <View className='kdy-error-boundary__actions'>
          <KdyButton block onClick={this.handleRetry}>
            重试
          </KdyButton>
          <View className='kdy-error-boundary__secondary'>
            <KdyButton block variant='secondary' onClick={this.handleHome}>
              返回首页
            </KdyButton>
          </View>
        </View>
      </View>
    )
  }
}
