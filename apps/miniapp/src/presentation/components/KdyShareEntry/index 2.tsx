import { View } from '@tarojs/components'
import { FriendsOutlined } from '@taroify/icons'

import { KdyButton } from '../KdyButton'
import './index.scss'

/**
 * KdyShareEntry —— 详情页底部的「分享给好友」。
 *
 * ## 为什么必须是一个 `<Button open-type="share">`
 *
 * 微信**不允许**代码静默分享：转发只能由用户点击 `open-type="share"` 的按钮
 * （或右上角胶囊）触发。所以这里不能是「一个带 `onClick` 的 View」——
 * 那样点了不会有任何反应，而且开发者工具里不报错，上线前不容易发现。
 * `KdyButton` 已经把 `openType` 透传出来了，用它是最不容易写错的写法。
 *
 * ## 为什么转发文案留在页面里，不在这里
 *
 * 转发标题要带**内容本身**（「【闲置】出一台 iPad · 可达鸭」），而内容属于页面状态。
 * 组件只管按钮长什么样，`useShareAppMessage` 留在页面 ——
 * 也顺便避免了「这个组件被用在页面之外时 hook 无处安放」。
 *
 * ## 它排在举报入口**上面**
 *
 * 两条都是低强调的页尾工具行，但顺序有含义：分享是「让更多同学看到」，
 * 举报是「这一条有问题」。把举报放在最后一行，是不让它落在视线的第一落点。
 */
export interface KdyShareEntryProps {
  className?: string
}

export function KdyShareEntry({ className }: KdyShareEntryProps) {
  return (
    <View className={['kdy-share-entry', className ?? ''].filter((item) => item !== '').join(' ')}>
      <KdyButton size='sm' variant='ghost' openType='share'>
        <FriendsOutlined className='kdy-share-entry__glyph' />
        分享给好友
      </KdyButton>
    </View>
  )
}
