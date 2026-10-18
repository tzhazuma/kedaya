import { Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { WILDLIFE_CAMPUS } from '@kedaya/contracts/wildlife'
import type { WildlifeAnimal, WildlifePhoto } from '@kedaya/contracts/wildlife'
import { requestId } from '../../../../domain/models/wildlife'
import { getContainer } from '../../../../app/container'
import { getWildlife, wildlifeLocation, wildlifeNavigate } from '../../../../platform/wildlife'
import { KdyButton } from '../../../components'
import { useThemeMode } from '../../../theme/useThemeMode'
import { CategoryFilter, ErrorNotice, PhotoPicker, WildlifeLogin } from '../components'
import { useStore } from '../../../hooks'
import { isOnCampus } from '@kedaya/contracts/campus-map'
import { CampusView } from '../campus-view'
import '../wildlife.scss'

function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export default function EncounterPage() {
  const { mode } = useThemeMode()
  const params = useRouter().params, id = params.id
  const [category, setCategory] = useState('cat'), [description, setDescription] = useState(''), [place, setPlace] = useState('')
  const [latitude, setLatitude] = useState(String(WILDLIFE_CAMPUS.latitude)), [longitude, setLongitude] = useState(String(WILDLIFE_CAMPUS.longitude))
  const [chosen, setChosen] = useState(false), [blurred, setBlurred] = useState(false), [photos, setPhotos] = useState<WildlifePhoto[]>([])
  const [date, setDate] = useState(localDate(new Date())), [time, setTime] = useState(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`)
  const [animalId, setAnimalId] = useState(params.animalId ?? ''), [animals, setAnimals] = useState<WildlifeAnimal[]>([])
  const [search, setSearch] = useState(''), [animalCursor, setAnimalCursor] = useState<string | null>(null), [animalBusy, setAnimalBusy] = useState(false)
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [loading, setLoading] = useState(Boolean(id)), [error, setError] = useState('')
  const key = useRef(requestId()), sequence = useRef(0), lock = useRef(false)
  const originalPoint = useRef<{ latitude: number; longitude: number; locationBlurred: boolean } | null>(null)
  const session = useStore(getContainer().useCases.session)
  const loggedIn = session.tokens && !session.tokens.accessToken.startsWith('mock-')
  useEffect(() => {
    const onCreated = (animal: { id: string; category: string }) => { setCategory(animal.category); setAnimalId(animal.id); setSearch('') }
    Taro.eventCenter.on('wildlife:animal-created', onCreated)
    return () => { Taro.eventCenter.off('wildlife:animal-created', onCreated) }
  }, [])
  async function loadAnimals(next?: string) {
    const seq = ++sequence.current; setAnimalBusy(true)
    try { const page = await getWildlife().animals({ category, search, cursor: next, limit: 30 }); if (seq !== sequence.current) return
      setAnimals(old => next ? [...old, ...page.items] : page.items); setAnimalCursor(page.nextCursor) }
    catch (e) { setError(e instanceof Error ? e.message : '身份卡加载失败') } finally { if (seq === sequence.current) setAnimalBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => { void loadAnimals() }, 300); return () => { clearTimeout(timer); sequence.current++ } }, [category, search])
  useDidShow(() => { void loadAnimals() })
  useEffect(() => {
    if (id) void getWildlife().sighting(id).then(r => { originalPoint.current = r; setCategory(r.category); setDescription(r.description); setPlace(r.place); setLatitude(String(r.latitude)); setLongitude(String(r.longitude));
      setChosen(true); setBlurred(r.locationBlurred); setPhotos(r.photos); setAnimalId(r.animalId ?? ''); const d = new Date(r.observedAt); setDate(localDate(d)); setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
    else if (params.animalId) void getWildlife().animal(params.animalId).then(a => setCategory(a.category)).catch(e => setError(e.message))
  }, [id, params.animalId])
  function setPoint(lat: number, lng: number, name?: string) { if (!isOnCampus({ latitude: lat, longitude: lng })) { setError('请在上科大校园范围内选择发现位置'); return } setLatitude(String(lat)); setLongitude(String(lng)); setChosen(true); if (name) setPlace(name) }
  async function locate() { try { const p = await wildlifeLocation(); setError(''); setPoint(p.latitude, p.longitude) } catch { setError('定位未授权或不可用，请在下方校园地图点击选点，或手动填写 GCJ-02 坐标。') } }
  async function submit() {
    if (lock.current) return
    setError('')
    if (!loggedIn) { setError('请先连接共享服务账号'); return }
    const lat = Number(latitude), lng = Number(longitude), observed = new Date(`${date}T${time}:00`)
    if (!chosen || !latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setError('请确认真实发现位置'); return }
    const old = originalPoint.current, unchangedBlur = old?.locationBlurred && old.latitude === lat && old.longitude === lng
    if (!isOnCampus({ latitude: lat, longitude: lng }) && !unchangedBlur) { setError('发现地点必须位于上科大校园内'); return }
    if (!description.trim() || !place.trim()) { setError('请填写发现地点和偶遇故事'); return }
    if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() + 300000) { setError('发现时间无效或晚于当前时间'); return }
    lock.current = true; setBusy(true)
    try { const saved = await getWildlife().saveSighting({ category, description, place, latitude: lat, longitude: lng, locationBlurred: blurred, observedAt: observed.toISOString(), animalId: animalId || null,
      photoIds: photos.map(p => p.id), clientRequestId: key.current }, id)
      Taro.eventCenter.trigger('wildlife:sighting-saved', saved)
      await Taro.showToast({ title: id ? '偶遇已更新' : '偶遇已发布', icon: 'success' }); await Taro.navigateBack()
    } catch (e) { setError(e instanceof Error ? e.message : '发布失败，请重试') } finally { lock.current = false; setBusy(false) }
  }
  return <View className={`wa-page wa-form kdy-theme--${mode}`}><Text className='wa-eyebrow'>LEAVE A LITTLE CAMPUS STORY</Text><Text className='wa-heading'>{id ? '编辑这次偶遇' : '记录一次偶遇'}</Text><WildlifeLogin />
    {loading && <Text>正在读取原始记录…</Text>}<Text className='wa-label'>你遇见了谁？</Text><CategoryFilter all={false} value={category} onChange={v => { setCategory(v); setAnimalId('') }} />
    <Text className='wa-label'>发现位置 · 点击校园地图或搜索地标选点</Text><View className='wa-actions'><KdyButton variant='ghost' onClick={() => { void locate() }}>使用当前定位</KdyButton></View>
    <CampusView picked={chosen ? { latitude: Number(latitude), longitude: Number(longitude) } : null} onPick={(p, name) => setPoint(p.latitude, p.longitude, name)} />
    <View className='wa-fields'><Input className='wa-input' value={latitude} onInput={e => { setLatitude(e.detail.value); setChosen(false) }} placeholder='纬度 GCJ-02' /><Input className='wa-input' value={longitude} onInput={e => { setLongitude(e.detail.value); setChosen(false) }} placeholder='经度 GCJ-02' /></View>
    <Text className='wa-link' onClick={() => setChosen(true)}>{chosen ? '✓ 已确认发现位置' : '我确认以上坐标为发现位置'}</Text>
    <Input className='wa-input' value={place} maxlength={200} onInput={e => setPlace(e.detail.value)} placeholder='地点名称，例如图书馆东侧草坪（必填）' />
    <View className='wa-switch-row'><Switch checked={blurred} onChange={e => setBlurred(e.detail.value)} color='#607C55' /><Text>模糊动物位置（约百米，不保存精确点）</Text></View>
    {id && blurred && <Text className='wa-muted'>这条记录的坐标已按约百米模糊保存。关闭开关不会恢复精确位置；重新在地图上选点可保存新的精确位置。</Text>}
    <Text className='wa-label'>留下照片</Text><PhotoPicker photos={photos} onChange={setPhotos} onBusyChange={setUploading} />
    <Text className='wa-label'>写一张偶遇明信片</Text><Textarea className='wa-textarea' value={description} maxlength={1500} onInput={e => setDescription(e.detail.value)} placeholder='它在做什么？有什么有趣的瞬间？（必填）' />
    <Text className='wa-label'>发现时间</Text><View className='wa-fields'><Picker mode='date' value={date} end={localDate(new Date())} onChange={e => setDate(e.detail.value)}><View className='wa-input'>{date}</View></Picker><Picker mode='time' value={time} onChange={e => setTime(e.detail.value)}><View className='wa-input'>{time}</View></Picker></View>
    <Text className='wa-label'>关联居民身份（可不选）</Text><Input className='wa-input' value={search} maxlength={120} onInput={e => setSearch(e.detail.value)} placeholder='搜索昵称、区域或外貌特征' />
    <View className='wa-categories'><Text className={!animalId ? 'wa-chip active' : 'wa-chip'} onClick={() => setAnimalId('')}>暂不关联</Text>{animals.map(a => <Text key={a.id} className={animalId === a.id ? 'wa-chip active' : 'wa-chip'} onClick={() => setAnimalId(a.id)}>{a.name} · {a.commonArea || a.appearance || '查看身份卡核对'}</Text>)}</View>
    {animalId && !animals.some(a => a.id === animalId) && <Text className='wa-muted'>已关联身份卡：{animalId}</Text>}
    {animalCursor && <KdyButton loading={animalBusy} variant='ghost' onClick={() => { void loadAnimals(animalCursor) }}>加载更多身份卡</KdyButton>}
    <KdyButton variant='ghost' onClick={() => { void wildlifeNavigate('identity', { category }) }}>没有找到？先搜索并建立身份卡</KdyButton>
    <Text className='wa-muted'>发布的是动物的一次历史偶遇，所有同学可见。请保持观察距离，不追逐、不暴露其他人的实时位置。</Text>
    <ErrorNotice message={error} /><KdyButton block disabled={busy || uploading || loading || !loggedIn} loading={busy} onClick={() => { void submit() }}>{uploading ? '请等待照片上传' : id ? '保存修改' : '发布偶遇明信片'}</KdyButton>
  </View>
}
