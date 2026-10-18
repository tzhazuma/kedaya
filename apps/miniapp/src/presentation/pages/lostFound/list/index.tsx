import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, lostFoundDetailPath } from '../../../../app/routes'
import {
  LOST_FOUND_KINDS,
  LOST_FOUND_KIND_HINTS,
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
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyImageThumb, KdyListSkeleton, KdyTag } from '../../../components'
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

/**
 * 登记卡 —— 失物招领的**定制化**外观。
 *
 * 与别的模块不同，这里的信息顺序由「怎么找到东西」决定：
 *   1. **在哪儿、什么时候**（匹配物品的主线索）紧贴标题，用固定标签对齐，
 *      扫列表时两列对齐比一句 `图书馆 · 2 小时前` 好读得多；
 *   2. 描述预览只给一行（细节在详情页）；
 *   3. 左侧一条**类型色带** + 文字徽标：寻物（品牌黄）/ 招领（中性灰），
 *      「我把东西丢了」和「我捡到东西了」是两种完全不同的行动，视觉上先分开。
 */
function LostFoundCard({ item }: { item: LostFoundItemSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(lostFoundDetailPath(item.id))
      }}
    >
      <View className={item.kind === 'found' ? 'kdy-lost-card is-found' : 'kdy-lost-card is-lost'}>
        <View className='kdy-lost-card__rail' />

        <View className='kdy-lost-card__body'>
          <View className='kdy-lost-card__head'>
            <Text className='kdy-lost-card__badge'>{item.badge}</Text>
            <Text className='kdy-lost-card__title'>{item.title}</Text>
            <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
          </View>

          <View className='kdy-lost-card__facts'>
            <View className='kdy-lost-card__fact'>
              <Text className='kdy-lost-card__fact-key'>地点</Text>
              <Text className='kdy-lost-card__fact-value'>{item.place}</Text>
            </View>
            <View className='kdy-lost-card__fact'>
              <Text className='kdy-lost-card__fact-key'>时间</Text>
              <Text className='kdy-lost-card__fact-value'>{item.happenedLabel}</Text>
            </View>
          </View>

          {item.descriptionPreview === '' ? null : (
            <Text className='kdy-lost-card__preview'>{item.descriptionPreview}</Text>
          )}

          <Text className='kdy-lost-card__foot'>
            {item.mine ? '我发布的 · ' : ''}
            发布 {item.createdLabel}
          </Text>
        </View>

        {item.thumbnailUrl === null ? null : (
          <KdyImageThumb
            className='kdy-lost-card__cover'
            url={item.thumbnailUrl}
            count={item.imageCount}
          />
        )}
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

  /**
   * 下拉刷新：**保留当前筛选条件**，只把游标重置回第一页。
   * 与「重试」按钮走同一条路径（`load({ cursor: null })`），
   * 所以不存在「下拉刷新和搜索按钮行为不一致」这种经典问题。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void lostFound.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
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
        subtitle='丢了或被捡到，都可以在这里登记。'
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

      {/* 类型是失物招领的**第一决策**（我在找东西 / 我看到东西），
          所以从「筛选」里提上来做成两段式切换，并配一句当前口径的说明。 */}
      <View className='kdy-lost__kinds'>
        <KdyChip active={filters.kind === undefined} onClick={() => refresh({ kind: undefined })}>
          全部
        </KdyChip>
        {LOST_FOUND_KINDS.map((kind) => (
          <KdyChip key={kind} active={filters.kind === kind} onClick={() => refresh({ kind })}>
            {LOST_FOUND_KIND_LABELS[kind]}
          </KdyChip>
        ))}
      </View>
      <Text className='kdy-lost__kind-hint'>
        {filters.kind === undefined
          ? '寻物启事 = 我丢了东西；招领启事 = 我捡到了东西'
          : LOST_FOUND_KIND_HINTS[filters.kind]}
      </Text>

      {showFilters && (
        <KdyCard elevated={false}>
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

      {state.status === 'loading' && <KdyListSkeleton />}

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
        第三方非官方平台 · 与上海科技大学官方系统无关。证件类物品请交到保卫处或失物招领柜，不要只发在线上。
      </Text>
    </View>
  )
}
