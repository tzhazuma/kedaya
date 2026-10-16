import { MessageSquare, Pin, ThumbsUp } from 'lucide-react';
import Link from 'next/link';

import type { ForumPostItemVM } from '@/application/forum/listForumPosts';

import { cn } from '../../theme/cn';
import { KdyCard } from '../KdyCard';
import { ForumPostStatusNotice } from './ForumPostStatusNotice';

export interface ForumPostCardProps {
  item: ForumPostItemVM;
}

/** 主题卡片（列表项）。纯展示：所有文案/数字都来自视图模型。 */
export function ForumPostCard({ item }: ForumPostCardProps) {
  return (
    <KdyCard
      interactive
      tone={item.hidden ? 'alt' : 'surface'}
      className={cn('flex flex-col gap-3', item.hidden && 'opacity-90')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-border bg-surface-alt px-2 py-0.5 text-xs text-muted">
              {item.boardName}
            </span>
            {item.pinned ? (
              <span className="inline-flex items-center gap-1 text-xs text-brand-strong">
                <Pin className="size-3" aria-hidden />
                置顶
              </span>
            ) : null}
            {item.anonymous ? (
              <span className="rounded-pill border border-border bg-surface-alt px-2 py-0.5 text-xs text-muted">
                匿名
              </span>
            ) : null}
          </div>
          <Link
            href={`/forum/${item.id}`}
            className="text-md font-semibold text-body hover:text-brand-strong"
          >
            {item.title}
          </Link>
        </div>
      </div>

      <p className="line-clamp-3 text-sm text-muted">{item.excerpt}</p>

      {item.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <li key={tag} className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-xs text-muted">
              #{tag}
            </li>
          ))}
        </ul>
      ) : null}

      <ForumPostStatusNotice
        statusLabel={item.statusLabel}
        tone={item.statusTone}
        notice={item.hidden ? item.notice : null}
        hidden={item.hidden}
        locked={item.locked}
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{item.authorLabel}</span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" aria-hidden />
          {item.replyCountLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsUp className="size-3.5" aria-hidden />
          {item.likeCountLabel}
        </span>
        <span className="ml-auto">最近活跃 {item.lastActivityLabel}</span>
      </div>
    </KdyCard>
  );
}
