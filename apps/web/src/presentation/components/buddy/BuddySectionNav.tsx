'use client';

import type { BuddySectionVM } from '@/application/buddy/listBuddyPosts';
import { BUDDY_ACTIVE_TAGS, type BuddySection } from '@/domain/models/buddy';

import { cn } from '../../theme/cn';

export interface BuddySectionNavProps {
  sections: readonly BuddySectionVM[];
  activeSection: BuddySection | null;
  onSelectSection: (section: BuddySection | null) => void;
  activeTags: readonly string[];
  onToggleTag: (key: string) => void;
}

/**
 * 三板块分栏（`academic` / `daily` / `sport`）+ 封闭标签筛选。
 *
 * 契约 §11.10-G：**只有三个板块**，不实现交友/约会板块。
 * 标签筛选也只能从标签表里选（与发布表单同一份白名单）。
 */
export function BuddySectionNav({
  sections,
  activeSection,
  onSelectSection,
  activeTags,
  onToggleTag,
}: BuddySectionNavProps) {
  const activeSet = new Set(activeTags);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="板块筛选">
        <button
          type="button"
          aria-pressed={activeSection === null}
          onClick={() => onSelectSection(null)}
          className={cn(
            'rounded-pill border px-3 py-1 text-xs transition-colors',
            activeSection === null
              ? 'border-brand-soft bg-brand-soft text-brand-strong'
              : 'border-border bg-surface text-muted hover:bg-surface-alt',
          )}
        >
          全部板块
        </button>
        {sections.map((section) => (
          <button
            key={section.value}
            type="button"
            aria-pressed={activeSection === section.value}
            title={section.description}
            onClick={() => onSelectSection(section.value)}
            data-testid={`buddy-section-${section.value}`}
            className={cn(
              'rounded-pill border px-3 py-1 text-xs transition-colors',
              activeSection === section.value
                ? 'border-brand-soft bg-brand-soft text-brand-strong'
                : 'border-border bg-surface text-muted hover:bg-surface-alt',
            )}
          >
            {section.label}
            <span className="ml-1 text-muted">（{section.count}）</span>
          </button>
        ))}
      </div>

      <details className="rounded-md border border-border bg-surface-alt px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-body">
          标签筛选（封闭标签表 · 已选 {activeTags.length}）
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {BUDDY_ACTIVE_TAGS.map((tag) => {
            const active = activeSet.has(tag.key);
            return (
              <button
                key={tag.key}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleTag(tag.key)}
                className={cn(
                  'rounded-pill border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'border-brand-soft bg-brand-soft text-brand-strong'
                    : 'border-border bg-surface text-muted hover:bg-surface-alt',
                )}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          标签只能从这份白名单里选：自由文本会让「共同兴趣」匹配失效（规格 §3.2）。
        </p>
      </details>
    </div>
  );
}
