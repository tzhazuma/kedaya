'use client';

import { Lock } from 'lucide-react';

import type { ForumBoardVM } from '@/application/forum/listForumPosts';

import { cn } from '../../theme/cn';

export interface ForumBoardNavProps {
  boards: ForumBoardVM[];
  activeBoardId: string | null;
  onSelect: (boardId: string | null) => void;
}

/**
 * 版块导航（按版块筛选）。
 *
 * `campus_only` 版块在未登录时**仍然展示**（存在但需要登录，比直接消失更诚实），
 * 只是禁用并提示需要登录。
 */
export function ForumBoardNav({ boards, activeBoardId, onSelect }: ForumBoardNavProps) {
  const chips: Array<{ id: string | null; name: string; accessible: boolean; campusOnly: boolean; postCountLabel: string | null }> = [
    { id: null, name: '全部版块', accessible: true, campusOnly: false, postCountLabel: null },
    ...boards.map((board) => ({
      id: board.id,
      name: board.name,
      accessible: board.accessible,
      campusOnly: board.campusOnly,
      postCountLabel: board.postCountLabel,
    })),
  ];

  return (
    <nav aria-label="版块筛选" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => {
        const active = activeBoardId === chip.id;
        return (
          <button
            key={chip.id ?? 'all'}
            type="button"
            aria-pressed={active}
            disabled={!chip.accessible}
            title={
              chip.accessible
                ? undefined
                : `${chip.name} 仅校内可见，登录后即可访问（当前为演示会话）`
            }
            onClick={() => onSelect(chip.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-pill border px-3 py-1 text-xs transition-colors',
              active
                ? 'border-brand-soft bg-brand-soft text-brand-strong'
                : 'border-border bg-surface text-body hover:bg-surface-alt',
              !chip.accessible && 'cursor-not-allowed opacity-60',
            )}
          >
            {!chip.accessible ? <Lock className="size-3" aria-hidden /> : null}
            {chip.name}
            {chip.postCountLabel ? (
              <span className="text-muted">· {chip.postCountLabel}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
