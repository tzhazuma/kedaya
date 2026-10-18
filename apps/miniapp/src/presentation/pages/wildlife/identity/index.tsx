import { Input, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { WildlifeAnimal, WildlifePhoto } from '@kedaya/contracts/wildlife'
import { getContainer } from '../../../../app/container'
import { requestId } from '../../../../domain/models/wildlife'
import { getWildlife, wildlifeNavigate } from '../../../../platform/wildlife'
import { KdyButton } from '../../../components'
import { useThemeMode } from '../../../theme/useThemeMode'
import { useStore } from '../../../hooks'
import { CategoryFilter, ErrorNotice, PhotoPicker, WildlifeLogin } from '../components'
import '../wildlife.scss'

export default function IdentityPage() {
  const { mode } = useThemeMode()
  const params = useRouter().params, id = params.id
  const [name, setName] = useState(''), [category, setCategory] = useState(params.category ?? 'cat'), [photos, setPhotos] = useState<WildlifePhoto[]>([])
  const [appearance, setAppearance] = useState(''), [commonArea, setCommonArea] = useState(''), [description, setDescription] = useState('')
  const [candidates, setCandidates] = useState<WildlifeAnimal[]>([]), [checked, setChecked] = useState(false), [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [loading, setLoading] = useState(Boolean(id)), [error, setError] = useState('')
  const key = useRef(requestId()), lock = useRef(false), seq = useRef(0), state = useStore(getContainer().useCases.session)
  const loggedIn = state.tokens && !state.tokens.accessToken.startsWith('mock-')
  useEffect(() => {
    if (!id) return
    void getWildlife().animal(id).then(a => { setName(a.name); setCategory(a.category); setPhotos(a.avatar ? [a.avatar] : []); setAppearance(a.appearance); setCommonArea(a.commonArea); setDescription(a.description) })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [id])
  useEffect(() => {
    if (id) return
    const current = ++seq.current; setChecked(false); setSearched(false)
    const timer = setTimeout(() => {
      void getWildlife().animals({ category, search: name.trim(), limit: 12 }).then(page => { if (seq.current === current) { setCandidates(page.items); setSearched(true) } })
        .catch(e => { if (seq.current === current) { setError(e.message); setSearched(false) } })
    }, 400)
    return () => { clearTimeout(timer); seq.current++ }
  }, [category, name, id])
  async function submit() {
    if (lock.current) return
    setError('')
    if (!name.trim()) { setError('请给这位居民起一个昵称'); return }
    if (!id && (!checked || !searched)) { setError('请先查看已有档案，再确认不是同一位居民'); return }
    if (!loggedIn) { setError('请先连接共享服务账号'); return }
    lock.current = true; setBusy(true)
    try {
      const animal = await getWildlife().saveAnimal({ name, category, avatarId: photos[0]?.id ?? null, appearance, commonArea, description, clientRequestId: key.current }, id)
      Taro.eventCenter.trigger('wildlife:animal-created', { id: animal.id, category: animal.category })
      await Taro.showToast({ title: id ? '档案已更新' : '身份卡已建立', icon: 'success' }); await Taro.navigateBack()
    } catch (e) { setError(e instanceof Error ? e.message : '档案保存失败') } finally { lock.current = false; setBusy(false) }
  }
  return <View className={`wa-page wa-form kdy-theme--${mode}`}><Text className='wa-eyebrow'>A NAME FOR OUR NEIGHBOUR</Text><Text className='wa-heading'>{id ? '更新居民身份卡' : '建立居民身份卡'}</Text><WildlifeLogin />
    {loading && <Text>正在读取档案…</Text>}<Text className='wa-label'>昵称（必填，可以重名）</Text><Input className='wa-input' value={name} maxlength={60} onInput={e => setName(e.detail.value)} placeholder='例如：橘子' />
    <Text className='wa-label'>动物类别</Text><CategoryFilter all={false} value={category} onChange={setCategory} />
    {!id && <View className='wa-panel'><Text className='wa-title'>先看看，它已经有名字了吗？</Text><Text className='wa-muted'>按类别和昵称搜索。核对外貌与区域，避免为同一只动物重复建档。</Text>
      {candidates.map(a => <View className='wa-list-row' key={a.id} onClick={() => { void wildlifeNavigate('resident', { id: a.id }) }}><Text>{a.name} · {a.commonArea || '区域待补充'}</Text><Text className='wa-muted'>{a.appearance || '暂无外貌记录'} → 查看身份卡</Text></View>)}
      {searched && !candidates.length && <Text className='wa-muted'>当前搜索未找到相似昵称，可以换个名字再次搜索。</Text>}
      <View className='wa-switch-row'><Switch checked={checked} disabled={!searched} onChange={e => setChecked(e.detail.value)} color='#607C55' /><Text>已核对以上档案，没有发现同一位居民</Text></View></View>}
    <Text className='wa-label'>身份照片</Text><PhotoPicker photos={photos} onChange={setPhotos} max={1} onBusyChange={setUploading} />
    <Text className='wa-label'>外貌特征</Text><Textarea className='wa-textarea' value={appearance} maxlength={500} onInput={e => setAppearance(e.detail.value)} placeholder='毛色、花纹、体型，或其他容易辨认的特征' />
    <Text className='wa-label'>常见出没区域</Text><Input className='wa-input' value={commonArea} maxlength={200} onInput={e => setCommonArea(e.detail.value)} placeholder='例如：图书馆附近' />
    <Text className='wa-label'>居民小传</Text><Textarea className='wa-textarea' value={description} maxlength={1500} onInput={e => setDescription(e.detail.value)} placeholder='记录它的习惯和故事，避免未经确认的健康判断' />
    <ErrorNotice message={error} /><KdyButton block loading={busy} disabled={busy || uploading || loading || !loggedIn} onClick={() => { void submit() }}>{id ? '保存身份卡' : '建立共享身份卡'}</KdyButton>
  </View>
}
