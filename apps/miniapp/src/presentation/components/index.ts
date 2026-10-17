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
  KdyButtonOpenType,
  KdyButtonProps,
  KdyButtonSize,
  KdyButtonVariant,
} from './KdyButton'

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

export { KdyField } from './KdyField'
export type { KdyFieldProps } from './KdyField'

export { KdyPrivacyNotice } from './KdyPrivacyNotice'
export type { KdyPrivacyNoticeProps } from './KdyPrivacyNotice'

export { KdySearchBar } from './KdySearchBar'
export type { KdySearchBarProps } from './KdySearchBar'

export { KdySwitch } from './KdySwitch'
export type { KdySwitchProps } from './KdySwitch'

export { KdyTag } from './KdyTag'
export type { KdyTagProps, KdyTagTone } from './KdyTag'
