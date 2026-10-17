import { Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, lostFoundDetailPath } from '../../../../app/routes'
import {
  LOST_FOUND_KINDS,
  LOST_FOUND_KIND_LABELS,
  LOST_FOUND_SORT_LABELS,
  LOST_FOUND_SORTS,
  LOST_FOUND_STATUS_LABELS,
} from '../../../../domain/models/lostFound'
import type {
  LostFoundItemSummary,
  LostFoundKind,
  LostFoundSort,
  LostFoundStatus,
} from '../../../../domain/models/lostFound'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 失物招领列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度与后端一一对应：关键词 / 地点 / 类型 / 状态 / 只看我的 —— 全部来自
 * `lost-found.controller.ts` 的 `listQuerySchema`（`q` / `place` / `kind` / `status` / `mine`）。
 * 排序是**事发时间**（latest / oldest），不是发布时间。
 */

const STATUS_FILTERS: readonly (LostFoundStatus | 'all')[] = ['all', 'open', 'resolved']

function statusTone(status: LostFoundStatus): KdyTagTone {
  return status === 'open' ? 'brand' : 'neutral'
}

function LostFoundCard({ item }: { item: LostFoundItemSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(lostFoundDetailPath(item.id))
      }}
    >
      <View className='kdy-lost-card'>
        <View className='kdy-lost-card__badge'>{item.badge}</View>
        <View className='kdy-lost-card__main'>
          <View className='kdy-lost-card__head'>
            <Text className='kdy-lost-card__title'>{item.title}</Text>
            <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
          </View>
          <Text className='kdy-lost-card__meta'>
            {item.kindLabel} · {item.place}
          </Text>
          {item.descriptionPreview === '' ? null : (
            <Text className='kdy-lost-card__preview'>{item.descriptionPreview}</Text>
          )}
          <View className='kdy-lost-card__foot'>
            <Text className='kdy-lost-card__time'>事发 {item.happenedLabel}</Text>
            <Text className='kdy-lost-card__time'>
              {item.mine ? '我发布的 · ' : ''}
              {item.createdLabel}
            </Text>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function LostFoundListPage() {
  const container = getContainer()
  const lostFound = container.useCases.lostFound
  const state = useStore(lostFound.list)
  const [keyword, setKeyword] = useState('')
  const [place, setPlace] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filters = state.query as {
    keyword?: string
    place?: string
    kind?: LostFoundKind
    status?: LostFoundStatus
    sort?: LostFoundSort
    mine?: boolean
  }

  function refresh(patch: Parameters<typeof lostFound.list.load>[0] = {}): void {
    void lostFound.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    lostFound.list.hydrate()
    refresh()
  })

  useReachBottom(() => {
    void lostFound.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  return (
    <View className='kdy-page kdy-lost'>
      <KdyHeading
        title='失物招领'
        subtitle='丢了东西或被同学捡到，都可以在这里登记，让物品回到主人手里。'
        eyebrow='KEDAYA · 失物招领'
      />

      <View className='kdy-lost__toolbar'>
        <View className='kdy-lost__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索物品名称、描述或地点'
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
          <Text className='kdy-lost__filter-label'>类型</Text>
          <View className='kdy-lost__chips'>
            <KdyChip active={filters.kind === undefined} onClick={() => refresh({ kind: undefined })}>
              全部
            </KdyChip>
            {LOST_FOUND_KINDS.map((kind) => (
              <KdyChip key={kind} active={filters.kind === kind} onClick={() => refresh({ kind })}>
                {LOST_FOUND_KIND_LABELS[kind]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-lost__filter-label'>状态</Text>
          <View className='kdy-lost__chips'>
            {STATUS_FILTERS.map((status) => (
              <KdyChip
                key={status}
                active={(filters.status ?? 'all') === status}
                onClick={() => refresh({ status: status === 'all' ? undefined : status })}
              >
                {status === 'all' ? '全部' : LOST_FOUND_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-lost__filter-label'>排序</Text>
          <View className='kdy-lost__chips'>
            {LOST_FOUND_SORTS.map((sort) => (
              <KdyChip
                key={sort}
                active={(filters.sort ?? 'latest') === sort}
                onClick={() => refresh({ sort })}
              >
                {LOST_FOUND_SORT_LABELS[sort]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-lost__filter-label'>地点</Text>
          <KdyField
            value={place}
            onChange={setPlace}
            placeholder='例如：图书馆（选填，支持模糊匹配）'
            maxLength={60}
            hint='地点筛选与关键词是两个独立条件，可以叠加'
          />
          <View className='kdy-lost__chips'>
            <KdyButton
              size='sm'
              variant='ghost'
              onClick={() => {
                refresh({ place: place.trim() === '' ? undefined : place.trim() })
              }}
            >
              应用地点
            </KdyButton>
            <KdyButton
              size='sm'
              variant='ghost'
              onClick={() => {
                setPlace('')
                refresh({ place: undefined })
              }}
            >
              清除地点
            </KdyButton>
          </View>

          <Text className='kdy-lost__filter-label'>范围</Text>
          <View className='kdy-lost__chips'>
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
              我发布的
            </KdyChip>
          </View>
        </KdyCard>
      )}

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-lost__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有符合条件的登记'
          description='换个筛选条件，或者登记你丢失 / 捡到的物品。'
          actionText='去登记'
          onAction={() => {
            void navigateTo(PAGE_PATHS.lostFoundCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到失物招领列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((item) => (
        <LostFoundCard key={item.id} item={item} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-lost__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void lostFound.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-lost__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-lost__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.lostFoundCreate)
          }}
        >
          登记信息
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。证件类物品请交到保卫处或失物招领柜，不要只发在线上。
      </Text>
    </View>
  )
}
