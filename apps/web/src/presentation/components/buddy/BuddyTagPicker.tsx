'use client';

import type { BuddyTagDef } from '@/domain/models/buddy';

import { cn } from '../../theme/cn';

export interface BuddyTagPickerProps {
  /** 按分组给的标签（来自 application 的 `tagGroups()` / `BUDDY_ACTIVE_TAGS`） */
  groups: readonly { group: string; label: string; tags: readonly BuddyTagDef[] }[];
  selected: readonly string[];
  max: number;
  onChange: (next: string[]) => void;
  legend: string;
  hint?: string;
  error?: string | null;
  /** 用于生成稳定的 DOM id（同一页面可能出现多个选择器） */
  idPrefix: string;
  disabled?: boolean;
}

/**
 * **封闭标签选择器**（规格 §3.2 硬要求）。
 *
 * 这里**没有**任何自由文本输入框 —— 这是刻意的：
 * 匹配特征必须来自服务端维护的标签表，否则 `"羽毛球"` / `"打羽毛球"` / `"badminton"`
 * 互不匹配，"共同兴趣"这个特征直接失效。标签表变更要走 migration + 审计。
 */
export function BuddyTagPicker({
  groups,
  selected,
  max,
  onChange,
  legend,
  hint,
  error,
  idPrefix,
  disabled = false,
}: BuddyTagPickerProps) {
  const selectedSet = new Set(selected);
  const atLimit = selected.length >= max;

  const toggle = (key: string): void => {
    if (selectedSet.has(key)) {
      onChange(selected.filter((item) => item !== key));
      return;
    }
    if (atLimit) return;
    onChange([...selected, key]);
  };

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={`${idPrefix}-hint`}
      data-testid={`${idPrefix}-tag-picker`}
    >
      <legend className="text-sm font-medium text-body">{legend}</legend>
      <p id={`${idPrefix}-hint`} className="text-xs text-muted">
        {hint ?? '只能从下面的标签里选择 —— 自由文本无法用于匹配，因此不提供输入框。'}
        <span className="ml-1">
          已选 {selected.length}/{max}。
        </span>
      </p>

      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.tags.map((tag) => {
              const checked = selectedSet.has(tag.key);
              const blocked = !checked && atLimit;
              return (
                <label
                  key={tag.key}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs transition-colors',
                    checked
                      ? 'border-brand-soft bg-brand-soft text-brand-strong'
                      : 'border-border bg-surface text-muted hover:bg-surface-alt',
                    (blocked || disabled) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={disabled || blocked}
                    onChange={() => toggle(tag.key)}
                    aria-label={`${tag.label}${blocked ? '（已达上限）' : ''}`}
                  />
                  <span aria-hidden>{checked ? '✓' : '+'}</span>
                  {tag.label}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {atLimit ? (
        <p className="text-xs text-warning" data-testid={`${idPrefix}-tag-limit`}>
          已达上限（{max} 个）。取消一个已选标签后才能再选。
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
