import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  PAGE_PATHS,
  activityDetailPath,
  activityComposePath,
  activityImportPath,
  activityMailPath,
  activityRemindersPath,
} from '../../../../app/routes'
import {
  ACTIVITY_SOURCE_FILTERS,
  ACTIVITY_SOURCE_FILTER_LABELS,
  ACTIVITY_TAB_LABELS,
  ACTIVITY_TABS,
  type ActivitySourceFilter,
  type ActivityTab,
  type ActivityView,
} from '../../../../domain/models/activity'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import { buildActivityListView } from './activityListView'
import './index.scss'

/**
 * 校园活动 · 列表页。
 *
 * 四个 tab 的顺序按用户当下最急的问题排：
 *   待确认（要不要去）→ 今天（今天几点）→ 本周（这周还有什么）→ 全部。
 *
 * 来源只有三种：校园邮箱 / 公众号 / 手动。筛选在客户端即时完成，
 * 切 tab 不等网络；候选活动**只有确认后才**出现在今天 / 本周。
 */

function ActivityCard({ item, onOpen }: { item: ActivityView; onOpen: () => void }) {
  const confidenceTone =
    item.confidenceTone === 'high' ? 'success' : item.confidenceTone === 'medium' ? 'warning' : 'neutral'
  const deadlineTone = item.deadline?.passed
    ? 'neutral'
    : item.deadline?.urgent
      ? 'warning'
      : 'info'

  return (
    <KdyCard elevated={false} onClick={onOpen}>
      <View
        className='kdy-activity-card'
        aria-role='button'
        aria-label={`${item.title}，${item.whenLabel}，${item.statusLabel}`}
      >
        <View className='kdy-activity-card__head'>
          <Text className='kdy-activity-card__title'>{item.title}</Text>
          <KdyTag
            tone={
              item.isCandidate
                ? 'brand'
                : item.status === 'confirmed'
                  ? 'success'
                  : 'neutral'
            }
          >
            {item.statusLabel}
          </KdyTag>
        </View>

        <View className='kdy-activity-card__meta'>
          <Text className='kdy-activity-card__source'>
            {item.sourceLabel} · {item.kindLabel}
          </Text>
          <Text className='kdy-activity-card__time'>{item.whenLabel}</Text>
        </View>

        {item.location !== null || item.organizer !== null ? (
          <Text className='kdy-activity-card__where'>
            {[item.location, item.organizer].filter((value) => value !== null).join(' · ')}
          </Text>
        ) : null}

        {item.deadline !== null ? (
          <Text className={`kdy-activity-card__deadline kdy-activity-card__deadline--${deadlineTone}`}>
            {item.deadline.label}
          </Text>
        ) : null}

        {item.evidenceText !== '' ? (
          <Text className='kdy-activity-card__evidence'>{item.evidenceText}</Text>
        ) : null}

        <View className='kdy-activity-card__foot'>
          <KdyTag tone={confidenceTone}>可信度 {item.confidenceLabel}</KdyTag>
          {item.stale ? <KdyTag tone='warning'>上次同步结果</KdyTag> : null}
        </View>
      </View>
    </KdyCard>
  )
}

