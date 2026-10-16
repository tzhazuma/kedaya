import { Text, View } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyField —— 表单字段容器（标签 + 说明 + 错误 + 输入控件）。
 *
 * 只负责布局与错误展示，**不**持有值：输入控件由调用方作为 children 传入，
 * 这样 `Input` / `Textarea` 都能复用同一套外观。
 */
export interface KdyFieldProps {
  label: string
  /** 计数/说明（例如「0/100」） */
  hint?: string
  /** 校验错误；有值时整块标红 */
  error?: string
  required?: boolean
  children?: ReactNode
}

export function KdyField({ label, hint, error, required = false, children }: KdyFieldProps) {
  return (
    <View className={`kdy-field${error === undefined ? '' : ' kdy-field--error'}`}>
      <View className='kdy-field__head'>
        <Text className='kdy-field__label'>
          {required ? '＊' : ''}
          {label}
        </Text>
        {hint !== undefined && <Text className='kdy-field__hint'>{hint}</Text>}
      </View>
      <View className='kdy-field__control'>{children}</View>
      {error !== undefined && <Text className='kdy-field__error'>{error}</Text>}
    </View>
  )
}

export default KdyField
