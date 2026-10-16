import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyCard —— 基础卡片容器。
 *
 * 所有尺寸/颜色来自设计令牌（`$kdy-*`，由 sass.resource 全局注入），
 * 组件内**不得**出现手写色值（契约 §6.2）。
 */
export interface KdyCardProps {
  title?: ReactNode
  /** 右上角附加内容（标签、操作等） */
  extra?: ReactNode
  children?: ReactNode
  onClick?: () => void
  className?: string
  /** 是否带阴影（列表里通常关闭以提升滚动性能） */
  elevated?: boolean
}

export function KdyCard({
  title,
  extra,
  children,
  onClick,
  className,
  elevated = true,
}: KdyCardProps) {
  const classes = ['kdy-card', elevated ? 'kdy-card--elevated' : '', className ?? '']
    .filter((item) => item !== '')
    .join(' ')

  const hasHeader = title !== undefined || extra !== undefined

  return (
    <View className={classes} onClick={onClick}>
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
