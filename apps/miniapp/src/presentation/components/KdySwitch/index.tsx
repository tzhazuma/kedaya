import { Text, View } from '@tarojs/components'

import './index.scss'

/**
 * KdySwitch —— 开关（例如发帖页的「匿名发布」）。
 *
 * 刻意不用 Taro 的 `<Switch>`：原生 Switch 的 `color` 只能吃 JS 色值，
 * 而这个项目**禁止手写色值**、且样式统一由 SCSS 令牌驱动（契约 §6.2）。
 * 自绘开关让颜色回到 `.scss` 里的 `$kdy-color-*`，也更容易做无障碍与文案布局。
 */
export interface KdySwitchProps {
  checked: boolean
  /** 主文案（例如「匿名发布」） */
  label?: string
  /** 补充说明（例如隐私提示），会显示在开关左侧 */
  description?: string
  disabled?: boolean
  onChange?: (checked: boolean) => void
}

export function KdySwitch({
  checked,
  label,
  description,
  disabled = false,
  onChange,
}: KdySwitchProps) {
  const hasText = label !== undefined || description !== undefined

  return (
    <View
      className={`kdy-switch-row${disabled ? ' kdy-switch-row--disabled' : ''}`}
      onClick={
        disabled
          ? undefined
          : () => {
              onChange?.(!checked)
            }
      }
    >
      {hasText && (
        <View className='kdy-switch-row__text'>
          {label !== undefined && <Text className='kdy-switch-row__label'>{label}</Text>}
          {description !== undefined && (
            <Text className='kdy-switch-row__desc'>{description}</Text>
          )}
        </View>
      )}
      <View className={`kdy-switch${checked ? ' kdy-switch--on' : ''}`}>
        <View className='kdy-switch__knob' />
      </View>
    </View>
  )
}

export default KdySwitch
