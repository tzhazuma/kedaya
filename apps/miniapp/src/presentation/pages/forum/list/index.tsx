import { Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, forumDetailPath } from '../../../../app/routes'
import {
  FORUM_SORT_LABELS,
  FORUM_SORTS,
  FORUM_STATUS,
  FORUM_STATUS_LABELS,
  boardLabel,
} from '../../../../domain/models/forum'
import type {
  ForumBoard,
  ForumBoardStat,
  ForumPostSummary,
  ForumSort,
  ForumStatus,
} from '../../../../domain/models/forum'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 论坛帖子列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 版块导航来自 `GET /forum/boards`（版块白名单 + 帖子数），**不**在页面里硬编码
 * 版块清单；排序 `latest` / `hot` 与后端 orderBy 同序（hot = 回复多且新）。
 * 列表默认只查 `published`，关闭的主题要显式切换状态筛选才看得到。
 */

const STATUS_FILTERS: readonly (ForumStatus | 'all')[] = ['all', 'published', 'closed']

function ForumCard({ post }: { post: ForumPostSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(forumDetailPath(post.id))
      }}
    >
      <View className='kdy-forum-card'>
        <View className='kdy-forum-card__badge'>{post.badge}</View>
        <View className='kdy-forum-card__main'>
          <View className='kdy-forum-card__head'>
            <Text className='kdy-forum-card__title'>{post.title}</Text>
            {post.pinned ? <KdyTag tone='warning'>置顶</KdyTag> : null}
            {post.status === FORUM_STATUS.closed ? (
              <KdyTag tone='neutral'>{post.statusLabel}</KdyTag>
            ) : null}
          </View>
          <Text className='kdy-forum-card__meta'>
            {post.boardLabel} · {post.authorLabel}
            {post.anonymous ? '（匿名）' : ''}
            {post.mine ? ' · 我发布的' : ''}
          </Text>
          {post.bodyPreview === '' ? null : (
            <Text className='kdy-forum-card__preview'>{post.bodyPreview}</Text>
          )}
          <View className='kdy-forum-card__foot'>
            <Text className='kdy-forum-card__count'>{post.replyCountLabel}</Text>
            <Text className='kdy-forum-card__time'>
              {post.lastReplyLabel ?? `发布于 ${post.createdLabel}`}
            </Text>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function ForumListPage() {
  const container = getContainer()
  const forum = container.useCases.forum
  const state = useStore(forum.list)
  const [keyword, setKeyword] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [boards, setBoards] = useState<ForumBoardStat[]>([])
  const [boardsError, setBoardsError] = useState<string | null>(null)

  const filters = state.query as {
    keyword?: string
    board?: ForumBoard
    status?: ForumStatus
    sort?: ForumSort
    mine?: boolean
  }

  function refresh(patch: Parameters<typeof forum.list.load>[0] = {}): void {
    void forum.list.load({ cursor: null, ...patch })
  }

  function loadBoards(): void {
    void forum.boards().then((result) => {
      if (result.ok) {
        setBoards(result.value)
        setBoardsError(null)
        return
      }
      setBoardsError(result.error.message)
    })
  }

  useDidShow(() => {
    forum.list.hydrate()
    refresh()
    loadBoards()
  })

  useReachBottom(() => {
    void forum.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  return (
    <View className='kdy-page kdy-forum'>
      <KdyHeading
        title='校园论坛'
        subtitle='按版块逛帖子，也可以匿名发言；请遵守社区规范，不要人身攻击。'
        eyebrow='KEDAYA · 论坛'
      />

      <View className='kdy-forum__toolbar'>
        <View className='kdy-forum__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索标题或正文'
            maxLength={60}
          />
        </View>
        <KdyButton
          size='sm'
          onClick={() => {
            refresh({ keyword: keyword.trim() === '' ? undefined : keyword.trim() })
          }}
        >
          搜索
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? '收起' : '筛选'}
        </KdyButton>
      </View>

      <KdyCard title='版块' elevated={false} extra={<Text>{boards.length} 个</Text>}>
        {boardsError !== null && <Text className='kdy-forum__inline-error'>{boardsError}</Text>}
        <View className='kdy-forum__chips'>
          <KdyChip active={filters.board === undefined} onClick={() => refresh({ board: undefined })}>
            全部
          </KdyChip>
          {boards.map((stat) => (
            <KdyChip
              key={stat.board}
              active={filters.board === stat.board}
              onClick={() => refresh({ board: stat.board as ForumBoard })}
            >
              {`${boardLabel(stat.board)} ${stat.postCount}`}
            </KdyChip>
          ))}
        </View>
        <Text className='kdy-forum__filter-label'>
          版块后面的数字是该版块的帖子总数（含已关闭主题）。切换版块会立刻重新加载列表。
        </Text>
      </KdyCard>

      {showFilters && (
        <KdyCard elevated={false}>
          <Text className='kdy-forum__filter-label'>排序</Text>
          <View className='kdy-forum__chips'>
            {FORUM_SORTS.map((sort) => (
              <KdyChip
                key={sort}
                active={(filters.sort ?? 'latest') === sort}
                onClick={() => refresh({ sort })}
              >
                {FORUM_SORT_LABELS[sort]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-forum__filter-label'>状态</Text>
          <View className='kdy-forum__chips'>
            {STATUS_FILTERS.map((status) => (
              <KdyChip
                key={status}
                active={(filters.status ?? 'all') === status}
                onClick={() => refresh({ status: status === 'all' ? undefined : status })}
              >
                {status === 'all' ? '讨论中（默认）' : FORUM_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-forum__filter-label'>范围</Text>
          <View className='kdy-forum__chips'>
            <KdyChip active={filters.mine !== true} onClick={() => refresh({ mine: undefined })}>
              全部同学
            </KdyChip>
            <KdyChip
              active={filters.mine === true}
              disabled={container.useCases.session.getSnapshot().tokens === null}
              onClick={() => {
                if (requireLogin(PAGE_PATHS.authLogin)) refresh({ mine: true })
              }}
            >
              我发的帖子
            </KdyChip>
          </View>
          <Text className='kdy-forum__filter-label'>
            「我发的帖子」只包含实名发布的主题 —— 匿名帖不保存作者身份，无法按人筛选。
          </Text>
        </KdyCard>
      )}

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-forum__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='这个版块还没有帖子'
          description='换个版块或关键词，也可以直接发第一个主题。'
          actionText='去发帖'
          onAction={() => {
            void navigateTo(PAGE_PATHS.forumCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到帖子列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((post) => (
        <ForumCard key={post.id} post={post} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-forum__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void forum.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-forum__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-forum__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.forumCreate)
          }}
        >
          发帖
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。匿名不等于免责，请勿发布违法或侵权内容。
      </Text>
    </View>
  )
}
