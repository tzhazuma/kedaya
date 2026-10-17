import { Image, Text, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useRef, useState } from 'react'
import type { WildlifeAnimal, WildlifeSighting } from '@kedaya/contracts/wildlife'
import { getContainer } from '../../../../app/container'
import { observedTime } from '../../../../domain/models/wildlife'
import { getWildlife, wildlifeNavigate, wildlifePhotoUrl } from '../../../../platform/wildlife'
import { useStore } from '../../../hooks'
import { KdyButton } from '../../../components'
import { ErrorNotice, Postcard, categoryLabel } from '../components'
import '../wildlife.scss'

export default function ResidentPage() {
  const id = useRouter().params.id ?? '', [animal, setAnimal] = useState<WildlifeAnimal | null>(null), [items, setItems] = useState<WildlifeSighting[]>([])
  const [cursor, setCursor] = useState<string | null>(null), [selected, setSelected] = useState<WildlifeSighting | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), seq = useRef(0), state = useStore(getContainer().useCases.session)
  async function load(next?: string) {
    const current = ++seq.current; setBusy(true); setError('')
    try { const [a, records] = await Promise.all([getWildlife().animal(id), getWildlife().sightings({ animalId: id, cursor: next, limit: 30 })]); if (current !== seq.current) return
      setAnimal(a); setItems(old => next ? [...old, ...records.items] : records.items); setCursor(records.nextCursor) }
    catch (e) { if (current === seq.current) setError(e instanceof Error ? e.message : '居民档案读取失败') } finally { if (current === seq.current) setBusy(false) }
  }
  useDidShow(() => { void load() })
  return <View className='wa-page'><ErrorNotice message={error} />{error && <KdyButton variant='ghost' onClick={() => { void load() }}>重试</KdyButton>}{busy && <Text className='wa-muted'>正在翻阅居民档案…</Text>}
    {animal && <><View className='wa-passport'><Text className='wa-eyebrow'>SHANGHAITECH · WILD RESIDENT</Text>
      {animal.avatar ? <Image className='wa-passport-photo' src={wildlifePhotoUrl(animal.avatar.url)} mode='aspectFill' /> : <View className='wa-passport-photo wa-no-photo'>{categoryLabel(animal.category)}</View>}
      <Text className='wa-heading'>{animal.name}</Text><Text>{categoryLabel(animal.category)} · 被同学们遇见 {animal.sightingCount} 次</Text><Text className='wa-meta'>居民编号 {animal.id}</Text>
      <Text className='wa-label'>外貌特征</Text><Text>{animal.appearance || '还没有记录'}</Text><Text className='wa-label'>常见区域</Text><Text>{animal.commonArea || '等待更多观察'}</Text>
      <Text className='wa-label'>居民小传</Text><Text className='wa-story'>{animal.description || '属于它的校园故事，由下一次偶遇开始。'}</Text><Text className='wa-muted'>由 {animal.creator.displayName} 于 {observedTime(animal.createdAt)} 建档</Text></View>
      <View className='wa-actions'><KdyButton onClick={() => { void wildlifeNavigate('encounter', { animalId: animal.id }) }}>我也遇见过它</KdyButton>
        {state.profile?.id === animal.createdBy && <KdyButton variant='ghost' onClick={() => { void wildlifeNavigate('identity', { id: animal.id }) }}>编辑身份卡</KdyButton>}</View>
      <Text className='wa-section-title'>居民足迹</Text><Text className='wa-muted'>历史目击记录不代表它此刻的位置。</Text>
      {!busy && !items.length && <View className='wa-empty'>还没有偶遇记录，成为第一个记录它的同学吧。</View>}
      {items.map(r => <View className='wa-timeline-item' key={r.id} onClick={() => setSelected(r)}><Text className='wa-meta'>{observedTime(r.observedAt)}</Text><Text className='wa-title'>{r.place}</Text><Text>{r.description}</Text><Text className='wa-link'>翻开偶遇明信片 →</Text></View>)}
      {cursor && <KdyButton variant='ghost' loading={busy} onClick={() => { void load(cursor) }}>更早的足迹</KdyButton>}</>}
    {selected && <Postcard record={selected} onClose={() => setSelected(null)} onDeleted={() => { setSelected(null); void load() }} />}
  </View>
}
