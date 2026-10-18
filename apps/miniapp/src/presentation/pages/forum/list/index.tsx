import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { forumCreatePath, forumDetailPath } from '../../../../app/routes'
import { FORUM_ANONYMITY_NOTICE_SHORT } from '../../../../domain/models/forum'
import type { ForumPostSummary } from '../../../../domain/models/forum'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 论坛主题列表页（版块 + 主题）。
 *
 * 小程序特性落地：
 * - `onPullDownRefresh`（`usePullDownRefresh`）→ 重新拉版块与当前版块主题
 * - `onReachBottom`（`useReachBottom`）→ 用游标加载下一页
 *
 * 三态齐全（loading / empty / error），并且**可被真实触发**：
 * 顶部演示按钮走 `mockForumControls` 的控制面，不是硬编码假状态。
 *
 * 契约 §8：`useDidShow` 里先 `hydrate()`（同步读缓存）再 `load()`（后台刷新）。
 */

function statusTone(status: ForumPostSummary['status']): KdyTagTone {
  if (status === 'PUBLISHED') return 'brand'
  if (status === 'LOCKED') return 'neutral'
  if (status === 'HIDDEN') return 'danger'
  return 'neutral'
}

/**
 * 主题行 —— 论坛的定制化外观：**热度**（回复 / 赞）与作者分列两端，
 * 摘要在中间固定两行。
 *
 * 与商品卡/任务卡不同，论坛扫的是"这帖说了什么、有没有人理它"，
 * 所以数字不做成大件，而是收成一个右上角的小统计簇（回复 / 赞），
 * 让标题与摘要占满宽度。
 */
function ForumPostCard({ item, boardName }: { item: ForumPostSummary; boardName: string }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(forumDetailPath(item.id))
      }}
    >
      <View className='kdy-forum-card'>
        <View className='kdy-forum-card__head'>
          <Text className='kdy-forum-card__title'>{item.title}</Text>
          {item.pinned && <KdyTag tone='warning'>置顶</KdyTag>}
          {item.status !== 'PUBLISHED' && (
            <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
          )}
        </View>

        {item.excerpt === '' ? null : (
          <Text className='kdy-forum-card__excerpt'>{item.excerpt}</Text>
        )}

        {item.tags.length > 0 && (
          <View className='kdy-forum-card__tags'>
            {item.tags.map((tag) => (
              <KdyTag key={tag} tone='info'>
                #{tag}
              </KdyTag>
            ))}
          </View>
        )}

        <View className='kdy-forum-card__foot'>
          <Text className='kdy-forum-card__author'>
            {boardName} · {item.authorName}
            {item.anonymous ? '（匿名）' : ''}
          </Text>

          <View className='kdy-forum-card__stats'>
            <Text className='kdy-forum-card__stat'>{item.replyCount} 回复</Text>
            <Text className='kdy-forum-card__stat'>{item.likeCount} 赞</Text>
            <Text className='kdy-forum-card__stat'>{item.createdAtLabel}</Text>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function ForumListPage() {
  const container = getContainer()
  const boards = container.useCases.listForumBoards
  const posts = container.useCases.listForumPosts
  const boardState = useStore(boards)
  const state = useStore(posts)

  function reloadBoard(boardId: string | null): void {
    posts.selectBoard(boardId)
    void posts.load({ boardId })
  }

  function refresh(): Promise<void> {
    return Promise.all([boards.load(), posts.load()]).then(() => undefined)
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    boards.hydrate()
    posts.hydrate()
    if (boards.getSnapshot().boards.length === 0) void boards.load()
    void posts.load()
  })

  usePullDownRefresh(() => {
    void refresh().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void posts.loadMore()
  })

  function boardName(boardId: string): string {
    return boardState.boards.find((board) => board.id === boardId)?.name ?? '版块'
  }

  function handleSimulateError(): void {
    const mock = container.mockForumControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void posts.load()
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockForumControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void posts.load()
  }

  function handleResetDemo(): void {
    container.mockForumControls?.reset()
    void refresh()
  }

  function handleSwitchBoard(boardId: string | null): void {
    reloadBoard(boardId)
  }

  const activeBoard = boardState.boards.find((board) => board.id === state.activeBoardId) ?? null

  return (
    <View className='kdy-page kdy-forum-list'>
      {/* 版块栏：每个版块带**主题数**（决定值不值得点进去），
          选中后下面补一行版块简介与可见性 —— 论坛里"这版块是干嘛的、
          谁能看"是要说清楚的。 */}
      <View className='kdy-forum-list__boards'>
        {boardState.boards.map((board) => {
          const active = state.activeBoardId === board.id
          return (
            <View
              key={board.id}
              className={active ? 'kdy-forum-list__board is-active' : 'kdy-forum-list__board'}
              onClick={() => handleSwitchBoard(active ? null : board.id)}
            >
              <Text className='kdy-forum-list__board-name'>{board.name}</Text>
              <Text className='kdy-forum-list__board-count'>{board.postCount} 主题</Text>
            </View>
          )
        })}
      </View>

      {activeBoard === null ? (
        <Text className='kdy-forum-list__board-hint'>全部版块的最新主题（按时间倒序）</Text>
      ) : (
        <View className='kdy-forum-list__board-hint'>
          <Text className='kdy-forum-list__board-desc'>{activeBoard.description}</Text>
          <Text className='kdy-forum-list__board-desc'>
            {activeBoard.visibilityLabel}
            {activeBoard.campusOnly ? ' · 仅校内可见' : ''}
          </Text>
        </View>
      )}

      <View className='kdy-forum-list__actions'>
        <KdyButton
          size='sm'
          onClick={() => {
            void navigateTo(forumCreatePath(state.activeBoardId))
          }}
        >
          发帖
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateError}>
          模拟错误态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleSimulateEmpty}>
          模拟空态
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={handleResetDemo}>
          重置演示数据
        </KdyButton>
      </View>

      {state.status === 'loading' && (
        <KdyEmpty mode='loading' description='首次进入，正在拉取论坛主题' />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => {
            void posts.load()
          }}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='这个版块还没有主题，来发第一帖吧'
          actionText='去发帖'
          onAction={() => {
            void navigateTo(forumCreatePath(state.activeBoardId))
          }}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.posts.map((item) => (
            <ForumPostCard key={item.id} item={item} boardName={boardName(item.boardId)} />
          ))}

          {state.loadingMore && <Text className='kdy-forum-list__more'>正在加载更多…</Text>}
          {!state.loadingMore && state.nextCursor === null && state.posts.length > 0 && (
            <Text className='kdy-forum-list__more'>没有更多了</Text>
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-forum-list__soft-error'>
          刷新失败：{state.error}
        </Text>
      )}

      <Text className='kdy-forum-list__notice'>{FORUM_ANONYMITY_NOTICE_SHORT}</Text>
      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
