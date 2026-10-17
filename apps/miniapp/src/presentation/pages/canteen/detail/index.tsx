import { Text, View } from '@tarojs/components'
import { useDidShow, useShareAppMessage, useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, canteenDetailPath, readIdParam } from '../../../../app/routes'
import {
  CANTEEN_DISCLAIMER,
  calorieLevelLabel,
  caloriesLabel,
  macroLabel,
  priceLabel,
} from '../../../../domain/models/canteen'
import type { CanteenCalorieSummary, CanteenDish } from '../../../../domain/models/canteen'
import type { ReportTargetType } from '../../../../domain/models/report'
import {
  KdyButton,
  KdyCard,
  KdyEmpty,
  KdyReportEntry,
  KdyShareEntry,
  KdyTag,
} from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 食堂营养详情页。
 *
 * 三块内容：
 *   1. **营养成分表** —— 热量（千卡）/ 蛋白 / 脂肪 / 碳水（克），价格分 → 元；
 *   2. **该食堂汇总** —— 学生看的是"这个食堂整体怎么样"，
 *      数据来自 `GET /canteen/calories?canteen=`（真实聚合，不是客户端累加）；
 *   3. 分享 / 举报入口 —— UGC 数据的合规底线。
 *
 * 举报目标类型 `'canteen-dish'` 与后端 `REPORT_TARGET_TYPES` 一一对应
 * （两边白名单必须同步：漂移的后果是提交时 400，不是静默失败）。
 */
const CANTEEN_REPORT_TARGET_TYPE: ReportTargetType = 'canteen-dish'

export default function CanteenDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const canteen = container.useCases.canteen
  const detail = useStore(canteen.detail)

  const [summary, setSummary] = useState<CanteenCalorieSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  useDidShow(() => {
    if (id !== null) void canteen.detail.load(id)
  })

  const canteenName = detail.data?.canteen ?? null

  useEffect(() => {
    if (canteenName === null) return undefined
    let cancelled = false
    setSummaryLoading(true)
    setSummaryError(null)
    void canteen.calories(canteenName).then((result) => {
      if (cancelled) return
      setSummaryLoading(false)
      if (result.ok) setSummary(result.value)
      else setSummaryError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [canteen, canteenName])

  /**
   * 分享给好友：转发标题带菜品与食堂，落地路径**带上 id**，
   * 好友点开看到的就是这一条，而不是被丢回列表里再找一遍。
   */
  useShareAppMessage(() => ({
    title:
      detail.data === null
        ? '可达鸭 · 食堂营养'
        : `${detail.data.name}（${detail.data.canteen}）· 可达鸭`,
    path: id === null ? PAGE_PATHS.canteenList : canteenDetailPath(id),
  }))

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少菜品 id，请从列表进入' />
      </View>
    )
  }

  if (detail.status === 'loading' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='loading' />
      </View>
    )
  }

  if (detail.status === 'error' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty
          mode='error'
          title='没能打开这道菜'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void canteen.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='菜品不存在或已下架' />
      </View>
    )
  }

  // 已经过 null 校验：用非空局部变量，闭包里也能安全取用
  const dish: CanteenDish = detail.data

  return (
    <View className='kdy-page kdy-canteen-detail'>
      <KdyHeading
        title={dish.name}
        subtitle={`${dish.canteen} · ${caloriesLabel(dish.caloriesKcal)}`}
        eyebrow='KEDAYA · 食堂营养'
      />

      <KdyCard title='营养成分表' elevated={false}>
        <View className='kdy-canteen-detail__hero'>
          <View className='kdy-canteen-detail__calories'>
            <Text className='kdy-canteen-detail__calories-value'>{dish.caloriesKcal}</Text>
            <Text className='kdy-canteen-detail__calories-unit'>千卡</Text>
          </View>
          <View className='kdy-canteen-detail__tags'>
            <KdyTag tone='brand'>{dish.canteen}</KdyTag>
            <KdyTag tone='neutral'>{calorieLevelLabel(dish.caloriesKcal)}</KdyTag>
          </View>
        </View>

        <View className='kdy-canteen-detail__rows'>
          <View className='kdy-canteen-detail__row'>
            <Text className='kdy-canteen-detail__k'>热量</Text>
            <Text className='kdy-canteen-detail__v'>{caloriesLabel(dish.caloriesKcal)}</Text>
          </View>
          <View className='kdy-canteen-detail__row'>
            <Text className='kdy-canteen-detail__k'>蛋白质</Text>
            <Text className='kdy-canteen-detail__v'>{macroLabel(dish.proteinG)}</Text>
          </View>
          <View className='kdy-canteen-detail__row'>
            <Text className='kdy-canteen-detail__k'>脂肪</Text>
            <Text className='kdy-canteen-detail__v'>{macroLabel(dish.fatG)}</Text>
          </View>
          <View className='kdy-canteen-detail__row'>
            <Text className='kdy-canteen-detail__k'>碳水化合物</Text>
            <Text className='kdy-canteen-detail__v'>{macroLabel(dish.carbG)}</Text>
          </View>
          <View className='kdy-canteen-detail__row'>
            <Text className='kdy-canteen-detail__k'>参考价格</Text>
            <Text className='kdy-canteen-detail__v'>{priceLabel(dish.priceFen)}</Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title='该食堂汇总' elevated={false}>
        {summaryLoading && <Text className='kdy-canteen-detail__hint'>正在统计…</Text>}

        {summaryError !== null && (
          <Text className='kdy-canteen-detail__error'>{summaryError}</Text>
        )}

        {!summaryLoading && summaryError === null && summary !== null && (
          <View className='kdy-canteen-detail__rows'>
            <View className='kdy-canteen-detail__row'>
              <Text className='kdy-canteen-detail__k'>已收录菜品</Text>
              <Text className='kdy-canteen-detail__v'>{summary.dishes} 道</Text>
            </View>
            <View className='kdy-canteen-detail__row'>
              <Text className='kdy-canteen-detail__k'>合计热量</Text>
              <Text className='kdy-canteen-detail__v'>
                {caloriesLabel(summary.totalCaloriesKcal)}
              </Text>
            </View>
            <View className='kdy-canteen-detail__row'>
              <Text className='kdy-canteen-detail__k'>人均价格</Text>
              <Text className='kdy-canteen-detail__v'>{priceLabel(summary.avgPriceFen)}</Text>
            </View>
          </View>
        )}
      </KdyCard>

      {summaryError !== null && (
        <View className='kdy-canteen-detail__actions'>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              if (canteenName === null) return
              setSummaryError(null)
              setSummaryLoading(true)
              void canteen.calories(canteenName).then((result) => {
                setSummaryLoading(false)
                if (result.ok) setSummary(result.value)
                else setSummaryError(result.error.message)
              })
            }}
          >
            重新统计
          </KdyButton>
        </View>
      )}

      {detail.error !== null && <Text className='kdy-canteen-detail__error'>{detail.error}</Text>}

      <KdyShareEntry />

      <KdyReportEntry
        targetType={CANTEEN_REPORT_TARGET_TYPE}
        targetId={dish.id}
        targetTitle={dish.name}
      />

      <Text className='kdy-disclaimer'>
        {CANTEEN_DISCLAIMER}。营养值为同学估算，实际以食堂标注为准；可达鸭是第三方非官方校园服务平台。
      </Text>
    </View>
  )
}
