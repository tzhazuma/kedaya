import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  buddyCreatePath,
  buddyDetailPath,
  buddyProfilePath,
  buddyRecommendationsPath,
} from '../../../../app/routes'
import {
  BUDDY_SECTION_DESCRIPTIONS,
  BUDDY_SECTION_LABELS,
  BUDDY_SECTIONS,
  BUDDY_SKILL_LEVEL_LABELS,
} from '../../../../domain/models/buddy'
import type { BuddyPostSummary, BuddySection } from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import {
  KdyBuddyPrivacyNotice,
  KdyButton,
  KdyCard,
  KdyEmpty,
  KdyProgress,
  KdyTag,
} from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 搭子列表页 —— 三板块分栏（`academic` / `daily` / `sport`）。
 *
 * 契约要点：
 * - **三板块**来自契约 §11.10-G 的裁决，`dating` 明确不做；
 * - **游标分页**（契约 §6.1，不用 offset）：`useReachBottom` → `loadMore()`；
 * - **下拉刷新**：`usePullDownRefresh` → `load()`；
 * - **启动时序**（契约 §8）：`hydrate()` 同步给缓存 → `load()` 后台刷新、失败静默降级；
 * - **三态齐全**：`loading` / `empty` / `error`（+ `ready`）。
 *
 * 页面顶部提供三个演示按钮，用来**真实**触发空态 / 错误态（走 mock 控制面，
 * 不是硬编码假状态）。
 *
 * ⚠️ tabBar **未改动**（任务硬性要求）：`buddy` 从首页宫格进入
 * （`MODULE_ENTRY_PATHS.buddy`）。
 */

type SectionFilter = BuddySection | 'all'

const SECTION_FILTERS: readonly SectionFilter[] = ['all', ...BUDDY_SECTIONS]

function sectionFilterLabel(filter: SectionFilter): string {
  return filter === 'all' ? '全部' : BUDDY_SECTION_LABELS[filter]
}

function statusTone(status: BuddyPostSummary['status']): KdyTagTone {
  if (status === 'OPEN') return 'brand'
  if (status === 'FULL') return 'success'
  if (status === 'CANCELLED') return 'danger'
  if (status === 'EXPIRED') return 'warning'
  return 'neutral'
}

/**
 * 搭子卡 —— **活动邀约**的定制化外观。
 *
 * 找搭子和刷商品不同：用户要判断的是「什么时候、在哪、还剩几个位置、有没有
 * 门槛」。所以卡片按这个顺序组织：
 *   1. 标题 + 状态（报名中 / 已满 / 已过期…）；
 *   2. 活动类型 + 时间 + 地点三行事实（左标签对齐，扫起来比一句
 *      `10月24日 14:00 · 羽毛球馆` 快）；
 *   3. **名额条**（已有 3/6 人）+「还差 N 人」；
 *   4. 标签（羽毛球 / 新手友好…）与门槛（仅同性 / 需要中级）；
 *   5. 发起人。
 */
function BuddyCard({ item }: { item: BuddyPostSummary }) {
  const full = item.remainingSlots === 0
  const requirements = [
    item.genderPreference === 'any' ? null : item.genderPreferenceLabel,
    item.minSkillLevel === null ? null : `需 ${BUDDY_SKILL_LEVEL_LABELS[item.minSkillLevel]}`,
  ].filter((text): text is string => text !== null)

  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(buddyDetailPath(item.id))
      }}
    >
      <View className='kdy-buddy-card'>
        <View className='kdy-buddy-card__head'>
          <Text className='kdy-buddy-card__title'>{item.title}</Text>
          <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
        </View>

        <View className='kdy-buddy-card__facts'>
          <View className='kdy-buddy-card__fact'>
            <Text className='kdy-buddy-card__fact-key'>活动</Text>
            <Text className='kdy-buddy-card__fact-value'>{item.activityLabel}</Text>
          </View>
          <View className='kdy-buddy-card__fact'>
            <Text className='kdy-buddy-card__fact-key'>时间</Text>
            <Text className='kdy-buddy-card__fact-value'>
              {item.startsAtLabel} · 约 {item.durationMin} 分钟
            </Text>
          </View>
          <View className='kdy-buddy-card__fact'>
            <Text className='kdy-buddy-card__fact-key'>地点</Text>
            <Text className='kdy-buddy-card__fact-value'>{item.location}</Text>
          </View>
        </View>

        <View className='kdy-buddy-card__slots'>
          <View className='kdy-buddy-card__slots-row'>
            <Text className='kdy-buddy-card__slots-text'>
              已有 {item.joinedCount} / {item.capacity} 人
            </Text>
            <Text className={full ? 'kdy-buddy-card__slots-left is-full' : 'kdy-buddy-card__slots-left'}>
              {full ? '已满员' : `还差 ${item.remainingSlots} 人`}
            </Text>
          </View>
          <KdyProgress
            className='kdy-buddy-card__slots-bar'
            percent={item.fillPercent}
            tone={full ? 'success' : 'brand'}
          />
        </View>

        {item.tagLabels.length > 0 && (
          <View className='kdy-buddy-card__tags'>
            {item.tagLabels.map((label) => (
              <KdyTag key={label} tone='neutral'>
                {label}
              </KdyTag>
            ))}
          </View>
        )}

        {requirements.length > 0 && (
          <Text className='kdy-buddy-card__requirements'>门槛：{requirements.join(' · ')}</Text>
        )}

        <View className='kdy-buddy-card__foot'>
          <Text className='kdy-buddy-card__creator'>发起人 {item.creatorName}</Text>
          <Text className='kdy-buddy-card__created'>{item.createdAtLabel}</Text>
        </View>
      </View>
    </KdyCard>
  )
}

