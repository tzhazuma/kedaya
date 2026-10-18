import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyCard —— 基础卡片容器。
 *
 * 所有尺寸/颜色来自设计令牌（`$kdy-*`，由 sass.resource 全局注入），
 * 组件内**不得**出现手写色值（契约 §6.2）。
 */
export type KdyCardTone = 'plain' | 'pink' | 'mint' | 'yellow' | 'milk'

export interface KdyCardProps {
  title?: ReactNode
  /** 右上角附加内容（标签、操作等） */
  extra?: ReactNode
  children?: ReactNode
  onClick?: () => void
  className?: string
  /** 是否带阴影（列表里通常关闭以提升滚动性能） */
  elevated?: boolean
  /**
   * 卡面档位 —— 贴纸簿的「一整块淡色面」。
   *
   * - `plain`（默认）：白卡 + 手绘墨色轮廓，列表里十几张一起出现的常规卡；
   * - `pink` / `mint` / `yellow` / `milk`：**功能卡**，一整个淡色面。
   *   淡面上只用墨色文字（见 tokens.scss 的说明）。
   *
   * 什么时候用淡色：这张卡是「一眼看去是什么」的**入口 / 主视觉**
   * （首页的凑凑、服务大厅的分组、详情页的汇总块）。
   * 什么时候不用：它只是承载表单或列表行 —— 一屏十张淡色卡会变成调色盘，
   * 而且淡底上的输入框、分隔线都会糊掉。
   */
  tone?: KdyCardTone
}

export function KdyCard({
  title,
  extra,
  children,
  onClick,
  className,
  elevated = true,
  tone = 'plain',
}: KdyCardProps) {
  const classes = [
    'kdy-card',
    elevated ? 'kdy-card--elevated' : '',
    tone === 'plain' ? '' : `kdy-card--${tone}`,
    className ?? '',
  ]
    .filter((item) => item !== '')
    .join(' ')

  const hasHeader = title !== undefined || extra !== undefined

  /**
   * 可点击的卡片要有**按下反馈**（`hoverClass`）。
   * 没有反馈的卡片在真机上会让人怀疑"我到底点到了没有"，
   * 于是用户会连点两下 —— 而第二下可能正好落在跳转后的页面上。
   * 不可点击的卡片传 `none`：不能给出"可点"的假信号。
   */
  return (
    <View
      className={classes}
      onClick={onClick}
      hoverClass={onClick === undefined ? 'none' : 'kdy-card--pressed'}
      hoverStayTime={70}
    >
      {hasHeader && (
        <View className='kdy-card__header'>
          {title !== undefined && <Text className='kdy-card__title'>{title}</Text>}
          {extra !== undefined && <View className='kdy-card__extra'>{extra}</View>}
        </View>
      )}
      <View className='kdy-card__body'>{children}</View>
    </View>
  )
}

export default KdyCard
