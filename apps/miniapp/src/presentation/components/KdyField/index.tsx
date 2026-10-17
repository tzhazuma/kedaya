import { Text, View } from '@tarojs/components'
import Input from '@taroify/core/input'
import '@taroify/core/input/style'
import Textarea from '@taroify/core/textarea'
import '@taroify/core/textarea/style'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyField —— 统一表单字段（**标签在上、控件在下**，全站一致）。
 *
 * **两种用法（同一组件、同一种布局）**：
 *
 * 1. **值模式**（默认，推荐）：把 `value` / `onChange` 交给它，
 *    内部渲染 Taroify `Input`（`multiline` 时为 `Textarea`）。
 *    页面里不必写 `e.detail.value`，也不必 import 任何原始输入控件。
 *
 *    ```tsx
 *    <KdyField label='标题' required value={title} onChange={setTitle} maxLength={30} />
 *    <KdyField label='正文' multiline value={body} onChange={setBody} />
 *    ```
 *
 * 2. **容器模式**：传 `children` 时控件由调用方给出（例如 `KdyPicker`、
 *    `KdyImageUploader`）。这不是「绕开规范」的出口 ——
 *    `apps/miniapp/AGENTS.md` 与 ESLint 仍然禁止在页面里直接引入
 *    `@tarojs/components` 的原始表单控件。
 *
 * `type='nickname'` 是微信的「昵称填写」能力：用户点击输入框时，
 * 微信键盘会给出「使用微信昵称」的快捷填入（配合 `open-type='chooseAvatar'`
 * 就是官方推荐的注册/完善资料表单）。
 */

export type KdyFieldType = 'text' | 'number' | 'digit' | 'idcard' | 'nickname'

export interface KdyFieldProps {
  // ---- 布局 ----
  label?: ReactNode
  /** 辅助说明（显示在标签右侧；有错误时仍保留） */
  hint?: ReactNode
  /** 校验错误；有值时控件框标红并展示该文案 */
  error?: string | null
  required?: boolean
  disabled?: boolean
  className?: string

  // ---- 值模式 ----
  value?: string
  onChange?: (value: string) => void
  /**
   * 键盘「完成 / 搜索」键回调（值即当前输入内容）。
   *
   * 与 `onChange` 同一取值口径（给值不给事件）：搜索框按键盘搜索键直接触发，
   * 用户不必再去点按钮。`multiline` 下无意义（多行没有确认键）。
   */
  onConfirm?: (value: string) => void
  placeholder?: string
  type?: KdyFieldType
  /** 密码输入（微信键盘不记忆、不回显） */
  password?: boolean
  maxLength?: number
  /** 多行文本（Taroify Textarea） */
  multiline?: boolean

  // ---- 容器模式 ----
  children?: ReactNode
}

export function KdyField(props: KdyFieldProps) {
  const {
    label,
    hint,
    error,
    required = false,
    disabled = false,
    className,
    value,
    onChange,
    onConfirm,
    placeholder,
    type = 'text',
    password = false,
    maxLength,
    multiline = false,
    children,
  } = props

  const hasError = error !== undefined && error !== null && error !== ''
  const classes = [
    'kdy-field',
    hasError ? 'kdy-field--error' : '',
    className ?? '',
  ]
    .filter((item) => item !== '')
    .join(' ')

  const lengthLimit = maxLength === undefined ? {} : { maxlength: maxLength }

  const control =
    children !== undefined ? (
      children
    ) : multiline ? (
      <Textarea
        className='kdy-field__input kdy-field__textarea'
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        {...lengthLimit}
        onChange={(event) => {
          onChange?.(String(event.detail.value ?? ''))
        }}
      />
    ) : (
      <Input
        className='kdy-field__input'
        value={value}
        type={type}
        password={password}
        placeholder={placeholder}
        disabled={disabled}
        clearable={!password}
        {...lengthLimit}
        onChange={(event) => {
          onChange?.(String(event.detail.value ?? ''))
        }}
        onConfirm={(event) => {
          onConfirm?.(String(event.detail.value ?? ''))
        }}
      />
    )

  return (
    <View className={classes}>
      <View className='kdy-field__head'>
        <Text className='kdy-field__label'>
          {required ? '＊' : ''}
          {label}
        </Text>
        {hint !== undefined && hint !== null && <Text className='kdy-field__hint'>{hint}</Text>}
      </View>
      <View className='kdy-field__control'>{control}</View>
      {hasError && <Text className='kdy-field__error'>{error}</Text>}
    </View>
  )
}

export default KdyField
