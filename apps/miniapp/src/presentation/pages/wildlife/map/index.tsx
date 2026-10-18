import { Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { WILDLIFE_CAMPUS } from '@kedaya/contracts/wildlife'
import type { WildlifeSighting } from '@kedaya/contracts/wildlife'
import { groupSightings, observedTime } from '../../../../domain/models/wildlife'
import { CAMPUS_BOUNDS, isOnCampus } from '@kedaya/contracts/campus-map'
import { CampusView } from '../campus-view'
import { getWildlife, wildlifeLocation, wildlifeNavigate } from '../../../../platform/wildlife'
import { KdyButton } from '../../../components'
import { useThemeMode } from '../../../theme/useThemeMode'
import { CategoryFilter, ErrorNotice, Postcard, categoryLabel } from '../components'
import '../wildlife.scss'

export default function WildlifeMapPage() {
  const { mode } = useThemeMode()
  const [center, setCenter] = useState({ latitude: WILDLIFE_CAMPUS.latitude, longitude: WILDLIFE_CAMPUS.longitude })
  const bounds = CAMPUS_BOUNDS
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null)
  const [category, setCategory] = useState(''), [days, setDays] = useState(0)
  const [items, setItems] = useState<WildlifeSighting[]>([]), [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<WildlifeSighting | null>(null), [nearby, setNearby] = useState<WildlifeSighting[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [locationError, setLocationError] = useState('')
  const sequence = useRef(0), tracking = useRef(false)
  const enabled = useRef(false), mounted = useRef(true), autoLocated = useRef(false)
  const visible = useRef(true)
  // 发布时后端已校验校园范围；不再用 isOnCampus 过滤，避免「模糊位置」取整后落到边界外的记录从地图消失。
  const groups = groupSightings(items)
  async function load(next?: string) {
    const seq = ++sequence.current; setBusy(true); setError('')
    try {
      const result = await getWildlife().sightings({ ...bounds, category: category || undefined, limit: 100, cursor: next,
        since: days ? new Date(Date.now() - days * 86400000).toISOString() : undefined })
      if (seq !== sequence.current || !mounted.current) return
      setItems(old => next ? [...old, ...result.items.filter(i => !old.some(o => o.id === i.id))] : result.items); setCursor(result.nextCursor)
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : '共享记录加载失败') }
    finally { if (seq === sequence.current) setBusy(false) }
  }
  // 微信蓝点由前台位置监听更新；自己的实时位置不会进入任何 API 请求。
  const onLocation = useRef((point: Taro.onLocationChange.CallbackResult) => {
    if (mounted.current) setPosition({ latitude: point.latitude, longitude: point.longitude })
  })
  async function startTracking() {
    if (tracking.current) return
    tracking.current = true
    try { Taro.onLocationChange(onLocation.current); await Taro.startLocationUpdate({ type: 'gcj02' }); if (!visible.current) stopTracking() }
    catch { tracking.current = false; Taro.offLocationChange(onLocation.current); setLocationError('持续定位暂不可用，可点击“我的位置”重新定位或手动选点。') }
  }
  function stopTracking() {
    Taro.offLocationChange(onLocation.current)
    if (tracking.current) Taro.stopLocationUpdate({ fail: () => undefined })
    tracking.current = false
  }
  async function locate() {
    try {
      const point = await wildlifeLocation(); setPosition(point); if (isOnCampus(point)) { setCenter(point); setLocationError('') } else setLocationError('你目前在校园范围外，地图保持在上科大校内。'); enabled.current = true; await startTracking()
    } catch { setLocationError('未获得定位或定位失败。仍可浏览校园地图，发布时可手动选点。') }
  }
  /** 首次进入只取一次位置并居中；持续监听必须由用户主动点击“我的位置”开启。 */
  async function autoLocate() {
    try { const point = await wildlifeLocation(); setPosition(point); if (isOnCampus(point)) { setCenter(point); setLocationError('') } }
    catch { setLocationError('未获得定位授权。你仍可浏览校园地图，发布时手动选点。') }
  }
  useDidShow(() => {
    visible.current = true; void load()
    if (!autoLocated.current) { autoLocated.current = true; void autoLocate() }
    else if (enabled.current) void startTracking()
  })
  useDidHide(() => { visible.current = false; stopTracking() })
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()) })
  useEffect(() => { void load() }, [category, days, bounds])
  useEffect(() => {
    const onSaved = (record: WildlifeSighting) => setSelected(record)
    Taro.eventCenter.on('wildlife:sighting-saved', onSaved)
    return () => { Taro.eventCenter.off('wildlife:sighting-saved', onSaved) }
  }, [])
  useEffect(() => () => { mounted.current = false; sequence.current++; stopTracking() }, [])
  return <View className={`wa-page wa-map-page kdy-theme--${mode}`}>
    <View className='wa-header'><Text className='wa-eyebrow'>WILD RESIDENTS ARCHIVE</Text><Text className='wa-heading'>野生居民档案</Text>
      <Text className='wa-muted'>记录每一次偶遇，认识校园里的每一位野生居民。</Text></View>
    <CategoryFilter value={category} onChange={setCategory} />
    <View className='wa-categories'>{[1, 7, 30, 0].map(n => <Text key={n} className={days === n ? 'wa-chip active' : 'wa-chip'} onClick={() => setDays(n)}>{n ? `最近 ${n} 天` : '全部时间'}</Text>)}</View>
    <CampusView groups={groups} position={position} focus={center} onSelect={group => { if (group.length > 1) setNearby(group); else setSelected(group[0]!) }} />
    <View className='wa-actions'><KdyButton variant='ghost' onClick={() => { void locate() }}>我的位置</KdyButton>
      <KdyButton variant='ghost' onClick={() => { setCenter({ latitude: WILDLIFE_CAMPUS.latitude, longitude: WILDLIFE_CAMPUS.longitude }) }}>回到校园</KdyButton>
      <KdyButton variant='ghost' onClick={() => { void load() }}>刷新偶遇</KdyButton></View>
    <ErrorNotice message={locationError} /><ErrorNotice message={error} />
    <View className='wa-actions'><KdyButton onClick={() => { void wildlifeNavigate('encounter') }}>＋ 记录偶遇</KdyButton><KdyButton variant='ghost' onClick={() => { void wildlifeNavigate('archive') }}>居民档案馆 →</KdyButton></View>
    <Text className='wa-section-title'>这一带的校园故事 · {items.length} 条</Text><Text className='wa-muted'>标记代表一次偶遇，不代表动物当前所在位置。你的实时位置不会共享。</Text>
    {busy && <Text className='wa-muted'>正在同步共享记录…</Text>}
    {!busy && !error && !items.length && <View className='wa-empty'>这里还没有这一时间范围的偶遇，留下第一张校园明信片吧。</View>}
    {items.map(item => <View key={item.id} className='wa-list-row' onClick={() => setSelected(item)}><Text className='wa-title'>{item.animal?.name ?? categoryLabel(item.category)}</Text>
      <Text>{item.description}</Text><Text className='wa-meta'>{item.place} · {observedTime(item.observedAt)}</Text></View>)}
    {cursor && <KdyButton loading={busy} disabled={busy} variant='ghost' onClick={() => { void load(cursor) }}>加载这一带更多偶遇</KdyButton>}
    {nearby.length > 0 && <View className='wa-overlay'><View className='wa-postcard'><Text className='wa-close' onClick={() => setNearby([])}>关闭 ×</Text><Text className='wa-title'>附近的 {nearby.length} 次偶遇</Text>
      {nearby.map(r => <View key={r.id} className='wa-list-row' onClick={() => { setNearby([]); setSelected(r) }}><Text>{r.animal?.name ?? categoryLabel(r.category)} · {r.place}</Text><Text className='wa-meta'>{observedTime(r.observedAt)}</Text></View>)}</View></View>}
    {selected && <Postcard record={selected} onClose={() => setSelected(null)} onDeleted={() => { setSelected(null); void load() }} />}
  </View>
}