export default function ActivitiesListPage() {
  const container = getContainer()
  const activities = container.useCases.activities
  const state = useStore(activities.list)
  const session = useStore(container.useCases.session)
  const loggedIn = session.tokens !== null && session.profile !== null
  const [tab, setTab] = useState<ActivityTab>('pending')
  const [source, setSource] = useState<ActivitySourceFilter>('all')

  useEffect(() => {
    if (!loggedIn) return
    activities.list.hydrate()
    void activities.list.load()
  }, [activities, loggedIn])

  useDidShow(() => {
    if (!loggedIn) return
    void activities.list.load()
  })

  usePullDownRefresh(() => {
    if (!loggedIn) {
      void Taro.stopPullDownRefresh()
      return
    }
    void activities.list.load().finally(() => {
      void Taro.stopPullDownRefresh()
    })
  })

  const view = buildActivityListView(state.items, { tab, source }, new Date())

  function emptyAction(): void {
    if (tab === 'pending' || tab === 'all') {
      void navigateTo(activityImportPath())
      return
    }
    setTab('pending')
  }

  if (!loggedIn) {
    return (
      <View className='kdy-page kdy-activities'>
        <KdyHeading
          title='校园活动'
          subtitle='从校园邮箱和公众号收集；确认后才加入日程、才建提醒。'
        />
        <KdyEmpty
          title='登录后查看活动'
          description='活动列表与校园邮箱绑定都跟账号走；登录后才会加载你的候选活动。'
          actionText='去登录'
          onAction={() => {
            void navigateTo(PAGE_PATHS.authLogin)
          }}
        />
        <Text className='kdy-disclaimer'>
          第三方非官方平台 · 与上海科技大学官方系统无关。
        </Text>
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-activities'>
      <KdyHeading
        title='校园活动'
        subtitle='从校园邮箱和公众号收集；确认后才加入日程、才建提醒。'
      />

      <View className='kdy-activities__actions'>
        <KdyButton block onClick={() => void navigateTo(activityImportPath())}>
          导入公众号文章
        </KdyButton>
        <KdyButton
          size='md'
          variant='secondary'
          block
          onClick={() => void navigateTo(activityComposePath())}
        >
          手动添加活动
        </KdyButton>
        <View className='kdy-activities__secondary'>
          <KdyButton
            size='md'
            variant='secondary'
            block
            onClick={() => void navigateTo(activityMailPath())}
          >
            校园邮箱
          </KdyButton>
          <KdyButton
            size='md'
            variant='secondary'
            block
            onClick={() => void navigateTo(activityRemindersPath())}
          >
            提醒
          </KdyButton>
        </View>
      </View>

      <View className='kdy-activities__filters'>
        {ACTIVITY_TABS.map((item) => {
          const count = view.counts[item]
          return (
            <KdyChip key={item} active={tab === item} onClick={() => setTab(item)}>
              {ACTIVITY_TAB_LABELS[item]}
              {count > 0 ? ` ${count}` : ''}
            </KdyChip>
          )
        })}
      </View>

      <View className='kdy-activities__filters kdy-activities__filters--source'>
        {ACTIVITY_SOURCE_FILTERS.map((item) => (
          <KdyChip key={item} active={source === item} onClick={() => setSource(item)}>
            {ACTIVITY_SOURCE_FILTER_LABELS[item]}
          </KdyChip>
        ))}
      </View>

      {(state.status === 'idle' || state.status === 'loading') && state.items.length === 0 ? (
        <KdyListSkeleton rows={4} />
      ) : null}

      {state.status === 'error' ? (
        <KdyEmpty
          mode='error'
          title='活动加载失败'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => {
            void activities.list.load()
          }}
        />
      ) : null}

      {view.rows.length > 0 ? (
        <View className='kdy-activities__list' aria-role='list'>
          {view.rows.map((item) => (
            <View key={item.id} aria-role='listitem'>
              <ActivityCard
                item={item}
                onOpen={() => {
                  void navigateTo(activityDetailPath(item.id))
                }}
              />
            </View>
          ))}
        </View>
      ) : null}

      {state.status !== 'idle' &&
      state.status !== 'loading' &&
      state.status !== 'error' &&
      view.rows.length === 0 ? (
        <KdyEmpty
          title={view.emptyTitle}
          description={view.emptyDescription}
          actionText={tab === 'pending' || tab === 'all' ? '导入公众号文章' : '看待确认'}
          onAction={emptyAction}
        />
      ) : null}

      {state.loadingMore ? <Text className='kdy-activities__more'>加载中…</Text> : null}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。活动时间以主办方通知为准。
      </Text>
    </View>
  )
}
