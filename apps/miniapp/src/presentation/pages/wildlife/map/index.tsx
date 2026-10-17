import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { wildlifeArchivePath, wildlifeReportPath, wildlifeTracksPath } from '../../../../app/routes'
import {
  FEEDING_POLICY_TONES,
  WILDLIFE_BLACK_SWAN_NOTICE,
  effectiveFeedingPolicy,
  feedingPolicyNotice,
  toApiPoint,
  toCampusMapPoint,
} from '../../../../domain/models/wildlife'
import type { WildlifeSighting, WildlifeZone } from '../../../../domain/models/wildlife'
import { CAMPUS_ORIGIN, distanceMeters, formatRelativeTime } from '@kedaya/shared'
import type { CampusPoint } from '@kedaya/contracts'
import { getCurrentLocation, openWildlifePointInMap } from '../../../../platform/location'
import { navigateTo, toast } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyCampusMap,
  KdyChip,
  KdyEmpty,
  KdyEthicsNotice,
  KdyPrivacyNotice,
  KdyTag,
} from '../../../components'
import { useStore } from '../../../hooks'
import { MAP_MARKER_ICONS, MAP_OVERLAY_COLORS } from '../../../theme/mapColors'
import { aggregationNotice, buildMapOverlays, selectedSightingSummary, zoneSummary } from '../../../../application/wildlife/wildlifeMap'
import './index.scss'

/**
 * 动物地图页（`wildlife`）—— 模块主入口。
 *
 * 底图是**校方校园 GIS 的真实底图**（规格 §1.2 的方案 B：静态校园平面图 + 叠加层），
 * 由 `KdyCampusMap` 渲染；叠加三层：
 * - **活动区域圈**：`circles`（区域圆心 + 半径；敏感区用危险色区分）
 * - **观测点 / 聚合热点标记**：`markers`
 * - **推断轨迹折线**：`polyline`（**虚线** —— 视觉上就不像实测路径）
 *
 * ⚠️ **坐标系（本页最关键的一件事，规格 §3）**：
 * 底图瓦片是百度系投影，而叠加层与点选一律走 **GCJ-02**：本页
 * **不自己拼叠加层**，一律走 `buildMapOverlays()` —— 它内部调用 `toMapPoint()`
 * 完成 WGS84 → GCJ-02；`KdyCampusMap` 再把它投影到底图像素
 * （`@kedaya/contracts` 的 `campusPixel()`）。
 * 本页唯一的另一处转换是「在腾讯地图中打开」（`openWildlifePointInMap`，同样内部转换）。
 *
 * ⚠️ 之前用的原生 `<map>` 是腾讯 / 高德的**城市街道图**：校园里的桥、小路、楼名
 * 全是错的。换成校方底图后，「黑天鹅在哪片水面旁」才有意义；「在腾讯地图中打开」
 * 仍然保留 —— 那是**导航出口**（要的是手机地图的路网），不是底图。
 *
 * ⚠️ **E10**（规格 §8.1）：地图**不显示实时点位**。聚合热点延迟 <24h 的一律不渲染，
 * 单条观测也只作为历史数据展示（`buildMapOverlays` 已过滤，`hiddenByDelay` 会提示）。
 */

