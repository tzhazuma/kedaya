import { Text, View } from '@tarojs/components'
import Image from '@taroify/core/image'
import '@taroify/core/image/style'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
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
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyListSkeleton } from '../../../components'
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

/**
 * 商品格 —— 跳蚤市场的**双列网格**单元（与其它模块的整宽列表卡刻意不同）。
 *
 * 二手交易的决定顺序是「图 → 价 → 成色/地点 → 谁卖的」，所以：
 *   · 图占满格子（没有图时退化成文字徽标 —— 不编一张假图）；
 *   · 价格是格子里的最大字；
 *   · 已售 / 已预定在图上打角标（一眼可见，不用读小字）。
 * 交易偏好（成色 · 分类）在网格里只留**成色**，分类挪到图上的小pill ——
 * 两列宽度的每一行都有限，把四个信息塞一行等于都看不清。
 */
function FleaCard({ item }: { item: FleaItemSummary }) {
  return (
    <View
      className='kdy-flea-card'
      hoverClass='kdy-flea-card--pressed'
      hoverStayTime={70}
      onClick={() => {
        void navigateTo(fleaDetailPath(item.id))
      }}
    >
      <View className='kdy-flea-card__cover'>
        {item.thumbnailUrl === null ? (
          <View className='kdy-flea-card__badge'>
            <Text className='kdy-flea-card__badge-text'>{item.badge}</Text>
          </View>
        ) : (
          <Image className='kdy-flea-card__image' src={item.thumbnailUrl} mode='aspectFill' />
        )}

        <Text className='kdy-flea-card__category'>{item.categoryLabel}</Text>

        {item.status === 'on-sale' ? null : (
          <Text className={`kdy-flea-card__status is-${item.status}`}>{item.statusLabel}</Text>
        )}

        {item.imageCount > 1 ? (
          <Text className='kdy-flea-card__count'>{item.imageCount} 图</Text>
        ) : null}
      </View>

      <View className='kdy-flea-card__body'>
        <Text className='kdy-flea-card__title'>{item.title}</Text>

        <Text className='kdy-flea-card__meta'>
          {item.conditionLabel}
          {item.campusSpot === null ? '' : ` · ${item.campusSpot}`}
        </Text>

        <View className='kdy-flea-card__foot'>
          <Text className={item.sold ? 'kdy-flea-card__price is-sold' : 'kdy-flea-card__price'}>
            ¥{item.priceLabel}
          </Text>
          {item.mine ? <Text className='kdy-flea-card__flag'>我的</Text> : null}
          {item.reservedByMe ? <Text className='kdy-flea-card__flag'>已预定</Text> : null}
        </View>

        <Text className='kdy-flea-card__time'>{item.timeLabel}</Text>
      </View>
    </View>
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

  /**
   * 下拉刷新：**保留当前筛选条件**，只把游标重置回第一页。
   * 与「重试」按钮走同一条路径（`load({ cursor: null })`），
   * 所以不存在「下拉刷新和搜索按钮行为不一致」这种经典问题。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void flea.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
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

      {state.status === 'loading' && <KdyListSkeleton />}

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

      {/* 双列商品网格：二手交易先看图、再看价 —— 一行一卡会把图压成缩略图 */}
      <View className='kdy-flea__grid'>
        {state.items.map((item) => (
          <FleaCard key={item.id} item={item} />
        ))}
      </View>

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
