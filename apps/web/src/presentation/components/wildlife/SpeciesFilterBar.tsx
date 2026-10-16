/**
 * 物种筛选（规格 §5 / §7）。
 *
 * 选项来自 `GET /wildlife/species`（**不是硬编码清单**）—— 因为真实物种清单必须由
 * 校园动物社团确认后由服务端下发（未决问题 U2）。保护物种带角标。
 */
import type { SpeciesOption } from '@/domain/models/wildlife/species';

import { cn } from '../../theme/cn';

export interface SpeciesFilterBarProps {
  options: readonly SpeciesOption[];
  value: string;
  allValue: string;
  onChange: (next: string) => void;
  /** 显示"全部"chip */
  allLabel?: string;
  className?: string;
}

export function SpeciesFilterBar({
  options,
  value,
  allValue,
  onChange,
  allLabel = '全部物种',
  className,
}: SpeciesFilterBarProps) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      role="group"
      aria-label="物种筛选"
      data-testid="wildlife-species-filter"
    >
      <button
        type="button"
        aria-pressed={value === allValue}
        onClick={() => onChange(allValue)}
        className={cn(
          'rounded-pill border px-3 py-1 text-xs transition-colors',
          value === allValue
            ? 'border-brand-soft bg-brand-soft text-brand-strong'
            : 'border-border bg-surface text-muted hover:bg-surface-alt',
        )}
      >
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'inline-flex items-center gap-1 rounded-pill border px-3 py-1 text-xs transition-colors',
            value === option.id
              ? 'border-brand-soft bg-brand-soft text-brand-strong'
              : 'border-border bg-surface text-muted hover:bg-surface-alt',
          )}
        >
          {option.label}
          {option.protectedLabel ? (
            <span className="rounded-pill bg-surface-alt px-1.5 py-0.5 text-[10px] text-warning">
              {option.protectedLabel}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
