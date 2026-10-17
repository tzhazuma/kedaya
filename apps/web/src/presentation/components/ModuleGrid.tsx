import Link from 'next/link';

import type { ModuleAccent, PortalModule } from '@/domain/models/module';
import { deliveryStageLabel, type DeliveryStage } from '@/domain/models/delivery';

import { cn } from '../theme/cn';
import { moduleIcon } from './icons';
import { KdyBadge, type KdyBadgeTone } from './KdyBadge';

const ACCENT_CHIP: Record<ModuleAccent, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  info: 'bg-surface-alt text-info',
  success: 'bg-surface-alt text-success',
  warning: 'bg-surface-alt text-warning',
  danger: 'bg-surface-alt text-danger',
  neutral: 'bg-surface-alt text-muted',
};

const SENSITIVITY_TONE: Record<PortalModule['sensitivity'], KdyBadgeTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

/** 交付状态的角标语气：Web 已上线用品牌色（最醒目的"能用"信号） */
const DELIVERY_TONE: Record<DeliveryStage, KdyBadgeTone> = {
  web: 'brand',
  miniapp: 'info',
  'api-only': 'neutral',
};

const DELIVERY_TITLE: Record<DeliveryStage, string> = {
  web: 'Web 门户已有真实页面，可直接使用',
  miniapp: '已在微信小程序端上线；Web 端页面待做（点进去看交付说明）',
  'api-only': '后端接口已挂脚手架，两端页面都还没做',
};

export interface ModuleGridProps {
  /** 模块清单 —— 必须来自 `PORTAL_MODULES`（契约 §4：禁止硬编码） */
  modules: readonly PortalModule[];
  /** 是否展示一句话定义 */
  showSummary?: boolean;
  className?: string;
}

/**
 * 模块入口宫格 —— 数据驱动（`@/domain/models/modules`，当前 20 个）。
 * 组件本身对模块数量与内容零假设：传什么渲染什么。
 */
export function ModuleGrid({ modules, showSummary = true, className }: ModuleGridProps) {
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
        className,
      )}
    >
      {modules.map((module) => (
        <li key={module.id}>
          <ModuleGridItem module={module} showSummary={showSummary} />
        </li>
      ))}
    </ul>
  );
}

export interface ModuleGridItemProps {
  module: PortalModule;
  showSummary?: boolean;
}

export function ModuleGridItem({ module, showSummary = true }: ModuleGridItemProps) {
  const Icon = moduleIcon(module.icon);
  return (
    <Link
      href={module.href}
      data-module-id={module.id}
      className={cn(
        'group flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm',
        'transition-shadow hover:shadow-md focus-visible:shadow-md',
        module.audited && 'kdy-sensitive-ring',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            ACCENT_CHIP[module.accent],
          )}
        >
          {/* eslint-disable-next-line react-hooks/static-components --
              仅从静态图标映射表取出已存在的组件引用（引用稳定），
              不是在渲染期间定义新组件；该规则对 icon-map 模式属误报。 */}
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-body group-hover:text-brand-strong">
          {module.nameZh}
        </span>
      </span>

      {showSummary ? (
        <span className="line-clamp-2 text-xs text-muted">{module.summary}</span>
      ) : null}

      <span className="mt-auto flex flex-wrap gap-1 pt-1">
        <KdyBadge tone={DELIVERY_TONE[module.delivery.stage]} title={DELIVERY_TITLE[module.delivery.stage]}>
          {deliveryStageLabel(module.delivery.stage)}
        </KdyBadge>
        {module.consentBadge ? (
          <KdyBadge tone="warning" title="首次进入需显式二次同意（契约 §9）">
            需同意
          </KdyBadge>
        ) : null}
        {module.audited ? (
          <KdyBadge tone={SENSITIVITY_TONE[module.sensitivity]} title="读写全部落审计日志">
            {module.sensitivityLabel}
          </KdyBadge>
        ) : null}
      </span>
    </Link>
  );
}
