import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, errandDetailPath } from '../../../../app/routes'
import {
  ERRAND_SORT_LABELS,
  ERRAND_SORTS,
  ERRAND_STATUSES,
  ERRAND_STATUS_LABELS,
} from '../../../../domain/models/errand'
import type {
  ErrandScope,
  ErrandSort,
  ErrandStatus,
  ErrandTaskSummary,
} from '../../../../domain/models/errand'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyListSkeleton, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 跑腿列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度与后端 `errand.controller.ts` 的 listQuerySchema 一一对应：
 * 关键词（`q`）/ 状态 / 出发地 / 目的地 / 排序 / 范围（`mine=1`、`role=runner`）。
 * 「我发布的 / 我接的」需要登录 —— 未登录时直接引导去登录页，
 * 而不是发一个注定 401 的请求。
 */

const SCOPES: readonly ErrandScope[] = ['all', 'requester', 'runner']

function scopeLabel(scope: ErrandScope): string {
  if (scope === 'requester') return '我发布的'
  if (scope === 'runner') return '我接的单'
  return '全部同学'
}

function statusTone(status: ErrandStatus): KdyTagTone {
  if (status === 'open') return 'brand'
  if (status === 'accepted') return 'info'
  if (status === 'delivered') return 'warning'
  if (status === 'completed') return 'success'
  return 'neutral'
}

/**
 * 任务卡 —— 跑腿列表的**定制化**外观（不是通用「标题 + 摘要 + 标签」卡片）。
 *
 * 跑腿只关心三件事，卡片就给它们三个**固定位置**：
 *   1. **赏金**（值不值得跑）→ 左下角大字，带「赏金」小标；
 *   2. **路线**（顺不顺路）→ 中部两条站点导轨（取 → 送），
 *      把"起点终点"从一行 `A → B` 变成可扫的结构，长地点名自动换行；
 *   3. **截止**（来不来得及）→ 右下角，临期（≤2 小时）换警示色、已过期置灰。
 * 另外，「等待接单 / 已有同学接单」是接单者的行动信号，单独占一行而不是混进状态标签。
 */
function ErrandCard({ task }: { task: ErrandTaskSummary }) {
  const relation = task.mine ? '我发布的' : task.takenByMe ? '我接的单' : null
  const deadlineClass =
    'kdy-errand-card__deadline' +
    (task.deadlinePassed ? ' is-passed' : task.deadlineUrgent ? ' is-urgent' : '')

  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(errandDetailPath(task.id))
      }}
    >
      <View className='kdy-errand-card'>
        <View className='kdy-errand-card__head'>
          <Text className='kdy-errand-card__title'>{task.title}</Text>
          <KdyTag tone={statusTone(task.status)}>{task.statusLabel}</KdyTag>
        </View>

        <View className='kdy-errand-card__stops'>
          <View className='kdy-errand-card__stop'>
            <Text className='kdy-errand-card__stop-key'>取</Text>
            <Text className='kdy-errand-card__stop-place'>{task.fromPlace}</Text>
          </View>
          <View className='kdy-errand-card__stop'>
            <Text className='kdy-errand-card__stop-key kdy-errand-card__stop-key--to'>送</Text>
            <Text className='kdy-errand-card__stop-place'>{task.toPlace}</Text>
          </View>
        </View>

        {task.detailPreview !== '' && (
          <Text className='kdy-errand-card__preview'>{task.detailPreview}</Text>
        )}

        <View className='kdy-errand-card__foot'>
          <View className='kdy-errand-card__reward'>
            <Text className='kdy-errand-card__reward-label'>赏金</Text>
            <Text className='kdy-errand-card__reward-value'>¥{task.rewardLabel}</Text>
          </View>
          <Text className={deadlineClass}>{task.deadlineLabel}</Text>
        </View>

        <Text className='kdy-errand-card__meta'>
          {relation ?? (task.hasRunner ? '已有同学接单' : '等待接单')}
          {' · '}
          {task.timeLabel}
        </Text>
      </View>
    </KdyCard>
  )
}

