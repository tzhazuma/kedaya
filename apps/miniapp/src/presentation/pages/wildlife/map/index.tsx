import { Map, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { wildlifeReportPath, wildlifeTracksPath } from '../../../../app/routes'
import {
  FEEDING_POLICY_TONES,
  WILDLIFE_BLACK_SWAN_NOTICE,
  effectiveFeedingPolicy,
  feedingPolicyNotice,
  toApiPoint,
  toMapPoint,
} from '../../../../domain/models/wildlife'
import type { WildlifeSighting, WildlifeZone } from '../../../../domain/models/wildlife'
import { CAMPUS_ORIGIN, distanceMeters, formatRelativeTime } from '@kedaya/shared'
import { openWildlifePointInMap } from '../../../../platform/location'
import { navigateTo, toast } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyEthicsNotice,
  KdyPrivacyNotice,
  KdyTag,
} from '../../../components'
import { useStore } from '../../../hooks'
import { MAP_MARKER_ICONS, MAP_OVERLAY_COLORS, buildCallout } from '../../../theme/mapColors'
import { aggregationNotice, buildMapOverlays, selectedSightingSummary, zoneSummary } from '../../../../application/wildlife/wildlifeMap'
import './index.scss'

/**
 * 动物地图页（`wildlife`）—— 模块主入口。
 *
 * 底图用小程序原生 `<map>` 组件（规格 §1.1 的方案 A），叠加：
 * - **活动区域圈**：`circles`（区域圆心 + 半径；敏感区用危险色区分）
 * - **观测点 / 聚合热点标记**：`markers`
 * - **推断轨迹折线**：`polyline`（**虚线** —— 视觉上就不像实测路径）
 *
 * ⚠️ **坐标系（本页最关键的一件事，规格 §3）**：
 * `<map>` 组件的 `markers` / `circles` / `polyline` **全部按 GCJ-02 解释**，
 * 而我们的 API / 存储一律 WGS84（在上海相差约 470 米）。
 * 因此本页**不自己拼叠加层**，一律走 `buildMapOverlays()` ——
 * 它内部调用 `toMapPoint()` 完成 WGS84 → GCJ-02。
 * 本页唯一的另一处转换是「在腾讯地图中打开」（`openWildlifePointInMap`，同样内部转换）。
 *
 * ⚠️ 规格 §1.2 推荐的是「静态校园平面图 + 叠加层」（方案 B，无坐标系问题），
 * 本实现采用方案 A（原生 `map`），原因是本任务的显式要求（`<map>` + `markers` + `polyline`）。
 * 两者对用户的核心差别是底图内容；坐标转换的规范两者一致。详见交付说明的偏离记录。
 *
 * ⚠️ **E10**（规格 §8.1）：地图**不显示实时点位**。聚合热点延迟 <24h 的一律不渲染，
 * 单条观测也只作为历史数据展示（`buildMapOverlays` 已过滤，`hiddenByDelay` 会提示）。
 */

const MAP_SCALE = 16

export default function WildlifeMapPage() {
  const container = getContainer()
  const map = container.useCases.wildlifeMap
  const state = useStore(map)

  const now = container.clock.now()
  const overlays = buildMapOverlays(state, now, MAP_OVERLAY_COLORS)

  // 地图初始中心：校园原点（WGS84）→ GCJ-02。
  // 这是「渲染前必须转换」的又一个消费点。
  const center = toMapPoint({ lat: CAMPUS_ORIGIN.lat, lng: CAMPUS_ORIGIN.lng })

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
    void map.load()
  })

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

  function handleMapTap(latitude: number, longitude: number): void {
    // ⚠️ 用户在地图上点选得到的是 **GCJ-02**。
    // 本页只把它当作「查看附近区域」的输入，因此先用 domain 的入口转成 WGS84 再比较 ——
    // 绝不把 GCJ-02 直接和 WGS84 的区域圆心做距离比较（那会差约 470 米）。
    const wgs84 = toApiPoint({ lat: latitude, lng: longitude }, 'gcj02')

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
          {state.fromCache && (
            <Text className='kdy-wildlife-map__hint'>当前展示本地缓存，正在后台刷新…</Text>
          )}

          {/*
            ⚠️ 底图 = 小程序原生 map（腾讯地图街道图）。
            所有叠加层的坐标**已经**是 GCJ-02（由 buildMapOverlays 转换）。
          */}
          <Map
            className='kdy-wildlife-map__canvas'
            longitude={center.lng}
            latitude={center.lat}
            scale={MAP_SCALE}
            showLocation
            markers={overlays.markers.map((marker) => ({
              id: marker.markerId ?? 0,
              latitude: marker.latitude,
              longitude: marker.longitude,
              title: marker.title,
              iconPath:
                marker.kind === 'spot' ? MAP_MARKER_ICONS.spot : MAP_MARKER_ICONS.sighting,
              width: 24,
              height: 24,
              callout: buildCallout(marker.calloutText),
            }))}
            circles={overlays.circles}
            polyline={overlays.polyline === null ? [] : [overlays.polyline]}
            onMarkerTap={(event) => handleMarkerTap(Number(event.detail.markerId))}
            onError={() => toast('地图组件加载失败：请检查网络，或在小程序后台配置地图 key')}
            onTap={(event) => {
              const detail = event.detail as { latitude?: number; longitude?: number }
              if (detail.latitude !== undefined && detail.longitude !== undefined) {
                handleMapTap(detail.latitude, detail.longitude)
              }
            }}
          />

          <Text className='kdy-wildlife-map__legend'>
            图例：黄色圆点 = 聚合热点；蓝色圆点 = 历史观测；圆圈 = 管理区域（红色 = 敏感区，不公开坐标）。
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
                onClick={() => map.selectZone(zone.id)}
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
          后台刷新失败：{state.error}（已继续展示缓存数据，契约 §8 静默降级）
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
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
