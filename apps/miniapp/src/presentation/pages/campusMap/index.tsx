import { Image, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { CAMPUS_POI_CATEGORY_LABELS, type CampusPoiCategory } from '@kedaya/contracts'
import { useEffect, useMemo, useState } from 'react'

import {
  buildCampusPoiNextStops,
  buildCampusPoiRows,
  campusPoiCategoriesPresent,
  createCampusPoiBoardUseCase,
  type CampusPoiCategoryFilter,
} from '../../../application/campusPoi/campusPoiBoard'
import { createCampusPoiLocalRepository } from '../../../data/repositories/campusPoiLocalRepository'
import { KdyCard, KdyChip, KdyEmpty, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'

import './index.scss'

/**
 * 校园地点（`campusMap`）—— 快递站 / 车库 / 食堂菜单 / 活动场地 / 自习空间。
 *
 * ## 这一轮刻意没有地图
 *
 * 契约先把 5 类 POI 与「挂在地点上的时间安排」建模，界面这一轮只回答两个问题：
 * 「校园里有哪些补充点位」和「我接下来要去哪」。真正的底图 / 标注留到下一轮，
 * 所以页面里没有 `<map>`、没有地图 SDK，也没有为了"像地图"而画的假底图。
 *
 * ## 数据来源与演示标注
 *
 * 这一轮没有后端 POI 接口，数据只在本机 storage（`campusPoiLocalRepository`）。
 * 首次读取播种 5 条**演示数据**，名字统一带「【演示】」前缀；页面常驻横幅说明
 * 「不是真实采集」。没有点位时走空态，不会白屏。
 *
 * ## ⚠️ 照片版权
 *
 * 本页**不内置任何图片**。`photoUrls` 为空时画「分类文字 + 暂无照片」的占位；
 * 只有通过契约 `validatePoiSupplement()` 的**已授权** URL 才会渲染（且必须带
 * `photoCredit`）。`map.niyiwei.com` 的图片在仓储层就被拒收 —— 不抓取、不镜像。
 *
 * ## 状态机
 *
 * 本机数据没有网络失败态：`hydrate()` 同步读完就是终态。页面只读 `useStore`
 * 的快照，不自己写 loading 布尔值。
 */

/** 用例是页面级单例：`useDidShow` 返回本页时重新 hydrate，storage 是唯一真相 */
const board = createCampusPoiBoardUseCase({
  store: createCampusPoiLocalRepository(),
})

/** 「还有多久」每 30 秒重算一次；分钟级文案不需要更密 */
const CLOCK_TICK_MS = 30 * 1000

export default function CampusMapPage() {
  const state = useStore(board)
  const [now, setNow] = useState<Date>(() => new Date())
  const [category, setCategory] = useState<CampusPoiCategoryFilter>('all')

  useDidShow(() => {
    board.hydrate()
    setNow(new Date())
  })

  useEffect(() => {
    board.hydrate()
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const categories = useMemo(() => campusPoiCategoriesPresent(state.pois), [state.pois])
  const rows = useMemo(
    () => buildCampusPoiRows(state.pois, state.slots, now, category),
    [state.pois, state.slots, now, category],
  )
  const nextStops = useMemo(
    () => buildCampusPoiNextStops(state.pois, state.slots, now),
    [state.pois, state.slots, now],
  )
  const scheduledCount = nextStops.filter((stop) => stop.hasSlot).length

  return (
    <View className='kdy-page kdy-campus-poi'>
      <KdyHeading
        title='校园地点'
        subtitle='快递站 · 车库 · 食堂菜单 · 活动场地 · 自习空间'
      />

      {state.status === 'idle' ? (
        <KdyCard>
          <KdyEmpty mode='loading' title='正在读本机地点…' />
        </KdyCard>
      ) : (
        <>
          {state.demo && (
            <View className='kdy-campus-poi__notice'>
              <Text className='kdy-campus-poi__notice-text'>
                演示数据，不是真实采集。坐标按 WGS84 随手取点，不对应真实站点；
                照片未录入，也不会从其他站点抓取。
              </Text>
            </View>
          )}

          <View className='kdy-campus-poi__filters'>
            <KdyChip active={category === 'all'} onClick={() => setCategory('all')}>
              全部
            </KdyChip>
            {categories.map((item: CampusPoiCategory) => (
              <KdyChip
                key={item}
                active={category === item}
                onClick={() => setCategory(item)}
              >
                {CAMPUS_POI_CATEGORY_LABELS[item]}
              </KdyChip>
            ))}
          </View>

          <KdyCard
            title='下一站'
            extra={
              <KdyTag tone='neutral'>
                {scheduledCount > 0 ? `${scheduledCount} 个地点有安排` : '暂无安排'}
              </KdyTag>
            }
          >
            <View className='kdy-campus-poi__next-list'>
              {nextStops.map((stop) => (
                <View key={stop.poiId} className='kdy-campus-poi__next-row'>
                  <View className='kdy-campus-poi__next-main'>
                    <Text className='kdy-campus-poi__next-poi'>{stop.poiName}</Text>
                    <Text className='kdy-campus-poi__next-slot'>{stop.slotTitle}</Text>
                  </View>
                  <View className='kdy-campus-poi__next-when'>
                    <Text className='kdy-campus-poi__next-time'>{stop.whenLabel}</Text>
                    <Text
                      className={
                        stop.hasSlot
                          ? 'kdy-campus-poi__next-relative'
                          : 'kdy-campus-poi__next-relative kdy-campus-poi__next-relative--muted'
                      }
                    >
                      {stop.relativeLabel}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </KdyCard>

          {rows.length === 0 ? (
            <KdyCard>
              <KdyEmpty
                mode='empty'
                title='这里还没有地点'
                description='当前展示的是演示数据，不是真实采集；换一个分类，或等录入通道开放。'
                actionText={category === 'all' ? undefined : '查看全部'}
                onAction={category === 'all' ? undefined : () => setCategory('all')}
              />
            </KdyCard>
          ) : (
            <View className='kdy-campus-poi__list'>
              {rows.map((row) => (
                <KdyCard
                  key={row.id}
                  elevated={false}
                  title={row.name}
                  extra={<KdyTag tone={row.tone}>{row.categoryLabel}</KdyTag>}
                >
                  <View className='kdy-campus-poi__body'>
                    <View className='kdy-campus-poi__media'>
                      {row.photoUrl !== null ? (
                        <Image
                          className='kdy-campus-poi__photo'
                          src={row.photoUrl}
                          mode='aspectFill'
                        />
                      ) : (
                        <View className='kdy-campus-poi__photo-placeholder'>
                          <Text className='kdy-campus-poi__photo-category'>
                            {row.categoryLabel}
                          </Text>
                          <Text className='kdy-campus-poi__photo-hint'>暂无照片</Text>
                        </View>
                      )}
                    </View>

                    <View className='kdy-campus-poi__info'>
                      <View className='kdy-campus-poi__meta'>
                        <Text className='kdy-campus-poi__meta-strong'>{row.floorLabel}</Text>
                        <Text className='kdy-campus-poi__meta-divider'>·</Text>
                        <Text className='kdy-campus-poi__meta-text'>
                          开放时间：{row.openingHoursLabel}
                        </Text>
                      </View>

                      {row.description !== null && row.description !== '' && (
                        <Text className='kdy-campus-poi__description'>{row.description}</Text>
                      )}

                      {row.nextSlot !== null ? (
                        <Text className='kdy-campus-poi__row-next'>
                          {`下一站：${row.nextSlot.whenLabel} · ${row.nextSlot.title}（${row.nextSlot.relativeLabel}）`}
                        </Text>
                      ) : (
                        <Text className='kdy-campus-poi__row-next kdy-campus-poi__row-next--muted'>
                          下一站：暂无安排
                        </Text>
                      )}

                      {row.photoCredit !== null && (
                        <Text className='kdy-campus-poi__credit'>摄影：{row.photoCredit}</Text>
                      )}
                    </View>
                  </View>
                </KdyCard>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  )
}
