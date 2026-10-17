import { useEffect, useState } from 'react'
import { Image, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { WILDLIFE_CATEGORIES } from '@kedaya/contracts/wildlife'
import type { WildlifeCategory, WildlifePhoto, WildlifeSighting } from '@kedaya/contracts/wildlife'
import { getContainer } from '../../../app/container'
import { observedTime } from '../../../domain/models/wildlife'
import { chooseWildlifePhotos, getWildlife, wildlifeNavigate, wildlifePhotoUrl } from '../../../platform/wildlife'
import { KdyButton } from '../../components'
import { useStore } from '../../hooks'
import './wildlife.scss'

export function CategoryFilter({ value, onChange, all = true }: { value: string; onChange: (id: string) => void; all?: boolean }) {
  const [categories, setCategories] = useState<readonly WildlifeCategory[]>(WILDLIFE_CATEGORIES)
  useEffect(() => { void getWildlife().categories().then(setCategories).catch(() => undefined) }, [])
  return <View className='wa-categories'>{all && <Text className={!value ? 'wa-chip active' : 'wa-chip'} onClick={() => onChange('')}>全部居民</Text>}
    {categories.map(c => <Text key={c.id} className={value === c.id ? 'wa-chip active' : 'wa-chip'} onClick={() => onChange(c.id)}>{c.label}</Text>)}</View>
}
export const categoryLabel = (id: string) => WILDLIFE_CATEGORIES.find(c => c.id === id)?.label ?? id
export const ErrorNotice = ({ message }: { message: string }) => message ? <View className='wa-error'>{message}</View> : null
export function PhotoPicker({ photos, onChange, max = 6, onBusyChange }: { photos: WildlifePhoto[]; onChange: (photos: WildlifePhoto[]) => void; max?: number; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function choose() {
    setBusy(true); onBusyChange?.(true); setError('')
    try { onChange([...photos, ...await chooseWildlifePhotos(max - photos.length)]) }
    catch (e) { if (!String(e).includes('cancel')) setError(e instanceof Error ? e.message : '上传失败，请重试') }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  return <View><View className='wa-photos'>{photos.map(p => <View key={p.id}><Image className='wa-thumb' src={wildlifePhotoUrl(p.url)} mode='aspectFill' />
    <Text className='wa-link' onClick={() => onChange(photos.filter(photo => photo.id !== p.id))}>移除</Text></View>)}</View>
    {photos.length < max && <KdyButton loading={busy} disabled={busy} variant='ghost' onClick={() => { void choose() }}>{busy ? '照片上传中…' : '拍照 / 从相册选择'}</KdyButton>}
    <Text className='wa-muted'>最多 {max} 张，每张不超过 8MB；仅支持 JPEG、PNG、WebP。</Text><ErrorNotice message={error} /></View>
}
export function WildlifeLogin() {
  const container = getContainer(), state = useStore(container.useCases.session)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const valid = state.tokens && !state.tokens.accessToken.startsWith('mock-')
  const [studentId, setStudentId] = useState('20260001')
  async function login() {
    if (!/^\d{8}$/.test(studentId)) { setError('请输入 8 位测试学号'); return }
    setBusy(true); setError('')
    try {
      const result = await container.apiClient.post<{ accessToken: string; refreshToken: string; expiresIn: number; user: { id: string; displayName: string } }>('/auth/login', { ticket: `mock-${studentId}` }, { anonymous: true })
      if (!result.ok) throw new Error(result.error.message)
      const r = result.value
      container.useCases.session.signIn({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: new Date(Date.now() + r.expiresIn * 1000).toISOString() },
        { id: r.user.id, nickname: r.user.displayName, studentId, campusBound: false })
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败') } finally { setBusy(false) }
  }
  if (valid) return <Text className='wa-muted'>以 {state.profile?.nickname} 发布 · 内容向所有同学公开</Text>
  return <View className='wa-panel'><Text>浏览无需登录；发布需要共享服务的有效账号。</Text>
    <Text className='wa-muted'>统一认证目前为开发环境，测试学号不代表真实校园认证。</Text>
    <Input className='wa-input' type='number' maxlength={8} value={studentId} onInput={e => setStudentId(e.detail.value)} placeholder='8 位测试学号' />
    <KdyButton loading={busy} onClick={() => { void login() }}>连接共享服务开发账号</KdyButton><ErrorNotice message={error} /></View>
}
export function Postcard({ record, onClose, onDeleted }: { record: WildlifeSighting; onClose: () => void; onDeleted: () => void }) {
  const state = useStore(getContainer().useCases.session), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function remove() {
    if (!(await Taro.showModal({ title: '删除这次偶遇？', content: '删除后其他同学也将无法看到。' })).confirm) return
    setBusy(true)
    try { await getWildlife().removeSighting(record.id); onDeleted() } catch (e) { setError(e instanceof Error ? e.message : '删除失败') } finally { setBusy(false) }
  }
  return <View className='wa-overlay'><View className='wa-postcard'>
    <Text className='wa-close' onClick={onClose}>关闭 ×</Text><Text className='wa-eyebrow'>POSTCARD FROM CAMPUS</Text>
    <View className='wa-photo-strip'>{record.photos.map(p => <Image key={p.id} className='wa-cover' src={wildlifePhotoUrl(p.url)} mode='aspectFill'
      onClick={() => { void Taro.previewImage({ current: wildlifePhotoUrl(p.url), urls: record.photos.map(item => wildlifePhotoUrl(item.url)) }) }} />)}</View>
    {!record.photos.length && <View className='wa-no-photo'>一次没有照片的校园偶遇</View>}
    <Text className='wa-title'>{record.animal?.name ?? categoryLabel(record.category)}</Text>
    <Text className='wa-meta'>{observedTime(record.observedAt)} · {record.place}</Text>
    <Text className='wa-story'>{record.description}</Text><Text className='wa-muted'>来自 {record.author.displayName} 的校园日记{record.locationBlurred ? ' · 位置已模糊' : ''}</Text>
    {record.animalId && <KdyButton onClick={() => { void wildlifeNavigate('resident', { id: record.animalId! }) }}>认识这位居民</KdyButton>}
    {state.profile?.id === record.createdBy && <View className='wa-actions'><KdyButton variant='ghost' onClick={() => { void wildlifeNavigate('encounter', { id: record.id }) }}>编辑 / 关联身份</KdyButton>
      <KdyButton variant='danger' loading={busy} onClick={() => { void remove() }}>删除偶遇</KdyButton></View>}
    <ErrorNotice message={error} /></View></View>
}
