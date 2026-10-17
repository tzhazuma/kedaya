import { Text, View } from '@tarojs/components'
import DatetimePicker from '@taroify/core/datetime-picker'
import '@taroify/core/datetime-picker/style'
import Picker from '@taroify/core/picker'
import '@taroify/core/picker/style'
import Popup from '@taroify/core/popup'
import '@taroify/core/popup/style'
import { ArrowDown } from '@taroify/icons'
import { useState } from 'react'

import './index.scss'

/**
 * KdyPicker —— 弹出式取值控件（`selector` / `date` / `time`），放在 `KdyField` 里当控件用。
 *
 * ## 为什么不用 Taro 的 `<Picker>`
 *
 * `apps/miniapp/AGENTS.md` 与 ESLint 都规定 presentation 层不得直接引入
 * `@tarojs/components` 的原始表单控件（`Input` / `Textarea` / `Picker` / `Switch` …）。
 * 标准控件要么是 Taroify，要么是 Kdy 封装 —— 这里用 Taroify 的
 * `Popup` + `Picker` / `DatetimePicker` 组合成**受控的**取值控件：
 *
 * ```tsx
 * <KdyField label='地点' required>
 *   <KdyPicker range={CAMPUS_AREAS} value={placeIndex} onChange={setPlaceIndex} />
 * </KdyField>
 *
 * <KdyField label='日期' required>
 *   <KdyPicker mode='date' min='2026-10-17' value={date} onChange={setDate} />
 * </KdyField>
 * ```
 *
 * ## 三种模式的取值语义
 *
 * | mode       | `value`                    | `onChange` 收到              |
 * | ---------- | -------------------------- | ---------------------------- |
 * | `selector` | 选中**索引**（`-1` = 未选）| 新索引 `number`              |
 * | `date`     | `'YYYY-MM-DD'`             | 新日期字符串                 |
 * | `time`     | `'HH:mm'`                  | 新时间字符串                 |
 *
 * `selector` 刻意用索引而不是字符串：`range` 里出现同名选项时（例如两个
 * 「其他」），按值反查会选错项，索引唯一且稳定。
 */

export type KdyPickerMode = 'selector' | 'date' | 'time'

export interface KdyPickerBaseProps {
  /** 未选择时的占位文案 */
  placeholder?: string
  disabled?: boolean
}

export interface KdySelectorPickerProps extends KdyPickerBaseProps {
  mode?: 'selector'
  /** 选项文案（数组顺序即索引） */
  range: readonly string[]
  /** 当前选中索引；`-1` 或省略表示「还没选」 */
  value?: number
  /** 弹层标题（默认「请选择」） */
  title?: string
  onChange: (index: number) => void
}

export interface KdyDatePickerProps extends KdyPickerBaseProps {
  mode: 'date'
  /** `'YYYY-MM-DD'` */
  value?: string
  /** 可选下界，`'YYYY-MM-DD'` */
  min?: string
  onChange: (date: string) => void
}

export interface KdyTimePickerProps extends KdyPickerBaseProps {
  mode: 'time'
  /** `'HH:mm'` */
  value?: string
  onChange: (time: string) => void
}

export type KdyPickerProps =
  | KdySelectorPickerProps
  | KdyDatePickerProps
  | KdyTimePickerProps

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** `'YYYY-MM-DD'` → `Date`（按本地字段组装，往返一致） */
function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return undefined
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined
  return new Date(year, month - 1, day)
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `'HH:mm'` → `Date`（只用到时分） */
function parseTime(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined
  const [hour, minute] = value.split(':').map(Number)
  if (hour === undefined || minute === undefined) return undefined
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface TriggerProps {
  text?: string
  placeholder: string
  disabled: boolean
  onOpen: () => void
}

function KdyPickerTrigger({ text, placeholder, disabled, onOpen }: TriggerProps) {
  const empty = text === undefined || text === ''
  return (
    <View
      className={`kdy-picker__trigger${disabled ? ' kdy-picker__trigger--disabled' : ''}`}
      onClick={disabled ? undefined : onOpen}
    >
      <Text className={empty ? 'kdy-picker__placeholder' : 'kdy-picker__value'}>
        {empty ? placeholder : text}
      </Text>
      <ArrowDown className='kdy-picker__arrow' />
    </View>
  )
}

function KdySelectorPicker({
  range,
  value,
  onChange,
  placeholder = '请选择',
  title = '请选择',
  disabled = false,
}: KdySelectorPickerProps) {
  const [open, setOpen] = useState(false)
  const index = value === undefined ? -1 : value
  const selected = index >= 0 && index < range.length ? range[index] : undefined

  // Taroify 的 Picker 用字符串值；这里把索引转成字符串，避免同名选项互相覆盖。
  const columns = range.map((label, itemIndex) => ({ label, value: String(itemIndex) }))

  return (
    <View className='kdy-picker'>
      <KdyPickerTrigger
        text={selected}
        placeholder={placeholder}
        disabled={disabled}
        onOpen={() => {
          setOpen(true)
        }}
      />
      <Popup
        open={open}
        placement='bottom'
        rounded
        onClose={() => {
          setOpen(false)
        }}
      >
        <Picker
          title={title}
          columns={columns}
          value={String(index >= 0 && index < range.length ? index : 0)}
          onCancel={() => {
            setOpen(false)
          }}
          onConfirm={(values) => {
            const picked = Array.isArray(values) ? values[0] : values
            const nextIndex = Number(picked)
            if (Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < range.length) {
              onChange(nextIndex)
            }
            setOpen(false)
          }}
        />
      </Popup>
    </View>
  )
}

function KdyDatePicker({
  value,
  min,
  onChange,
  placeholder = '请选择日期',
  disabled = false,
}: KdyDatePickerProps) {
  const [open, setOpen] = useState(false)
  const current = parseDate(value)

  return (
    <View className='kdy-picker'>
      <KdyPickerTrigger
        text={value}
        placeholder={placeholder}
        disabled={disabled}
        onOpen={() => {
          setOpen(true)
        }}
      />
      <Popup
        open={open}
        placement='bottom'
        rounded
        onClose={() => {
          setOpen(false)
        }}
      >
        <DatetimePicker
          type='date'
          value={current}
          min={parseDate(min)}
          onCancel={() => {
            setOpen(false)
          }}
          onConfirm={(date) => {
            onChange(formatDate(date))
            setOpen(false)
          }}
        />
      </Popup>
    </View>
  )
}

function KdyTimePicker({
  value,
  onChange,
  placeholder = '请选择时间',
  disabled = false,
}: KdyTimePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <View className='kdy-picker'>
      <KdyPickerTrigger
        text={value}
        placeholder={placeholder}
        disabled={disabled}
        onOpen={() => {
          setOpen(true)
        }}
      />
      <Popup
        open={open}
        placement='bottom'
        rounded
        onClose={() => {
          setOpen(false)
        }}
      >
        <DatetimePicker
          type='time'
          value={parseTime(value)}
          onCancel={() => {
            setOpen(false)
          }}
          onConfirm={(date) => {
            onChange(formatTime(date))
            setOpen(false)
          }}
        />
      </Popup>
    </View>
  )
}

export function KdyPicker(props: KdyPickerProps) {
  if (props.mode === 'date') return <KdyDatePicker {...props} />
  if (props.mode === 'time') return <KdyTimePicker {...props} />
  return <KdySelectorPicker {...props} />
}

export default KdyPicker
