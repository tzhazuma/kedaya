/**
 * presentation/components 导出面。
 * 组件一律使用 design-tokens 派生的工具类（bg-brand / text-ink / rounded-lg …），
 * **不得出现手写色值**。
 */
export { KdyCard, type KdyCardProps, type KdyCardTone } from './KdyCard';
export { KdyButton, type KdyButtonProps, type KdyButtonVariant } from './KdyButton';
export { KdyBadge, type KdyBadgeProps, type KdyBadgeTone } from './KdyBadge';
export { KdyEmpty, type KdyEmptyProps } from './KdyEmpty';
export { KdySkeleton, KdyCardSkeleton, type KdySkeletonProps } from './KdySkeleton';
export { KdyAlert, type KdyAlertProps, type KdyAlertTone } from './KdyAlert';
export { ModuleGrid, ModuleGridItem, type ModuleGridProps } from './ModuleGrid';
export { PageHeader, type PageHeaderProps } from './PageHeader';
export { SiteHeader } from './SiteHeader';
export { SiteFooter } from './SiteFooter';
export { UnofficialNotice } from './UnofficialNotice';
export { MODULE_ICONS, moduleIcon, type KdyIcon } from './icons';
