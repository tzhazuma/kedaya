import { Map, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { wildlifeReportPath } from '../../../../app/routes'
import {
  WILDLIFE_TRACK_INFERRED_LABEL,
  speciesDisplayName,
  trackToMapPoints,
} from '../../../../domain/models/wildlife'
import { CAMPUS_ORIGIN } from '@kedaya/shared'
import { navigateTo, toast } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyPrivacyNotice,
  KdyProgress,
  KdyTag,
} from '../../../components'
import { useStore } from '../../../hooks'
import { MAP_MARKER_ICONS, MAP_OVERLAY_COLORS, buildCallout } from '../../../theme/mapColors'
import { toMapPoint } from '../../../../domain/models/wildlife'
import { trackDetailView } from '../../../../application/wildlife/tracks'
import './index.scss'

/**
 * 推断轨迹页（规格 §6）。
 *
 * ⚠️ **本页最重要的不是画线，而是说清楚「这条线不是动物走过的路」。**
 *
 * 我们的数据来自同学偶发上报，不是 GPS 项圈，因此**无法**重建真实运动路径。
 * 规格 §6.1 / §11.3 T18 要求：
 * - 所有轨迹必须**显著**标注「推断」；
 * - `disclaimer` 必须**原样展示服务端下发的文案**（§10.5：把合规文案变成接口契约的一部分）。
 *
 * 因此本页：
 * 1. 每条轨迹卡片顶部都有 `推断轨迹` 标签 + 免责说明；
 * 2. 折线用**虚线**渲染 —— 视觉上就不像实测路径；
 * 3. 展示 `method`（`dbscan-chain`，**明确不做插值**）与 `algorithmVersion`，让来源可追溯；
 * 4. **不做**路径插值 / 样条平滑 / 速度推断 / 地图匹配。
 *
 * ⚠️ 坐标系：轨迹点来自 API，是 **WGS84**；`<map>` 的 `polyline` 只认 **GCJ-02**。
 * 因此 `trackToMapPoints()` 逐点转换 —— 这是「渲染前必须转换」的消费点。
 */

