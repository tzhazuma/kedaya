import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyAccordion —— 手风琴条目（FAQ 列表）。
 *
 * 展开状态由**调用方**持有（受控组件）：页面可以据此实现「同时只展开一条」，
 * 组件本身不偷偷存状态，避免出现两个真相。
 */
export interface KdyAccordionProps {
  title: ReactNode
  /** 标题右侧的补充信息（分类、有用数等） */
  meta?: ReactNode
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}

export function KdyAccordion({ title, meta, expanded, onToggle, children }: KdyAccordionProps) {
  return (
    <View className={`kdy-accordion${expanded ? ' kdy-accordion--expanded' : ''}`}>
      <View className='kdy-accordion__head' onClick={onToggle}>
        <Text className='kdy-accordion__arrow'>{expanded ? '▾' : '▸'}</Text>
        <Text className='kdy-accordion__title'>{title}</Text>
        {meta !== undefined && <View className='kdy-accordion__meta'>{meta}</View>}
      </View>
      {expanded && <View className='kdy-accordion__body'>{children}</View>}
    </View>
  )
}

export default KdyAccordion
