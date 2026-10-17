import { Text, View } from '@tarojs/components'

import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo } from '../../../platform/navigation'
import './index.scss'

/**
 * KdyAgentFab —— 可达鸭的**全局悬浮入口**。
 *
 * 「对小程序的全局可用性」是可达鸭这个功能的硬要求，但"全局"不等于
 * "每个页面塞一个聊天框"。这里的取舍是：
 *   · 悬浮球只占右下角一个 56px 的位置，不抢内容、不遮挡 tabBar；
 *   · 点它是**带上下文跳转**而不是就地弹窗 —— 把 `module` / `page` 一起带过去，
 *     这样 agent 一打开就知道"用户在课表页"，可以直接给出课表相关的事实与建议；
 *   · 页面若已有底部主操作栏（例如详情页的"联系"),用 `raised` 抬高，避免压住按钮。
 *
 * 为什么不挂在每个页面的布局里统一注入：Taro 的页面是各自独立的组件树，
 * 没有全局布局层。与其引入一个"全局样式注入 + 事件总线"的复杂机制，
 * 不如显式地在需要的页面引入本组件 —— 可见、可测、出问题一眼能定位。
 */
export interface KdyAgentFabProps {
  /** 当前模块 id（契约 §4），作为 agent 的上下文 */
  module?: string
  /** 当前页面路径，用于 agent 的上下文与建议问题 */
  page?: string
  /** 底部已有操作栏时抬高，避免遮挡 */
  raised?: boolean
  className?: string
}

/** 把上下文拼进 agent 页面参数（agent 页面用 `useRouter().params` 读取） */
export function agentPathWithContext(module?: string, page?: string): string {
  const query: string[] = []
  if (module !== undefined && module !== '') query.push(`module=${encodeURIComponent(module)}`)
  if (page !== undefined && page !== '') query.push(`page=${encodeURIComponent(page)}`)
  return query.length === 0 ? PAGE_PATHS.agent : `${PAGE_PATHS.agent}?${query.join('&')}`
}

export function KdyAgentFab({ module, page, raised = false, className }: KdyAgentFabProps) {
  const classes = ['kdy-agent-fab', raised ? 'kdy-agent-fab--raised' : '', className ?? '']
    .filter((item) => item !== '')
    .join(' ')

  return (
    <View
      className={classes}
      // 悬浮球本身不承载业务逻辑：它只负责"带着上下文去找可达鸭"
      onClick={() => void navigateTo(agentPathWithContext(module, page))}
    >
      <View className='kdy-agent-fab__ball'>
        <Text className='kdy-agent-fab__emoji'>🦆</Text>
        <Text className='kdy-agent-fab__label'>可达鸭</Text>
      </View>
    </View>
  )
}

export default KdyAgentFab
