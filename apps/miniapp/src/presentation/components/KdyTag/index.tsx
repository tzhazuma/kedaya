import { Text } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyTag —— 状态标签。
 *
 * `tone` 与设计令牌的语义色一一对应，页面不要自己拼色值。
 */
export type KdyTagTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface KdyTagProps {
  children?: ReactNode
  tone?: KdyTagTone
  className?: string
}

export function KdyTag({ children, tone = 'neutral', className }: KdyTagProps) {
  const classes = ['kdy-tag', `kdy-tag--${tone}`, className ?? '']
    .filter((item) => item !== '')
    .join(' ')

  return <Text className={classes}>{children}</Text>
}

export default KdyTag
