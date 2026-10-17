import { Text, View } from '@tarojs/components'
import Field from '@taroify/core/field'
import Input from '@taroify/core/input'
import '@taroify/core/field/style'
import '@taroify/core/input/style'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyField —— 统一输入行（Taroify `Field` + `Input` 的薄封装）。
 *
 * 为什么必须封装：
 *   · `apps/miniapp/AGENTS.md` 规定表单控件统一走 Taroify，
 *     禁止页面直接用 `@tarojs/components` 的 `Input`（ESLint 已强制）；
 *   · Taroify 的 `Input.onChange` 回调签名是 `(event) => void`，
 *     页面里到处写 `e.detail.value` 既啰嗦又容易写错；
 *     这里收敛成 `onChange(value: string)`，让页面只关心字符串。
 *
 * `type='nickname'` 是微信的「昵称填写」能力：用户点击输入框时，
 * 微信键盘会给出「使用微信昵称」的快捷填入（配合 `open-type='chooseAvatar'`
 * 就是官方推荐的注册/完善资料表单）。
 */

export type KdyFieldType = 'text' | 'number' | 'digit' | 'idcard' | 'nickname'

export interface KdyFieldProps {
  label?: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: KdyFieldType
  /** 密码输入（微信键盘不记忆、不回显） */
  password?: boolean
  maxLength?: number
  /** 错误提示。有值时整行变红并展示该文案 */
  error?: string | null
  /** 辅助说明（无错误时展示） */
  hint?: ReactNode
  disabled?: boolean
  className?: string
}

export function KdyField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  password = false,
  maxLength,
  error,
  hint,
  disabled = false,
  className,
}: KdyFieldProps) {
  return (
    <View className={['kdy-field', error ? 'kdy-field--error' : '', className ?? ''].filter(Boolean).join(' ')}>
      <Field
        className='kdy-field__inner'
        label={label}
        feedback={error ?? undefined}
        disabled={disabled}
      >
        <Input
          className='kdy-field__input'
          value={value}
          type={type}
          password={password}
          placeholder={placeholder}
          disabled={disabled}
          clearable
          {...(maxLength === undefined ? {} : { maxlength: maxLength })}
          onChange={(event) => {
            onChange(String(event.detail.value ?? ''))
          }}
        />
      </Field>
      {error === undefined || error === null ? (
        hint === undefined ? null : <Text className='kdy-field__hint'>{hint}</Text>
      ) : null}
    </View>
  )
}

export default KdyField
