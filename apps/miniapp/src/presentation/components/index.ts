/**
 * 可复用组件（契约 §7 `presentation/components`）。
 *
 * 四个基础组件全部只从设计令牌取值，且都不含业务逻辑 —— 业务组件放各自页面目录下。
 */
export { KdyButton } from './KdyButton'
export type {
  ChooseAvatarDetail,
  KdyButtonOpenType,
  KdyButtonProps,
  KdyButtonSize,
  KdyButtonVariant,
} from './KdyButton'

export { KdyAvatar } from './KdyAvatar'
export type { KdyAvatarProps } from './KdyAvatar'

export { KdyCard } from './KdyCard'
export type { KdyCardProps } from './KdyCard'

export { KdyEmpty } from './KdyEmpty'
export type { KdyEmptyMode, KdyEmptyProps } from './KdyEmpty'

export { KdyTag } from './KdyTag'
export type { KdyTagProps, KdyTagTone } from './KdyTag'

export { KdyField } from './KdyField'
export type { KdyFieldProps, KdyFieldType } from './KdyField'

export { KdyChip } from './KdyChip'
export type { KdyChipProps } from './KdyChip'

export { KdyAgentFab, agentPathWithContext } from './KdyAgentFab'
export type { KdyAgentFabProps } from './KdyAgentFab'

export { KdyImageUploader } from './KdyImageUploader'
export type { KdyImageUploaderProps } from './KdyImageUploader'

export { KdyImageGallery, KdyImageThumb } from './KdyImageGallery'
export type { KdyImageGalleryProps, KdyImageThumbProps } from './KdyImageGallery'

export { KdyErrorBoundary, resetErrorBoundary } from './KdyErrorBoundary'
export type { KdyErrorBoundaryProps } from './KdyErrorBoundary'

export { KdyReportSheet } from './KdyReportSheet'
export type { KdyReportSheetProps } from './KdyReportSheet'

export { KdyReportEntry } from './KdyReportEntry'
export type { KdyReportEntryProps } from './KdyReportEntry'
