import { Image, Input, Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { WildlifeAnimal } from '@kedaya/contracts/wildlife'
import { getWildlife, wildlifeNavigate, wildlifePhotoUrl } from '../../../../platform/wildlife'
import { KdyButton } from '../../../components'
import { CategoryFilter, ErrorNotice, categoryLabel } from '../components'
import '../wildlife.scss'

export default function ArchivePage() {
  const [category, setCategory] = useState(''), [search, setSearch] = useState(''), [items, setItems] = useState<WildlifeAnimal[]>([])
  const [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), seq = useRef(0)
  async function load(next?: string) {
    const current = ++seq.current; setBusy(true); setError('')
    try { const result = await getWildlife().animals({ category: category || undefined, search, cursor: next, limit: 30 }); if (current !== seq.current) return
      setItems(old => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor) }
    catch (e) { if (current === seq.current) setError(e instanceof Error ? e.message : '档案加载失败') } finally { if (current === seq.current) setBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => { void load() }, 300); return () => { clearTimeout(timer); seq.current++ } }, [category, search])
  useDidShow(() => { void load() })
  useReachBottom(() => { if (cursor && !busy) void load(cursor) })
  return <View className='wa-page'><View className='wa-header'><Text className='wa-eyebrow'>MEET OUR WILD NEIGHBOURS</Text><Text className='wa-heading'>居民档案馆</Text><Text className='wa-muted'>每一位居民，都有同学们一起记下的故事。</Text></View>
    <Input className='wa-input' value={search} maxlength={120} onInput={e => setSearch(e.detail.value)} placeholder='搜索昵称、外貌或常见区域' /><CategoryFilter value={category} onChange={setCategory} />
    <KdyButton onClick={() => { void wildlifeNavigate('identity', { category: category || 'cat' }) }}>＋ 建立居民身份卡</KdyButton><ErrorNotice message={error} />
    {busy && <Text className='wa-muted'>正在寻找校园居民…</Text>}
    {!busy && !error && !items.length && <View className='wa-empty'>没有找到对应档案。先换个昵称或区域搜索，避免重复创建。</View>}
    <View className='wa-residents'>{items.map(a => <View className='wa-id-card' key={a.id} onClick={() => { void wildlifeNavigate('resident', { id: a.id }) }}>
      {a.avatar ? <Image className='wa-avatar' src={wildlifePhotoUrl(a.avatar.url)} mode='aspectFill' /> : <View className='wa-avatar wa-no-photo'>{categoryLabel(a.category)}</View>}
      <Text className='wa-eyebrow'>CAMPUS RESIDENT</Text><Text className='wa-title'>{a.name}</Text><Text>{categoryLabel(a.category)} · {a.sightingCount} 次偶遇</Text>
      <Text className='wa-muted'>{a.appearance || '外貌有待大家继续观察'}</Text><Text className='wa-meta'>常见区域：{a.commonArea || '尚未记录'}</Text></View>)}</View>
    {cursor && <KdyButton variant='ghost' loading={busy} onClick={() => { void load(cursor) }}>加载更多居民</KdyButton>}
  </View>
}
