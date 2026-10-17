import { Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, fleaDetailPath } from '../../../../app/routes'
import {
  FLEA_CATEGORIES,
  FLEA_CATEGORY_LABELS,
  FLEA_STATUS_LABELS,
} from '../../../../domain/models/fleaMarket'
import type { FleaCategory, FleaItemSummary, FleaStatus } from '../../../../domain/models/fleaMarket'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 跳蚤市场列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度与后端一一对应：关键词 / 分类 / 状态 / 只看我的。
 * 「只看我的」需要登录 —— 未登录时直接引导去登录页，而不是让页面显示 401。
 */

const STATUS_FILTERS: readonly (FleaStatus | 'all')[] = ['all', 'on-sale', 'reserved', 'sold']
const SORTS = ['latest', 'price-asc', 'price-desc'] as const

function statusTone(status: FleaStatus): KdyTagTone {
  if (status === 'on-sale') return 'brand'
  if (status === 'reserved') return 'warning'
  return 'neutral'
}

function FleaCard({ item }: { item: FleaItemSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(fleaDetailPath(item.id))
      }}
    >
      <View className='kdy-flea-card'>
        <View className='kdy-flea-card__badge'>{item.badge}</View>
        <View className='kdy-flea-card__main'>
          <View className='kdy-flea-card__head'>
            <Text className='kdy-flea-card__title'>{item.title}</Text>
            <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
          </View>
          <Text className='kdy-flea-card__meta'>
            {item.preference}
            {item.campusSpot === null ? '' : ` · ${item.campusSpot}`}
          </Text>
          <View className='kdy-flea-card__foot'>
            <Text className='kdy-flea-card__price'>¥{item.priceLabel}</Text>
            <Text className='kdy-flea-card__time'>{item.mine ? '我发布的 · ' : ''}{item.timeLabel}</Text>
          </View>
        </View>
      </View>
    </KdyCard>
  )
}

export default function FleaMarketListPage() {
  const container = getContainer()
  const flea = container.useCases.fleaMarket
  const state = useStore(flea.list)
  const [keyword, setKeyword] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filters = state.query as {
    category?: FleaCategory
    status?: FleaStatus
    sort?: (typeof SORTS)[number]
    mine?: boolean
    keyword?: string
  }

  function refresh(patch: Parameters<typeof flea.list.load>[0] = {}): void {
    void flea.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    flea.list.hydrate()
    refresh()
  })

  useReachBottom(() => {
    void flea.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  return (
    <View className='kdy-page kdy-flea'>
      <KdyHeading
        title='跳蚤市场'
        subtitle='闲置物品找到下一位主人，当面交易、不掺资金。'
        eyebrow='KEDAYA · 跳蚤'
      />

      <View className='kdy-flea__toolbar'>
        <View className='kdy-flea__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索商品名称或描述'
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
          <Text className='kdy-flea__filter-label'>分类</Text>
          <View className='kdy-flea__chips'>
            <KdyChip
              active={filters.category === undefined}
              onClick={() => refresh({ category: undefined })}
            >
              全部
            </KdyChip>
            {FLEA_CATEGORIES.map((category) => (
              <KdyChip
                key={category}
                active={filters.category === category}
                onClick={() => refresh({ category })}
              >
                {FLEA_CATEGORY_LABELS[category]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-flea__filter-label'>状态</Text>
          <View className='kdy-flea__chips'>
            {STATUS_FILTERS.map((status) => (
              <KdyChip
                key={status}
                active={(filters.status ?? 'all') === status}
                onClick={() => refresh({ status: status === 'all' ? undefined : status })}
              >
                {status === 'all' ? '全部' : FLEA_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-flea__filter-label'>排序</Text>
          <View className='kdy-flea__chips'>
            {SORTS.map((sort) => (
              <KdyChip
                key={sort}
                active={(filters.sort ?? 'latest') === sort}
                onClick={() => refresh({ sort })}
              >
                {sort === 'latest' ? '最新' : sort === 'price-asc' ? '价格升序' : '价格降序'}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-flea__filter-label'>范围</Text>
          <View className='kdy-flea__chips'>
            <KdyChip
              active={filters.mine !== true}
              onClick={() => refresh({ mine: undefined })}
            >
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
        <Text className='kdy-flea__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有这类闲置'
          description='换个筛选条件，或者发布你的第一件闲置。'
          actionText='去发布'
          onAction={() => {
            void navigateTo(PAGE_PATHS.fleaCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到商品列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((item) => (
        <FleaCard key={item.id} item={item} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-flea__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void flea.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-flea__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-flea__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.fleaCreate)
          }}
        >
          发布闲置
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。面交请优先选择人多明亮的公共场所。
      </Text>
    </View>
  )
}
