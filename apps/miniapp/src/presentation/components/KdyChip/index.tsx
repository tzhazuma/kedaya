import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyChip —— 可点击的筛选/选择胶囊。
 *
 * 六个模块的列表页都需要「一行可选筛选项」（分类、状态、排序…），
 * 所以收敛成一个组件：既当筛选器（`active` 表示选中），也能当表单里的
 * 单选控件（分类选择、成色选择）。它只用 `View/Text`，
 * 因此不属于 Taroify 管制的表单控件（AGENTS 限制的是 `@tarojs/components`
 * 的 Input / Button / Picker 等**原生表单控件**）。
 */
export interface KdyChipProps {
  children?: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}

export function KdyChip({ children, active = false, disabled = false, onClick, className }: KdyChipProps) {
  const classes = [
    'kdy-chip',
    active ? 'kdy-chip--active' : '',
    disabled ? 'kdy-chip--disabled' : '',
    className ?? '',
  ]
    .filter((item) => item !== '')
    .join(' ')

  return (
    <View
      className={classes}
      onClick={() => {
        if (!disabled && onClick !== undefined) onClick()
      }}
    >
      <Text className='kdy-chip__text'>{children}</Text>
    </View>
  )
}

export default KdyChip
