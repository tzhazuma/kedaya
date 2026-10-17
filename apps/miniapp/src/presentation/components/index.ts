/**
 * 可复用组件（契约 §7 `presentation/components`）。
 *
 * 全部组件只从设计令牌取值（`$kdy-*`），且都不含业务逻辑 —— 业务组件放各自页面目录下。
 */
export { KdyAccordion } from './KdyAccordion'
export type { KdyAccordionProps } from './KdyAccordion'

export { KdyBuddyPrivacyNotice } from './KdyBuddyPrivacyNotice'
export type { KdyBuddyPrivacyNoticeProps } from './KdyBuddyPrivacyNotice'

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

export {
  CAMPUS_CREDENTIAL_NOTICE_DEFAULT,
  KdyCampusCredentialNotice,
} from './KdyCampusCredentialNotice'
export type { KdyCampusCredentialNoticeProps } from './KdyCampusCredentialNotice'

export { KdyEmpty } from './KdyEmpty'
export type { KdyEmptyMode, KdyEmptyProps } from './KdyEmpty'

export { KdyEthicsNotice } from './KdyEthicsNotice'
export type { KdyEthicsNoticeProps } from './KdyEthicsNotice'

export { KdyPrivacyNotice } from './KdyPrivacyNotice'
export type { KdyPrivacyNoticeProps } from './KdyPrivacyNotice'

export { KdySearchBar } from './KdySearchBar'
export type { KdySearchBarProps } from './KdySearchBar'

export { KdySwitch } from './KdySwitch'
export type { KdySwitchProps } from './KdySwitch'

export { KdyTag } from './KdyTag'
export type { KdyTagProps, KdyTagTone } from './KdyTag'

export { KdyField } from './KdyField'
export type { KdyFieldProps, KdyFieldType } from './KdyField'

export { KdyPicker } from './KdyPicker'
export type {
  KdyDatePickerProps,
  KdyPickerMode,
  KdyPickerProps,
  KdySelectorPickerProps,
  KdyTimePickerProps,
} from './KdyPicker'

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

export { KdyListSkeleton } from './KdyListSkeleton'
export type { KdyListSkeletonProps } from './KdyListSkeleton'

export { KdyModuleIcon } from './KdyModuleIcon'
export type { KdyModuleIconTone } from './KdyModuleIcon'

export { KdyMascot } from './KdyMascot'
export type { KdyMascotProps } from './KdyMascot'

export { KdyProgress } from './KdyProgress'
export type { KdyProgressProps } from './KdyProgress'

export { KdyShareEntry } from './KdyShareEntry'
export type { KdyShareEntryProps } from './KdyShareEntry'
