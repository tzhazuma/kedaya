import { Text, View } from '@tarojs/components'
import Input from '@taroify/core/input'
import '@taroify/core/input/style'

import './index.scss'

/**
 * KdySearchBar —— 搜索框（FAQ 的分类 + 搜索）。
 *
 * 输入控件走 Taroify（`apps/miniapp/AGENTS.md`：presentation 层不得直接引入
 * `@tarojs/components` 的原始表单控件）；`confirmType='search'` 让微信键盘
 * 右下角显示「搜索」，符合小程序用户预期。
 * 颜色/尺寸全部来自设计令牌（契约 §6.2），不手写色值。
 */
export interface KdySearchBarProps {
  value: string
  placeholder?: string
  /** 每次输入都触发（受控组件语义） */
  onChange: (value: string) => void
  /** 用户点键盘「搜索」时触发 */
  onConfirm?: (value: string) => void
  /** 有值时显示「清空」 */
  onClear?: () => void
}

export function KdySearchBar({
  value,
  placeholder = '搜索',
  onChange,
  onConfirm,
  onClear,
}: KdySearchBarProps) {
  return (
    <View className='kdy-search'>
      <Input
        className='kdy-search__input'
        value={value}
        placeholder={placeholder}
        confirmType='search'
        onChange={(event) => onChange(String(event.detail.value ?? ''))}
        onConfirm={(event) => onConfirm?.(String(event.detail.value ?? ''))}
      />
      {value !== '' && onClear !== undefined && (
        <Text className='kdy-search__clear' onClick={onClear}>
          清空
        </Text>
      )}
    </View>
  )
}

export default KdySearchBar
