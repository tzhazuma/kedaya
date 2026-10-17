import { Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, buddyDetailPath } from '../../../../app/routes'
import {
  BUDDY_ACTIVITIES,
  BUDDY_ACTIVITY_LABELS,
  BUDDY_SORTS,
  BUDDY_SORT_LABELS,
  BUDDY_STATUSES,
  BUDDY_STATUS_LABELS,
} from '../../../../domain/models/buddy'
import type {
  BuddyActivity,
  BuddyGroupSummary,
  BuddyScope,
  BuddySort,
  BuddyStatus,
} from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 找搭子列表页。
 *
 * 筛选维度与后端 `buddy.controller.ts` 的 listQuerySchema 一一对应：
 * 活动（白名单）/ 状态 / 关键词（`q`）/ 排序 / 范围（`mine=1`、`joined=1`）/ 只看未开始。
 * 「我发起的 / 我加入的」需要登录 —— 未登录时先引导去登录页，而不是发 401。
 */

const SCOPES: readonly BuddyScope[] = ['all', 'mine', 'joined']

function scopeLabel(scope: BuddyScope): string {
  if (scope === 'mine') return '我发起的'
  if (scope === 'joined') return '我加入的'
  return '全部同学'
}

function statusTone(status: BuddyStatus): KdyTagTone {
  if (status === 'recruiting') return 'brand'
  if (status === 'full') return 'success'
  if (status === 'cancelled') return 'danger'
  return 'neutral'
}

function BuddyCard({ group }: { group: BuddyGroupSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(buddyDetailPath(group.id))
      }}
    >
      <View className='kdy-buddy-card'>
        <View className='kdy-buddy-card__badge'>{group.badge}</View>
        <View className='kdy-buddy-card__main'>
          <View className='kdy-buddy-card__head'>
            <Text className='kdy-buddy-card__title'>{group.title}</Text>
            <KdyTag tone={statusTone(group.status)}>{group.statusLabel}</KdyTag>
          </View>

          <Text className='kdy-buddy-card__meta'>
            {group.campusSpot} · {group.startsLabel}
          </Text>

          <View className='kdy-buddy-card__foot'>
            <Text className='kdy-buddy-card__capacity'>{group.capacityLabel}</Text>
            <Text className='kdy-buddy-card__time'>
              {group.mine ? '我发起的 · ' : ''}
              {group.timeLabel}
            </Text>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function BuddyListPage() {
  const container = getContainer()
  const buddy = container.useCases.buddy
  const state = useStore(buddy.list)

  const [keyword, setKeyword] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filters = state.query as {
    activity?: BuddyActivity
    status?: BuddyStatus
    sort?: BuddySort
    scope?: BuddyScope
    onlyUpcoming?: boolean
    keyword?: string
  }

  function refresh(patch: Parameters<typeof buddy.list.load>[0] = {}): void {
    void buddy.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    buddy.list.hydrate()
    refresh()
  })

  useReachBottom(() => {
    void buddy.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  return (
    <View className='kdy-page kdy-buddy'>
      <KdyHeading
        title='找搭子'
        subtitle='自习、运动、吃饭、出行 —— 组个小队，一起去。'
        eyebrow='KEDAYA · 找搭子'
      />

      <View className='kdy-buddy__toolbar'>
        <View className='kdy-buddy__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索搭子标题或简介'
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

      {showFilters && (
        <KdyCard elevated={false}>
          <Text className='kdy-buddy__filter-label'>活动</Text>
          <View className='kdy-buddy__chips'>
            <KdyChip
              active={filters.activity === undefined}
              onClick={() => refresh({ activity: undefined })}
            >
              全部
            </KdyChip>
            {BUDDY_ACTIVITIES.map((activity) => (
              <KdyChip
                key={activity}
                active={filters.activity === activity}
                onClick={() => refresh({ activity })}
              >
                {BUDDY_ACTIVITY_LABELS[activity]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-buddy__filter-label'>状态</Text>
          <View className='kdy-buddy__chips'>
            <KdyChip
              active={filters.status === undefined}
              onClick={() => refresh({ status: undefined })}
            >
              全部
            </KdyChip>
            {BUDDY_STATUSES.map((status) => (
              <KdyChip
                key={status}
                active={filters.status === status}
                onClick={() => refresh({ status })}
              >
                {BUDDY_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-buddy__filter-label'>排序</Text>
          <View className='kdy-buddy__chips'>
            {BUDDY_SORTS.map((sort) => (
              <KdyChip
                key={sort}
                active={(filters.sort ?? 'latest') === sort}
                onClick={() => refresh({ sort })}
              >
                {BUDDY_SORT_LABELS[sort]}
              </KdyChip>
            ))}
            <KdyChip
              active={filters.onlyUpcoming === true}
              onClick={() => refresh({ onlyUpcoming: filters.onlyUpcoming !== true })}
            >
              只看未开始
            </KdyChip>
          </View>

          <Text className='kdy-buddy__filter-label'>范围</Text>
          <View className='kdy-buddy__chips'>
            {SCOPES.map((scope) => (
              <KdyChip
                key={scope}
                active={(filters.scope ?? 'all') === scope}
                disabled={
                  scope !== 'all' && container.useCases.session.getSnapshot().tokens === null
                }
                onClick={() => {
                  if (scope === 'all') {
                    refresh({ scope: 'all' })
                    return
                  }
                  if (requireLogin(PAGE_PATHS.authLogin)) refresh({ scope })
                }}
              >
                {scopeLabel(scope)}
              </KdyChip>
            ))}
          </View>
        </KdyCard>
      )}

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-buddy__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有这类搭子'
          description='换个筛选条件，或者发起你的第一个搭子。'
          actionText='去发起'
          onAction={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.buddyCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到搭子列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((group) => (
        <BuddyCard key={group.id} group={group} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-buddy__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void buddy.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-buddy__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-buddy__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.buddyCreate)
          }}
        >
          发起搭子
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。线下见面请优先选择人多明亮的公共场所。
      </Text>
    </View>
  )
}