export default function ErrandListPage() {
  const container = getContainer()
  const errand = container.useCases.errand
  const state = useStore(errand.list)

  const [keyword, setKeyword] = useState('')
  const [fromPlace, setFromPlace] = useState('')
  const [toPlace, setToPlace] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filters = state.query as {
    status?: ErrandStatus
    sort?: ErrandSort
    scope?: ErrandScope
    keyword?: string
    fromPlace?: string
    toPlace?: string
  }

  function refresh(patch: Parameters<typeof errand.list.load>[0] = {}): void {
    void errand.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    errand.list.hydrate()
    refresh()
  })

  /**
   * 下拉刷新：**保留当前筛选条件**，只把游标重置回第一页。
   * 与「重试」按钮走同一条路径（`load({ cursor: null })`），
   * 所以不存在「下拉刷新和搜索按钮行为不一致」这种经典问题。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void errand.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void errand.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  function normalize(value: string): string | undefined {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }

  return (
    <View className='kdy-page kdy-errand'>
      <KdyHeading
        title='跑腿互助'
        subtitle='代取、代买、代送；悬赏由同学间自行结算。'
      />

      <View className='kdy-errand__toolbar'>
        <View className='kdy-errand__search'>
          <KdyField
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索任务标题或明细'
            maxLength={60}
          />
        </View>
        <KdyButton
          size='sm'
          onClick={() => {
            refresh({
              keyword: normalize(keyword),
              fromPlace: normalize(fromPlace),
              toPlace: normalize(toPlace),
            })
          }}
        >
          搜索
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? '收起' : '筛选'}
        </KdyButton>
      </View>

      {/* 跑腿的两个**高频**维度直接放在列表上方，不进「筛选」折叠面板：
          范围（全部 / 我发布的 / 我接的单）与排序（最新 / 赏金最高 / 即将截止）。
          跑腿的日常用法就是"看我发的、看我能接的"，藏起来等于没有。 */}
      <View className='kdy-errand__scopes'>
        {SCOPES.map((scope) => (
          <KdyChip
            key={scope}
            active={(filters.scope ?? 'all') === scope}
            disabled={scope !== 'all' && container.useCases.session.getSnapshot().tokens === null}
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

      <View className='kdy-errand__sorts'>
        {ERRAND_SORTS.map((sort) => (
          <KdyChip
            key={sort}
            active={(filters.sort ?? 'latest') === sort}
            onClick={() => refresh({ sort })}
          >
            {ERRAND_SORT_LABELS[sort]}
          </KdyChip>
        ))}
      </View>

      {showFilters && (
        <KdyCard elevated={false}>
          <Text className='kdy-errand__filter-label'>状态</Text>
          <View className='kdy-errand__chips'>
            <KdyChip
              active={filters.status === undefined}
              onClick={() => refresh({ status: undefined })}
            >
              全部
            </KdyChip>
            {ERRAND_STATUSES.map((status) => (
              <KdyChip
                key={status}
                active={filters.status === status}
                onClick={() => refresh({ status })}
              >
                {ERRAND_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-errand__filter-label'>出发地 / 目的地</Text>
          <KdyField
            label='出发地'
            value={fromPlace}
            onChange={setFromPlace}
            placeholder='精确匹配，例如：菜鸟驿站（选填）'
            maxLength={60}
          />
          <KdyField
            label='目的地'
            value={toPlace}
            onChange={setToPlace}
            placeholder='精确匹配，例如：3 号楼（选填）'
            maxLength={60}
          />
          <View className='kdy-errand__filter-actions'>
            <KdyButton
              size='sm'
              onClick={() => {
                refresh({
                  keyword: normalize(keyword),
                  fromPlace: normalize(fromPlace),
                  toPlace: normalize(toPlace),
                })
              }}
            >
              应用筛选
            </KdyButton>
            <KdyButton
              size='sm'
              variant='ghost'
              onClick={() => {
                setKeyword('')
                setFromPlace('')
                setToPlace('')
                refresh({
                  keyword: undefined,
                  fromPlace: undefined,
                  toPlace: undefined,
                  status: undefined,
                  scope: 'all',
                  sort: 'latest',
                })
              }}
            >
              重置
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有这类跑腿任务'
          description='换个筛选条件，或者发布你的第一条求助。'
          actionText='去发布'
          onAction={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.errandCreate)
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到跑腿列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((task) => (
        <ErrandCard key={task.id} task={task} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-errand__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void errand.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-errand__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-errand__fab'>
        <KdyButton
          onClick={() => {
            if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.errandCreate)
          }}
        >
          发布跑腿
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。悬赏属同学间自愿互助，平台不参与资金结算。
      </Text>
    </View>
  )
}