export default function BuddyListPage() {
  const container = getContainer()
  const list = container.useCases.listBuddyPosts
  const state = useStore(list)
  const [section, setSection] = useState<SectionFilter>('all')

  function reload(next: SectionFilter): void {
    void list.load(next)
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    list.hydrate(section)
    reload(section)
  })

  usePullDownRefresh(() => {
    void list.load(section).then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void list.loadMore(section)
  })

  function handleSelectSection(next: SectionFilter): void {
    if (next === section) return
    setSection(next)
    // 先 hydrate 目标板块（若有缓存则立刻可见），再后台刷新
    list.hydrate(next)
    reload(next)
  }

  function handleSimulateError(): void {
    const mock = container.mockBuddyControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    reload(section)
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockBuddyControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    reload(section)
  }

  function handleResetDemo(): void {
    container.mockBuddyControls?.reset()
    reload(section)
  }

  return (
    <View className='kdy-page kdy-buddy-list'>
      {/* 三板块分栏（契约 §11.10-G：只有 academic / daily / sport，没有 dating） */}
      <View className='kdy-buddy-list__tabs'>
        {SECTION_FILTERS.map((filter) => (
          <View
            key={filter}
            className={`kdy-buddy-list__tab${
              filter === section ? ' kdy-buddy-list__tab--active' : ''
            }`}
            onClick={() => handleSelectSection(filter)}
          >
            <Text className='kdy-buddy-list__tab-text'>{sectionFilterLabel(filter)}</Text>
          </View>
        ))}
      </View>

      {/* 板块说明：切到某个板块时告诉用户这里会有什么，
          「全部」时给一句总括。三个板块的差异是**内容**差异，不是视觉差异。 */}
      <Text className='kdy-buddy-list__section-hint'>
        {section === 'all'
          ? '学术自习 / 日常搭子 / 运动组队 —— 三个板块各自发布'
          : BUDDY_SECTION_DESCRIPTIONS[section]}
      </Text>

      <View className='kdy-buddy-list__actions'>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(buddyCreatePath(section))}>
          发布搭子
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(buddyRecommendationsPath(section))}>
          为我推荐
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(buddyProfilePath())}>
          我的匹配资料
        </KdyButton>
      </View>

      <View className='kdy-buddy-list__demo'>
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
        <KdyEmpty mode='loading' description='正在拉取搭子列表' />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => reload(section)}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='这个板块还没有搭子，去发起一个吧'
          actionText='重置演示数据'
          onAction={handleResetDemo}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.items.map((item) => (
            <BuddyCard key={item.id} item={item} />
          ))}

          {state.loadingMore && <Text className='kdy-buddy-list__more'>正在加载更多…</Text>}
          {!state.loadingMore && state.nextCursor === null && state.items.length > 0 && (
            <Text className='kdy-buddy-list__more'>没有更多了</Text>
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-buddy-list__soft-error'>
          刷新失败：{state.error}
        </Text>
      )}

      {/* 隐私提示（规格 §6，硬要求） */}
      <KdyBuddyPrivacyNotice compact />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
