import { Image, Map, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useMemo, useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  WILDLIFE_CLASSIFY_DISCLAIMER,
  WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH,
  WILDLIFE_MAX_PHOTOS,
  WILDLIFE_NOTE_MAX_LENGTH,
  effectiveFeedingPolicy,
  feedingPolicyNotice,
  speciesDisplayName,
  toMapPoint,
} from '../../../../domain/models/wildlife'
import { getCurrentLocation } from '../../../../platform/location'
import { chooseAndCompressPhotos } from '../../../../platform/mediaPicker'
import { navigateBack, toast } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyEthicsNotice,
  KdyField,
  KdyPicker,
  KdyPrivacyNotice,
  KdySwitch,
  KdyTag,
} from '../../../components'
import { useStore } from '../../../hooks'
import { MAP_MARKER_ICONS, buildCallout } from '../../../theme/mapColors'
import './index.scss'

/**
 * 上报观测页（**核心流程**，规格 §4 / §5 / §8 / §9）。
 *
 * 坐标系（规格 §3）——**本页同时踩到两个消费点**，必须分清楚：
 * - 「使用当前定位」→ `wx.getLocation({ type: 'wgs84' })` → 已是 **WGS84**，
 *   以 `setPoint(p, 'wgs84')` 交出去（不转换）；
 * - 「在地图上点选」→ `<map>` 的 `onTap` 给的是 **GCJ-02**，
 *   以 `setPoint(p, 'gcj02')` 交出去，由 `toCreateSightingBody()` 转回 WGS84。
 *
 * 页面**不做**转换本身，只声明「这个点从哪来」——转换入口只有 domain 的那两个函数。
 *
 * ⚠️ 伦理提示（规格 §8.2）：这是**表单校验**（勾选才能提交），**不是同意门**。
 * 它不产生 `ConsentRecord`、不阻塞浏览，因此这里**不会**出现 `CONSENT_REQUIRED`。
 */

