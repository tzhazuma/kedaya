/**
 * 可复用组件（契约 §7 `presentation/components`）。
 *
 * 全部组件只从设计令牌取值（`$kdy-*`），且都不含业务逻辑 —— 业务组件放各自页面目录下。
 */
export { KdyAccordion } from './KdyAccordion'
export type { KdyAccordionProps } from './KdyAccordion'

export { KdyButton } from './KdyButton'
export type {
  KdyButtonOpenType,
  KdyButtonProps,
  KdyButtonSize,
  KdyButtonVariant,
} from './KdyButton'

export { KdyCard } from './KdyCard'
export type { KdyCardProps } from './KdyCard'

export { KdyEmpty } from './KdyEmpty'
export type { KdyEmptyMode, KdyEmptyProps } from './KdyEmpty'

export { KdyField } from './KdyField'
export type { KdyFieldProps } from './KdyField'

export { KdySearchBar } from './KdySearchBar'
export type { KdySearchBarProps } from './KdySearchBar'

export { KdySwitch } from './KdySwitch'
export type { KdySwitchProps } from './KdySwitch'

export { KdyTag } from './KdyTag'
export type { KdyTagProps, KdyTagTone } from './KdyTag'
