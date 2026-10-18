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

export { KdyDock } from './KdyDock'
export type { DockTab, KdyDockProps } from './KdyDock'

/** 功能卡里的立绘（凑凑 = 布袋、野生居民 = 爪印），由 `assets/campus/*.png` 提供 */
export { KdyFeatureArtwork } from './KdyFeatureArtwork'

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

/**
 * 圆环 / 条形进度（营养管家）。
 *
 * 与上面的 `KdyProgress` 并存而不是替换：`KdyProgress` 是 Taroify 的线性进度条，
 * 用于通用加载/进度场景；`KdyRing` 是营养管家的热量主视觉（双半盘旋转实现的
 * 圆环），营养页面的六项逐项条用 `KdyBar`。
 */
export { KdyBar, KdyRing } from './KdyRing'
export type { KdyBarProps, KdyRingProps, KdyRingTone } from './KdyRing'

export { KdyShareEntry } from './KdyShareEntry'
export type { KdyShareEntryProps } from './KdyShareEntry'

/**
 * 校园底图（真实校园 GIS 栅格，替代原生 `<map>`）。
 *
 * 观测点 / 区域圈 / 推断轨迹三条叠加层全在这里渲染，坐标系一律 **GCJ-02**
 * （与 `<map>` 时代一致，页面继续用 `buildMapOverlays()` 输出）。
 * 底图与投影数据来自 `@kedaya/contracts` 的 `campus-map` 模块。
 */
export { KdyCampusMap } from './KdyCampusMap'
export type {
  KdyCampusMapCircle,
  KdyCampusMapMarker,
  KdyCampusMapPolyline,
  KdyCampusMapProps,
} from './KdyCampusMap'
