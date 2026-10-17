'use client';

import { MonitorSmartphone, Moon, Sun } from 'lucide-react';

import { cn } from './cn';
import { useTheme, type ThemeMode } from './ThemeProvider';

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; Icon: typeof Sun }> = [
  { mode: 'light', label: '浅色', Icon: Sun },
  { mode: 'dark', label: '深色', Icon: Moon },
  { mode: 'system', label: '跟随系统', Icon: MonitorSmartphone },
];

/**
 * 主题切换（分段控件）。
 *
 * 无需 `mounted` 标志：`useTheme().mode` 由 `useSyncExternalStore` 提供，
 * 其 `getServerSnapshot` 固定为 `'system'`，因此 SSR 与 hydration 首帧一致，
 * 之后 React 用真实快照自动重渲染 —— 既无 hydration 不匹配，也无 setState-in-effect。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-border bg-surface p-1',
        className,
      )}
    >
      {OPTIONS.map(({ mode: option, label, Icon }) => {
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(option)}
            className={cn(
              'inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs transition-colors',
              active ? 'bg-brand text-ink' : 'text-muted hover:bg-surface-alt hover:text-body',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
