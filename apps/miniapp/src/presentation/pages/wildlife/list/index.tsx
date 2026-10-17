import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, wildlifeDetailPath } from '../../../../app/routes'
import { WILDLIFE_GUARD_HINT, mergeSpeciesOptions } from '../../../../domain/models/wildlife'
import type { WildlifeSpotFilters, WildlifeSpotSummary } from '../../../../domain/models/wildlife'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 校园动物观察点列表页。
 *
 * 契约 §8 启动时序在这里落地：`useDidShow` → `hydrate()`（同步、秒出缓存）
 * → `load()`（后台刷新，失败静默降级）。
 *
 * 筛选维度只有一个，和 `wildlife.controller.ts` 的 `listQuerySchema` 一样是
 * `species`（包含匹配 + 忽略大小写）。**没有状态筛选**：后端 `status` 还是自由
 * 字符串，客户端不替它编一份白名单（详见 `domain/models/wildlife.ts` 头注）。
 *
 * 列表顶部常驻一句保护提示（`WILDLIFE_GUARD_HINT`），刻意做成一行说明文字
 * 而不是醒目横幅 —— 它要一直看得见，但不该让整页看起来像在报警。
 */

function WildlifeCard({ item }: { item: WildlifeSpotSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(wildlifeDetailPath(item.id))
      }}
    >
      <View className='kdy-wildlife-card'>
        <View className='kdy-wildlife-card__head'>
          <Text className='kdy-wildlife-card__species'>{item.species}</Text>
          <KdyTag tone={item.confirmed ? 'success' : 'neutral'}>{item.statusLabel}</KdyTag>
        </View>
        <Text className='kdy-wildlife-card__place'>{item.place}</Text>
        {item.notePreview === '' ? null : (
          <Text className='kdy-wildlife-card__note'>{item.notePreview}</Text>
        )}
        <View className='kdy-wildlife-card__foot'>
          <Text className='kdy-wildlife-card__time'>上报 {item.createdLabel}</Text>
          <Text className='kdy-wildlife-card__time'>{item.coordinateLabel}</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function WildlifeListPage() {
  const container = getContainer()
  const wildlife = container.useCases.wildlife
  const state = useStore(wildlife.list)

  const filters = state.query as WildlifeSpotFilters

  function refresh(patch: Partial<WildlifeSpotFilters> = {}): void {
    void wildlife.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    wildlife.list.hydrate()
    refresh()
  })

  /**
   * 下拉刷新：**保留当前筛选条件**，只把游标重置回第一页。
   * 与「重试」按钮走同一条路径（`load({ cursor: null })`），因此不存在
   * 「下拉刷新和搜索按钮行为不一致」这种经典问题。
   * 转圈必须等请求真的结束再收 —— 早收会让用户以为刷完了，其实还没到。
   */
  usePullDownRefresh(() => {
    void wildlife.list.load({ cursor: null }).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void wildlife.list.loadMore()
  })

  /**
   * 筛选候选：**当前选中值 + 已加载数据里去重后的物种 + domain 里的常见物种建议**。
   * 后端没有物种字典，所以这只是一个"让人不用凭空想词"的辅助列表。
   */
  const speciesOptions = mergeSpeciesOptions(
    state.items.map((item) => item.species),
    filters.species,
  )

  return (
    <View className='kdy-page kdy-wildlife'>
      <KdyHeading
        title='校园动物观察点'
        subtitle='同学共建的校园动物出没地图：上报你在哪儿见到了什么，也能看别人看到过的点。'
        eyebrow='KEDAYA · 猫鸟黑天鹅'
      />

      <View className='kdy-wildlife__notice'>
        <Text className='kdy-wildlife__notice-text'>
          这些位置是同学口头/手填报的观察记录，不是精确的动物档案；进详情可以在地图上看看大概在哪。
        </Text>
        <Text className='kdy-wildlife__guard'>{WILDLIFE_GUARD_HINT}</Text>
      </View>

      <View className='kdy-wildlife__filters'>
        <Text className='kdy-wildlife__filter-label'>物种</Text>
        <View className='kdy-wildlife__chips'>
          <KdyChip
            active={filters.species === undefined}
            onClick={() => {
              refresh({ species: undefined })
            }}
          >
            全部
          </KdyChip>
          {speciesOptions.map((species) => (
            <KdyChip
              key={species}
              active={filters.species === species}
              onClick={() => {
                refresh({ species })
              }}
            >
              {species}
            </KdyChip>
          ))}
        </View>
      </View>

      {state.fromCache && state.status === 'ready' && (
        <Text className='kdy-wildlife__cache-hint'>正在后台刷新…</Text>
      )}

      {state.status === 'loading' && <KdyListSkeleton />}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有符合条件的观察点'
          description={
            filters.species === undefined
              ? '先在校园里走走，看到什么就上报一条，别人也能看到。'
              : '换一个物种，或者清掉筛选看看全部记录。'
          }
          actionText={filters.species === undefined ? '去上报' : '清空筛选'}
          onAction={() => {
            if (filters.species === undefined) {
              void navigateTo(PAGE_PATHS.wildlifeCreate)
              return
            }
            refresh({ species: undefined })
          }}
        />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到观察点列表'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => refresh()}
        />
      )}

      {state.items.map((item) => (
        <WildlifeCard key={item.id} item={item} />
      ))}

      {state.nextCursor !== null && state.status === 'ready' && (
        <View className='kdy-wildlife__more'>
          <KdyButton
            size='sm'
            variant='ghost'
            loading={state.loadingMore}
            onClick={() => {
              void wildlife.list.loadMore()
            }}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-wildlife__inline-error'>{state.error}</Text>
      )}

      <View className='kdy-wildlife__fab'>
        <KdyButton
          onClick={() => {
            void navigateTo(PAGE_PATHS.wildlifeCreate)
          }}
        >
          上报观察点
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。观察记录由同学上报，坐标是近似值。拍摄请保持距离，不要投喂、不要追赶，也不要为了拍清楚把野生动物困住。
      </Text>
    </View>
  )
}