export default function WildlifeMapPage() {
  const router = useRouter()
  const container = getContainer()
  const map = container.useCases.wildlifeMap
  const state = useStore(map)

  /**
   * 从档案页的物种卡进来时带 `speciesId`（`wildlifeMapWithSpeciesPath`），
   * 地图直接落在那个物种的筛选上 —— 否则用户点「黑天鹅」却看到全部物种，
   * 还得自己再点一次筛选。
   *
   * ⚠️ 只认**物种 id**：坐标永远由本页自己采集，绝不由 URL 带进来。
   */
  const paramSpeciesId =
    typeof router.params.speciesId === 'string' && router.params.speciesId !== ''
      ? router.params.speciesId
      : null

  const now = container.clock.now()
  const overlays = buildMapOverlays(state, now, MAP_OVERLAY_COLORS)

  /**
   * 底图要居中的点（**GCJ-02** —— 底图投影与叠加层都是这个口径）。
   *
   * 只在用户**明确要看某个东西**时改（点区域卡、点标记），不跟着地图点选走：
   * 否则手指刚点下去地图就自己跳走，很难受。
   */
  const [focus, setFocus] = useState<CampusPoint>(() =>
    // 校园原点（WGS84）→ GCJ-02：这是「渲染前必须转换」的又一个消费点
    toCampusMapPoint({ lat: CAMPUS_ORIGIN.lat, lng: CAMPUS_ORIGIN.lng }),
  )

  /** 用户当前位置（GCJ-02）—— 原生 `<map showLocation>` 的蓝点在这里补齐 */
  const [position, setPosition] = useState<CampusPoint | null>(null)

  const sightingSummary = selectedSightingSummary(state, now)
  const activeZone =
    state.selectedZoneId === null
      ? undefined
      : state.zones.find((zone) => zone.id === state.selectedZoneId)

  function refresh(): Promise<void> {
    return map.load().then(() => undefined)
  }

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等，同步读缓存）+ 第 3 步（后台刷新）
    map.hydrate()
    if (paramSpeciesId === null) {
      void map.load()
    } else {
      // 带物种进来：先落到该物种的筛选，再按该物种拉数据
      map.selectSpecies(paramSpeciesId)
      void map.load(paramSpeciesId)
    }
    // 底图上的「我在这」蓝点（被拒绝授权就静默不显示，功能不受影响）
    void locateOnce()
  })

  /**
   * 取一次当前位置用于底图蓝点。
   *
   * 与原生 `<map showLocation>` 等价：授权被拒 / 定位不可用时**什么都不做**，
   * 不弹提示也不报错 —— 地图本身仍然可用。
   */
  async function locateOnce(): Promise<void> {
    const located = await getCurrentLocation()
    if (!located.ok) return
    // `wx.getLocation({ type: 'wgs84' })` 是 WGS84 → 渲染前必须转 GCJ-02
    setPosition(toCampusMapPoint({ lat: located.value.lat, lng: located.value.lng }))
  }

  usePullDownRefresh(() => {
    void refresh().then(() => Taro.stopPullDownRefresh())
  })

  function handleSpeciesFilter(speciesId: string | null): void {
    map.selectSpecies(speciesId)
    void map.load(speciesId)
  }

  function handleMarkerTap(markerId: number): void {
    const marker = overlays.markers.find((item) => item.markerId === markerId)
    if (marker === undefined) return

    // 点标记 = 用户明确想看它：底图居中过去（叠加层本来就是 GCJ-02）
    setFocus({ latitude: marker.latitude, longitude: marker.longitude })

    if (marker.kind === 'sighting') {
      map.selectSighting(marker.id)
      map.selectZone(null)
      return
    }

    // 热点 → 打开它所属区域的详情（区域才有投喂规范与告示）
    const spot = state.spots.find((item) => item.id === marker.id)
    map.selectSighting(null)
    map.selectZone(spot?.zoneId ?? null)
    if (spot?.zoneId == null) toast('该热点尚未划入管理区域')
  }

  function handleMapTap(point: CampusPoint): void {
    // ⚠️ 用户在校方底图上点选得到的是 **GCJ-02**（与原生 `<map>` 的 onTap 同一口径）。
    // 本页只把它当作「查看附近区域」的输入，因此先用 domain 的入口转成 WGS84 再比较 ——
    // 绝不把 GCJ-02 直接和 WGS84 的区域圆心做距离比较（那会差约 470 米）。
    const wgs84 = toApiPoint({ lat: point.latitude, lng: point.longitude }, 'gcj02')

    const hit = state.zones.find(
      (zone) => distanceMeters({ lat: zone.centerLat, lng: zone.centerLng }, wgs84) <= zone.radiusM,
    )

    map.selectSighting(null)
    if (hit === undefined) {
      map.selectZone(null)
      toast('这一点不在任何已划定的活动区域内')
      return
    }
    map.selectZone(hit.id)
  }

  function handleSimulateError(): void {
    const mock = container.mockWildlifeControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void map.load()
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockWildlifeControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void map.load()
  }

  function handleResetDemo(): void {
    container.mockWildlifeControls?.reset()
    void refresh()
  }

  async function handleOpenInMap(zone: WildlifeZone): Promise<void> {
    // 消费点 B：`wx.openLocation` 要求 GCJ-02，因此入参是 WGS84、内部转换
    const result = await openWildlifePointInMap(
      { lat: zone.centerLat, lng: zone.centerLng },
      zone.name,
      '上海科技大学（示意位置）',
    )
    if (!result.ok) toast(result.error.message)
  }

  return (
    <View className='kdy-page kdy-wildlife-map'>
      {/* 物种筛选 */}
      <View className='kdy-wildlife-map__filters'>
        <View className='kdy-wildlife-map__filter'>
          <KdyChip active={state.activeSpeciesId === null} onClick={() => handleSpeciesFilter(null)}>
            全部
          </KdyChip>
        </View>
        {state.species.map((species) => (
          <View
            key={species.id}
            className='kdy-wildlife-map__filter'
          >
            <KdyChip
              active={state.activeSpeciesId === species.id}
              onClick={() => handleSpeciesFilter(species.id)}
            >
              {species.commonNameZh}
            </KdyChip>
          </View>
        ))}
      </View>

      <View className='kdy-wildlife-map__actions'>
        <KdyButton size='sm' onClick={() => void navigateTo(wildlifeReportPath())}>
          上报观测
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(wildlifeArchivePath())}>
          居民档案
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(wildlifeTracksPath())}>
          推断轨迹
        </KdyButton>
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
        <KdyEmpty mode='loading' description='首次进入，正在拉取区域与热点' />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => {
            void map.load()
          }}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='还没有任何区域或观测数据。可以先上报一次观测，或点「重置演示数据」。'
          actionText='去上报'
          onAction={() => void navigateTo(wildlifeReportPath())}
        />
      )}

      {(state.status === 'ready' || state.status === 'idle') && (
        <View>
          {/*
            ⚠️ 底图 = **校方校园 GIS 的真实底图**（不是腾讯 / 高德的城市街道图）。
            所有叠加层的坐标**已经**是 GCJ-02（由 buildMapOverlays 转换）。
          */}
          <KdyCampusMap
            className='kdy-wildlife-map__canvas'
            markers={overlays.markers.map((marker) => ({
              markerId: marker.markerId ?? 0,
              latitude: marker.latitude,
              longitude: marker.longitude,
              title: marker.title,
              iconPath:
                marker.kind === 'spot' ? MAP_MARKER_ICONS.spot : MAP_MARKER_ICONS.sighting,
              calloutText: marker.calloutText,
            }))}
            circles={overlays.circles}
            polyline={
              overlays.polyline === null
                ? null
                : {
                    points: overlays.polyline.points,
                    color: overlays.polyline.color,
                    dotted: overlays.polyline.dottedLine,
                  }
            }
            position={position}
            focus={focus}
            onMarkerTap={handleMarkerTap}
            onPick={handleMapTap}
          />

          <Text className='kdy-wildlife-map__legend'>
            图例：黄色圆点 = 聚合热点；蓝色圆点 = 历史观测；蓝圈 = 管理区域（红圈 = 敏感区，
            不公开坐标）；蓝色小字 = 校园建筑与桥。点底图空白处可查看该点落在哪个活动区域内。
          </Text>

          {overlays.hiddenByDelay > 0 && (
            <Text className='kdy-wildlife-map__hint'>
              有 {overlays.hiddenByDelay} 个热点尚未达到 24 小时展示延迟，已隐藏（{aggregationNotice()}）
            </Text>
          )}

          {/* 隐私说明：地图页必须展示（规格 §9 + §8.1 E10） */}
          <View className='kdy-wildlife-map__privacy'>
            <KdyPrivacyNotice showAggregation compact />
          </View>

          {/* 区域列表 */}
          <Text className='kdy-section-title'>活动区域</Text>
          {state.zones.length === 0 && (
            <Text className='kdy-wildlife-map__hint'>当前筛选下没有区域。</Text>
          )}
          {state.zones.map((zone) => {
            const summary = zoneSummary(zone, state.species)
            const policy = effectiveFeedingPolicy(zone.feedingPolicy, undefined)
            return (
              <KdyCard
                key={zone.id}
                elevated={false}
                title={zone.name}
                extra={<KdyTag tone={FEEDING_POLICY_TONES[policy]}>{summary.feedingPolicy}</KdyTag>}
                onClick={() => {
                  map.selectZone(zone.id)
                  // 明确想看这个区域：把底图居中过去（区域圆心是 WGS84，渲染前转 GCJ-02）
                  setFocus(toCampusMapPoint({ lat: zone.centerLat, lng: zone.centerLng }))
                }}
              >
                <View className='kdy-wildlife-map__zone'>
                  <Text className='kdy-wildlife-map__zone-meta'>
                    半径 {zone.radiusM} 米 · 模糊半径 {zone.fuzzRadiusM} 米
                    {zone.isSensitive ? ' · 敏感区（不公开坐标）' : ''}
                  </Text>
                  <Text className='kdy-wildlife-map__zone-species'>
                    主要物种：{summary.speciesNames.join('、')}
                  </Text>
                  <Text className='kdy-wildlife-map__zone-policy'>
                    {feedingPolicyNotice(policy, summary.speciesNames[0])}
                  </Text>
                </View>
              </KdyCard>
            )
          })}

          {/* 选中区域详情（投喂规范告示位，规格 §8.3） */}
          {activeZone !== undefined && (
            <KdyCard title={`区域详情 · ${activeZone.name}`} className='kdy-wildlife-map__detail'>
              <KdyEthicsNotice
                policy={effectiveFeedingPolicy(activeZone.feedingPolicy, undefined)}
                speciesName={zoneSummary(activeZone, state.species).speciesNames[0]}
                zoneName={activeZone.name}
                noticeText={
                  activeZone.noticeText ??
                  (activeZone.id === 'wz-lake' ? WILDLIFE_BLACK_SWAN_NOTICE : undefined)
                }
              />
              <View className='kdy-wildlife-map__detail-actions'>
                <KdyButton size='sm' variant='secondary' onClick={() => void handleOpenInMap(activeZone)}>
                  在腾讯地图中打开
                </KdyButton>
                <KdyButton size='sm' variant='ghost' onClick={() => map.selectZone(null)}>
                  收起
                </KdyButton>
              </View>
            </KdyCard>
          )}

          {/* 选中观测详情（物种 / 发现时间 / 照片 / 区域 / 投喂规范） */}
          {sightingSummary !== null && (
            <SightingDetail
              summary={sightingSummary}
              sighting={state.sightings.find((item) => item.id === sightingSummary.id)}
              speciesName={sightingSummary.speciesName}
              onClose={() => map.selectSighting(null)}
            />
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-wildlife-map__soft-error'>
          刷新失败：{state.error}
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
        投喂规范与告示文案为项目草案，未经校方或动物社团审核。
      </Text>
    </View>
  )
}

/** 观测详情面板 —— 点标记后展示 */
function SightingDetail({
  summary,
  sighting,
  speciesName,
  onClose,
}: {
  summary: ReturnType<typeof selectedSightingSummary>
  sighting: WildlifeSighting | undefined
  speciesName: string
  onClose: () => void
}) {
  if (summary === null) return null

  return (
    <KdyCard title={`观测详情 · ${summary.speciesName}`} className='kdy-wildlife-map__detail'>
      <View className='kdy-wildlife-map__detail-row'>
        <Text className='kdy-wildlife-map__detail-label'>发现时间</Text>
        <Text className='kdy-wildlife-map__detail-value'>{summary.observedAtLabel}</Text>
      </View>
      <View className='kdy-wildlife-map__detail-row'>
        <Text className='kdy-wildlife-map__detail-label'>物种来源</Text>
        <Text className='kdy-wildlife-map__detail-value'>{summary.speciesSourceLabel}</Text>
      </View>
      <View className='kdy-wildlife-map__detail-row'>
        <Text className='kdy-wildlife-map__detail-label'>所属区域</Text>
        <Text className='kdy-wildlife-map__detail-value'>{summary.zoneName}</Text>
      </View>
      <View className='kdy-wildlife-map__detail-row'>
        <Text className='kdy-wildlife-map__detail-label'>照片</Text>
        <Text className='kdy-wildlife-map__detail-value'>
          {summary.photoCount === 0 ? '无' : `${summary.photoCount} 张`}
        </Text>
      </View>
      <View className='kdy-wildlife-map__detail-row'>
        <Text className='kdy-wildlife-map__detail-label'>上报人</Text>
        <Text className='kdy-wildlife-map__detail-value'>{summary.reporterName}</Text>
      </View>

      {summary.healthConcern && (
        <Text className='kdy-wildlife-map__health'>
          ⚠️ 该上报标记了「疑似受伤 / 异常」，已通知校园动物社团。请勿自行处置。
        </Text>
      )}

      {summary.note !== '' && <Text className='kdy-wildlife-map__note'>{summary.note}</Text>}

      <KdyPrivacyNotice
        fuzzLevel={summary.fuzzLevel}
        isSensitive={!summary.hasCoordinates}
        compact
      />

      <KdyEthicsNotice
        policy={summary.feedingPolicy}
        speciesName={speciesName}
        zoneName={summary.zoneName}
        noticeText={summary.zoneNotice}
        defaultExpanded={false}
      />

      {sighting !== undefined && sighting.fuzzedGeo !== undefined && (
        <Text className='kdy-wildlife-map__detail-meta'>
          公开坐标（模糊后）将在「在腾讯地图中打开」时转换为 GCJ-02。
          {formatRelativeTime(sighting.observedAt, new Date())}
        </Text>
      )}

      <View className='kdy-wildlife-map__detail-actions'>
        <KdyButton size='sm' variant='ghost' onClick={onClose}>
          收起
        </KdyButton>
      </View>
    </KdyCard>
  )
}