/** 把本地日期 + 时间拼成 ISO（按设备本地时区解释） */
function toIsoFromLocal(date: string, time: string): string {
  const parsed = new Date(`${date}T${time}:00`)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function todayLocal(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function timeLocal(now: Date): string {
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

export default function WildlifeReportPage() {
  const container = getContainer()
  const report = container.useCases.reportSighting
  const state = useStore(report)
  // 区域列表复用地图用例的缓存（同一份数据，不重复请求）
  const mapUseCase = container.useCases.wildlifeMap
  const mapState = useStore(mapUseCase)

  const now = container.clock.now()
  const [date, setDate] = useState(() => todayLocal(now))
  const [time, setTime] = useState(() => timeLocal(now))
  const [pickerOpen, setPickerOpen] = useState(false)

  // 地图点选：`<map>` 的 onTap 给的是 GCJ-02
  const center = toMapPoint({ lat: state.draft.point.lat, lng: state.draft.point.lng })
  const selectedSpecies = useMemo(
    () => state.species.find((item) => item.id === state.draft.speciesId),
    [state.species, state.draft.speciesId],
  )

  const selectedZone =
    state.draft.zoneId === null
      ? undefined
      : mapState.zones.find((z) => z.id === state.draft.zoneId)

  const effectivePolicy = effectiveFeedingPolicy(
    selectedZone?.feedingPolicy,
    selectedSpecies?.defaultFeedingPolicy,
  )

  useDidShow(() => {
    // 契约 §8：同步 hydrate → 立即渲染 → 后台拉物种列表
    report.hydrate()
    void report.loadSpecies()
    // 区域列表复用地图用例（同一份缓存），没有才拉
    mapUseCase.hydrate()
    if (mapUseCase.getSnapshot().zones.length === 0) void mapUseCase.load()
  })

  async function handlePickPhotos(): Promise<void> {
    const picked = await chooseAndCompressPhotos({ count: WILDLIFE_MAX_PHOTOS - state.photos.length })
    if (!picked.ok) {
      if (picked.error.code !== 'REJECTED') toast(picked.error.message)
      return
    }
    await report.addPhotos(picked.value)
  }

  async function handleLocate(): Promise<void> {
    const located = await getCurrentLocation()
    if (!located.ok) {
      toast(located.error.message)
      return
    }
    // `wx.getLocation({ type: 'wgs84' })` → 已经是 WGS84，声明来源即可
    report.setPoint({ lat: located.value.lat, lng: located.value.lng }, 'wgs84')
    report.setAccuracy(located.value.accuracyM)
    toast('已使用当前定位（WGS84）')
  }

  function handleMapTap(latitude: number, longitude: number): void {
    // ⚠️ 地图点选 → **GCJ-02**。声明来源，由用例/domain 在提交前转回 WGS84。
    report.setPoint({ lat: latitude, lng: longitude }, 'gcj02')
    toast('已选点（地图点选为 GCJ-02，提交前会自动转回 WGS84）')
  }

  async function handleSubmit(): Promise<void> {
    const next = await report.submit()
    if (next.status === 'submitted') {
      toast('已提交，等待审核', 'success')
      await navigateBack()
      return
    }
    if (next.error !== null) toast(next.error)
  }

  return (
    <View className='kdy-page kdy-wildlife-report'>
      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在拉取物种列表' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => void report.loadSpecies()}
        />
      )}

      {state.species.length === 0 && state.status !== 'loading' && (
        <KdyEmpty
          mode='empty'
          description='没有可选的物种。请稍后重试，或联系管理员检查物种表。'
          actionText='重新拉取'
          onAction={() => void report.loadSpecies()}
        />
      )}

      {state.species.length > 0 && (
        <View>
          {/* ① 照片（规格 §4） */}
          <KdyCard title='照片（最多 3 张，选填）' elevated={false}>
            <View className='kdy-wildlife-report__photos'>
              {state.photos.map((photo) => (
                <View key={photo.clientPhotoId} className='kdy-wildlife-report__photo'>
                  <Image
                    className='kdy-wildlife-report__thumb'
                    src={photo.thumbUrl ?? photo.tempFilePath}
                    mode='aspectFill'
                  />
                  <Text className='kdy-wildlife-report__photo-state'>
                    {photo.status === 'uploading'
                      ? '上传中…'
                      : photo.status === 'uploaded'
                        ? '已上传'
                        : '上传失败'}
                  </Text>
                  {photo.status === 'failed' && (
                    <KdyButton
                      size='sm'
                      variant='ghost'
                      onClick={() => void report.retryPhoto(photo.clientPhotoId)}
                    >
                      重试
                    </KdyButton>
                  )}
                  <KdyButton
                    size='sm'
                    variant='ghost'
                    onClick={() => report.removePhoto(photo.clientPhotoId)}
                  >
                    移除
                  </KdyButton>
                </View>
              ))}
            </View>

            {state.photos.length < WILDLIFE_MAX_PHOTOS && (
              <KdyButton size='sm' variant='secondary' onClick={() => void handlePickPhotos()}>
                添加照片
              </KdyButton>
            )}

            <Text className='kdy-wildlife-report__tip'>
              照片的 EXIF（含 GPS）由服务端强制剥离后再存储 —— 客户端不做、也不能承诺这件事。
            </Text>
          </KdyCard>

          {/* ② 物种：自动分类建议 + 手动选择（规格 §5） */}
          <KdyCard title='物种（必填）' elevated={false}>
            {state.classification.degraded ? (
              <Text className='kdy-wildlife-report__degrade'>
                自动识别暂不可用，请手动选择物种。
                这不影响上报 —— 分类是增强，不是前置条件。
              </Text>
            ) : (
              <View className='kdy-wildlife-report__suggestions'>
                {state.classification.suggestions.map((suggestion) => (
                  <View
                    key={suggestion.speciesId}
                    className='kdy-wildlife-report__suggestion'
                    onClick={() => report.setSpecies(suggestion.speciesId)}
                  >
                    <KdyTag tone={suggestion.preselected ? 'info' : 'neutral'}>
                      {suggestion.speciesName} · {suggestion.confidenceLabel}（
                      {Math.round(suggestion.confidence * 100)}%）
                    </KdyTag>
                  </View>
                ))}
                <Text className='kdy-wildlife-report__tip'>{WILDLIFE_CLASSIFY_DISCLAIMER}</Text>
              </View>
            )}

            {state.classificationLoading && (
              <Text className='kdy-wildlife-report__tip'>正在请求识别建议…</Text>
            )}

            <View className='kdy-wildlife-report__species'>
              {state.species.map((species) => (
                <View
                  key={species.id}
                  className='kdy-wildlife-report__species-item'
                >
                  <KdyChip
                    active={state.draft.speciesId === species.id}
                    onClick={() => report.setSpecies(species.id)}
                  >
                    {species.commonNameZh}
                  </KdyChip>
                  {species.isProtected && <KdyTag tone='danger'>保护 / 重点管理</KdyTag>}
                </View>
              ))}
            </View>

            {selectedSpecies !== undefined && selectedSpecies.isNestingSensitive && (
              <Text className='kdy-wildlife-report__tip'>
                该物种繁殖期敏感（{selectedSpecies.nestingMonths.join('、')} 月），
                繁殖期的模糊半径会加倍，请勿靠近巢区。
              </Text>
            )}
          </KdyCard>

          {/* ③ 「手动给个名字」（规格 §5.6 (b)） */}
          <KdyCard title='这是某只熟悉的动物吗？（选填）' elevated={false}>
            <View className='kdy-wildlife-report__individuals'>
              {state.individuals
                .filter((item) => state.draft.speciesId === null || item.speciesId === state.draft.speciesId)
                .map((individual) => (
                  <View
                    key={individual.id}
                    className='kdy-wildlife-report__individual'
                  >
                    <KdyChip
                      active={state.draft.individualId === individual.id}
                      onClick={() => report.setIndividual(individual.id)}
                    >
                      {individual.name}
                    </KdyChip>
                  </View>
                ))}
            </View>
            <KdyField
              label={`新建个体名字（≤${WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH} 字）`}
              value={state.draft.newIndividualName ?? ''}
              maxLength={WILDLIFE_INDIVIDUAL_NAME_MAX_LENGTH}
              placeholder='例如：大橘'
              onChange={report.setNewIndividualName}
            />
            <Text className='kdy-wildlife-report__tip'>
              新个体需要审核后才会公开（防止恶搞命名）。不填也可以正常上报。
            </Text>
          </KdyCard>

          {/* ④ 发现时间（默认现在，可改） */}
          <KdyCard title='发现时间' elevated={false}>
            <View className='kdy-wildlife-report__time'>
              <Text className='kdy-wildlife-report__time-value'>
                {date} {time}
              </Text>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => {
                  const current = container.clock.now()
                  setDate(todayLocal(current))
                  setTime(timeLocal(current))
                  report.setObservedAt(current.toISOString())
                }}
              >
                设为现在
              </KdyButton>
            </View>

            <View className='kdy-wildlife-report__pickers'>
              <View className='kdy-wildlife-report__picker'>
                <KdyPicker
                  mode='date'
                  placeholder='选择日期'
                  value={date}
                  onChange={(value) => {
                    setDate(value)
                    report.setObservedAt(toIsoFromLocal(value, time))
                  }}
                />
              </View>
              <View className='kdy-wildlife-report__picker'>
                <KdyPicker
                  mode='time'
                  placeholder='选择时间'
                  value={time}
                  onChange={(value) => {
                    setTime(value)
                    report.setObservedAt(toIsoFromLocal(date, value))
                  }}
                />
              </View>
            </View>

            <Text className='kdy-wildlife-report__tip'>
              发现时间与「上报时间」是两件事：补录时请填真正看到它的时间，
              发现时间需在最近 30 天内。
            </Text>
          </KdyCard>

          {/* ⑤ 地点：定位（WGS84）或地图点选（GCJ-02） */}
          <KdyCard title='地点' elevated={false}>
            <View className='kdy-wildlife-report__actions'>
              <KdyButton size='sm' variant='secondary' onClick={() => void handleLocate()}>
                使用当前定位（GPS / WGS84）
              </KdyButton>
              <KdyButton size='sm' variant='ghost' onClick={() => setPickerOpen(!pickerOpen)}>
                {pickerOpen ? '收起地图选点' : '在地图上点选'}
              </KdyButton>
            </View>

            <Text className='kdy-wildlife-report__coord'>
              当前记录坐标：{state.draft.point.lat.toFixed(5)}, {state.draft.point.lng.toFixed(5)}（
              {state.draft.coordinateSystem === 'gcj02' ? 'GCJ-02，提交前会转回 WGS84' : 'WGS84'}）
            </Text>

            {pickerOpen && (
              <Map
                className='kdy-wildlife-report__canvas'
                longitude={center.lng}
                latitude={center.lat}
                scale={17}
                showLocation
                markers={[
                  {
                    id: 0,
                    latitude: center.lat,
                    longitude: center.lng,
                    title: '所选位置',
                    iconPath: MAP_MARKER_ICONS.sighting,
                    width: 24,
                    height: 24,
                    callout: buildCallout('点地图任意位置选点'),
                  },
                ]}
                onTap={(event) => {
                  const detail = event.detail as { latitude?: number; longitude?: number }
                  if (detail.latitude !== undefined && detail.longitude !== undefined) {
                    handleMapTap(detail.latitude, detail.longitude)
                  }
                }}
                onError={() => toast('地图组件加载失败：请检查网络，或在小程序后台配置地图 key')}
              />
            )}

            <KdyPrivacyNotice
              fuzzLevel={selectedZone?.isSensitive === true ? 'zone-only' : 'grid'}
              fuzzRadiusM={selectedZone?.fuzzRadiusM ?? 50}
              isSensitive={selectedZone?.isSensitive === true}
            />

            <KdyField label='所属区域（选填）'>
              <View className='kdy-wildlife-report__zones'>
                {mapState.zones.map((zone) => (
                  <View
                    key={zone.id}
                    className='kdy-wildlife-report__zone'
                  >
                    <KdyChip
                      active={state.draft.zoneId === zone.id}
                      onClick={() => report.setZoneId(state.draft.zoneId === zone.id ? null : zone.id)}
                    >
                      {zone.name}
                    </KdyChip>
                  </View>
                ))}
              </View>
            </KdyField>

            {selectedZone !== undefined && selectedZone.feedingPolicy === 'forbidden' && (
              <Text className='kdy-wildlife-report__forbidden'>
                ⛔ 该区域禁止投喂，请勿投喂{speciesDisplayName(selectedSpecies)}。
              </Text>
            )}
          </KdyCard>

          {/* ⑥ 备注 / 健康异常 / 匿名 */}
          <KdyCard title='补充信息' elevated={false}>
            <KdyField
              label={`备注（≤${WILDLIFE_NOTE_MAX_LENGTH} 字）`}
              multiline
              value={state.draft.note}
              maxLength={WILDLIFE_NOTE_MAX_LENGTH}
              placeholder='例如：两只，在草坪东侧'
              onChange={report.setNote}
            />

            <KdySwitch
              checked={state.draft.healthConcern}
              label='疑似受伤 / 异常'
              description='标记后不等审核就会通知校园动物社团；请勿自行处理受伤动物'
              onChange={report.setHealthConcern}
            />

            <KdySwitch
              checked={state.draft.anonymous}
              label='匿名上报'
              description='匿名后其他同学看到的是「匿名同学」，你的身份不会出现在公开信息里'
              onChange={report.setAnonymous}
            />
          </KdyCard>

          {/* ⑦ 伦理与隐私（硬要求） */}
          <View className='kdy-wildlife-report__ethics'>
            <KdyEthicsNotice
              policy={effectivePolicy}
              speciesName={speciesDisplayName(selectedSpecies)}
              zoneName={selectedZone?.name}
              noticeText={
                selectedZone?.noticeText ?? feedingPolicyNotice(effectivePolicy, speciesDisplayName(selectedSpecies))
              }
              requireAck
              acknowledged={state.draft.ethicsAcknowledged}
              onAcknowledgeChange={(value) => report.setEthicsAcknowledged(value)}
            />
          </View>

          <View className='kdy-wildlife-report__privacy'>
            <KdyPrivacyNotice
              fuzzLevel={selectedZone?.isSensitive === true ? 'zone-only' : 'grid'}
              fuzzRadiusM={selectedZone?.fuzzRadiusM ?? 50}
              isSensitive={selectedZone?.isSensitive === true}
              showAggregation
            />
          </View>

          {state.errors.length > 0 && (
            <View className='kdy-wildlife-report__errors'>
              {state.errors.map((error) => (
                <Text key={`${error.field}-${error.reason}`} className='kdy-wildlife-report__error'>
                  · {error.message}
                </Text>
              ))}
            </View>
          )}

          {state.error !== null && state.errors.length === 0 && (
            <Text className='kdy-wildlife-report__error'>{state.error}</Text>
          )}

          <View className='kdy-wildlife-report__submit'>
            <KdyButton
              block
              loading={state.status === 'submitting' || state.status === 'uploading'}
              onClick={() => void handleSubmit()}
            >
              {state.status === 'submitting' ? '提交中…' : '提交上报'}
            </KdyButton>
          </View>

          <Text className='kdy-wildlife-report__tip'>
            提交后进入审核队列（默认 PENDING）。你可以在「我的上报」里修正物种或撤回。
          </Text>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
        投喂规范与告示文案为项目草案，未经校方或动物社团审核；识别结果仅供参考。
      </Text>
    </View>
  )
}