export default function WildlifeTracksPage() {
  const container = getContainer()
  const tracks = container.useCases.wildlifeTracks
  const state = useStore(tracks)

  const now = container.clock.now()
  const center = toMapPoint({ lat: CAMPUS_ORIGIN.lat, lng: CAMPUS_ORIGIN.lng })

  const detail =
    state.selectedTrack === null
      ? null
      : trackDetailView(
          state.selectedTrack,
          state.species,
          state.individuals,
          (iso) => new Date(iso).toLocaleString('zh-CN'),
        )

  useDidShow(() => {
    // 契约 §8 第 1 步（同步 hydrate）+ 第 3 步（后台刷新）
    tracks.hydrate()
    void tracks.load()
  })

  usePullDownRefresh(() => {
    void tracks.load().then(() => Taro.stopPullDownRefresh())
  })

  function handleSpeciesFilter(speciesId: string | null): void {
    tracks.selectSpecies(speciesId)
    void tracks.load(speciesId)
  }

  function handleSimulateError(): void {
    const mock = container.mockWildlifeControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void tracks.load()
  }

  function handleSimulateEmpty(): void {
    const mock = container.mockWildlifeControls
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void tracks.load()
  }

  function handleResetDemo(): void {
    container.mockWildlifeControls?.reset()
    void tracks.load()
  }

  const polylinePoints = state.selectedTrack === null ? [] : trackToMapPoints(state.selectedTrack)

  return (
    <View className='kdy-page kdy-wildlife-tracks'>
      <View className='kdy-wildlife-tracks__filters'>
        <View className='kdy-wildlife-tracks__filter'>
          <KdyChip active={state.activeSpeciesId === null} onClick={() => handleSpeciesFilter(null)}>
            全部
          </KdyChip>
        </View>
        {state.species.map((species) => (
          <View
            key={species.id}
            className='kdy-wildlife-tracks__filter'
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

      <View className='kdy-wildlife-tracks__actions'>
        <KdyButton size='sm' onClick={() => void navigateTo(wildlifeReportPath())}>
          上报观测
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

      {/* 全局免责横幅：**永远**在页面顶部，不依赖是否选中某条轨迹 */}
      <View className='kdy-wildlife-tracks__banner'>
        <Text className='kdy-wildlife-tracks__banner-title'>
          ⚠️ 以下全部是{WILDLIFE_TRACK_INFERRED_LABEL}，不是实测路径
        </Text>
        <Text className='kdy-wildlife-tracks__banner-body'>
          我们的数据来自同学偶发上报，不是 GPS 项圈，因此无法重建动物的真实运动路径。
          这些折线只是「由 N 次上报推断出的活动走廊」。轨迹断裂处表示期间没有上报，
          **不代表**动物没有移动。
        </Text>
      </View>

      {state.status === 'loading' && (
        <KdyEmpty mode='loading' description='正在拉取推断轨迹' />
      )}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => {
            void tracks.load()
          }}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          description='当前筛选下还没有可生成的推断轨迹。轨迹需要同一物种在 7 天窗口内至少 5 个上报点才会生成。'
          actionText='去上报'
          onAction={() => void navigateTo(wildlifeReportPath())}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {polylinePoints.length > 0 && (
            <Map
              className='kdy-wildlife-tracks__canvas'
              longitude={center.lng}
              latitude={center.lat}
              scale={16}
              markers={[
                {
                  id: 0,
                  latitude: polylinePoints[0]?.latitude ?? center.lat,
                  longitude: polylinePoints[0]?.longitude ?? center.lng,
                  title: '轨迹起点',
                  iconPath: MAP_MARKER_ICONS.track,
                  width: 24,
                  height: 24,
                  callout: buildCallout(`${WILDLIFE_TRACK_INFERRED_LABEL}（虚线）`),
                },
              ]}
              polyline={[
                {
                  points: polylinePoints,
                  color: MAP_OVERLAY_COLORS.track,
                  width: 4,
                  // 虚线是刻意的：视觉上就不像实测路径
                  dottedLine: true,
                  arrowLine: true,
                },
              ]}
              onError={() => toast('地图组件加载失败：请检查网络，或在小程序后台配置地图 key')}
            />
          )}

          {state.tracks.map((track) => (
            <KdyCard
              key={track.id}
              elevated={false}
              title={`${speciesDisplayName(state.species.find((s) => s.id === track.speciesId))}${
                track.individualId === null
                  ? ''
                  : ` · ${
                      state.individuals.find((i) => i.id === track.individualId)?.name ?? '已命名个体'
                    }`
              }`}
              extra={<KdyTag tone='warning'>{WILDLIFE_TRACK_INFERRED_LABEL}</KdyTag>}
              onClick={() => void tracks.selectTrack(track.id)}
            >
              <View className='kdy-wildlife-tracks__card'>
                <Text className='kdy-wildlife-tracks__card-meta'>
                  {track.pointCount} 个途经点 · {track.sightingCount} 次上报 · 折线长度{' '}
                  {track.totalDistanceM} 米
                </Text>
                {/* 可信度百分比：给条也给数字。这是**推断**的可信度，
                    不是"这条路径有多真"—— 百分比在这类数据上很容易被读成后者。 */}
                <View className='kdy-wildlife-tracks__confidence'>
                  <Text className='kdy-wildlife-tracks__confidence-key'>可信度</Text>
                  <KdyProgress
                    className='kdy-wildlife-tracks__confidence-bar'
                    percent={Math.round(track.confidence * 100)}
                    tone='warning'
                  />
                  <Text className='kdy-wildlife-tracks__confidence-value'>
                    {Math.round(track.confidence * 100)}%
                  </Text>
                </View>
                <Text className='kdy-wildlife-tracks__card-meta'>算法 {track.algorithmVersion}</Text>
                <Text className='kdy-wildlife-tracks__card-disclaimer'>
                  {track.disclaimer ?? '（服务端未下发免责说明，请以「推断轨迹」为准）'}
                </Text>
              </View>
            </KdyCard>
          ))}

          {detail !== null && (
            <KdyCard
              title={`轨迹详情 · ${detail.speciesName}`}
              extra={<KdyTag tone='warning'>{detail.inferredLabel}</KdyTag>}
              className='kdy-wildlife-tracks__detail'
            >
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>个体</Text>
                <Text className='kdy-wildlife-tracks__value'>{detail.individualName ?? '未命名'}</Text>
              </View>
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>时间跨度</Text>
                <Text className='kdy-wildlife-tracks__value'>
                  {detail.spanStartLabel} → {detail.spanEndLabel}
                </Text>
              </View>
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>途经点 / 上报数</Text>
                <Text className='kdy-wildlife-tracks__value'>
                  {detail.pointCount} / {detail.sightingCount}
                </Text>
              </View>
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>折线长度</Text>
                <Text className='kdy-wildlife-tracks__value'>{detail.totalDistanceM} 米</Text>
              </View>
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>生成方法</Text>
                <Text className='kdy-wildlife-tracks__value'>{detail.methodLabel}</Text>
              </View>
              <View className='kdy-wildlife-tracks__row'>
                <Text className='kdy-wildlife-tracks__label'>可信度</Text>
                <Text className='kdy-wildlife-tracks__value'>{detail.confidenceLabel}</Text>
              </View>

              <View className='kdy-wildlife-tracks__disclaimer'>
                <Text className='kdy-wildlife-tracks__disclaimer-title'>
                  {detail.disclaimerFromServer ? '服务端下发的免责说明' : '本地兜底免责说明'}
                </Text>
                <Text className='kdy-wildlife-tracks__disclaimer-body'>{detail.disclaimer}</Text>
              </View>

              <KdyPrivacyNotice fuzzLevel='grid' compact />

              <View className='kdy-wildlife-tracks__detail-actions'>
                <KdyButton size='sm' variant='ghost' onClick={() => void tracks.selectTrack(null)}>
                  取消叠加
                </KdyButton>
              </View>
            </KdyCard>
          )}

          <Text className='kdy-wildlife-tracks__hint'>
            当前时间：{now.toLocaleString('zh-CN')}（轨迹由 Worker 每日重算，失败时保留上一次结果）
          </Text>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
        轨迹为推断结果，不可用于任何科研或管理决策依据。
      </Text>
    </View>
  )
}
