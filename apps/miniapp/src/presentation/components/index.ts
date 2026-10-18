/**
 * 可复用组件（契约 §7 `presentation/components`）。
 *
 * 基础组件只从设计令牌取值，且不包含业务逻辑 —— 业务组件放各自页面目录下。
 */
export { KdyButton } from './KdyButton'
export type {
  KdyButtonOpenType,
  KdyButtonProps,
  KdyButtonSize,
  KdyButtonVariant,
} from './KdyButton'

export { KdyCard } from './KdyCard'
export type { KdyCardProps } from './KdyCard'

export { KdyDock } from './KdyDock'
export type { KdyDockProps } from './KdyDock'

export { KdyFeatureArtwork } from './KdyFeatureArtwork'

export { KdyEmpty } from './KdyEmpty'
export type { KdyEmptyMode, KdyEmptyProps } from './KdyEmpty'

export { KdyTag } from './KdyTag'
export type { KdyTagProps, KdyTagTone } from './KdyTag'
