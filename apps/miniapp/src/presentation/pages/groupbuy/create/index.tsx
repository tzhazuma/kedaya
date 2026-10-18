import { Input, Text, Textarea, View } from '@tarojs/components'
import { useRef, useState } from 'react'
import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath } from '../../../../app/routes'
import { GROUP_BUY_CATEGORIES, GROUP_BUY_CATEGORY_LABELS } from '../../../../domain/models/groupbuy'
import type { GroupBuyCategory } from '../../../../domain/models/groupbuy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyTag } from '../../../components'
import { useThemeMode } from '../../../theme/useThemeMode'
import './index.scss'

export default function GroupBuyCreatePage() {
  const { mode } = useThemeMode()
  const [kind, setKind] = useState<'ordinary' | 'membership'>('ordinary')
  const [category, setCategory] = useState<GroupBuyCategory>('food')
  const [title, setTitle] = useState('')
  const [itemSpec, setItemSpec] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [price, setPrice] = useState('')
  const [pickup, setPickup] = useState('')
  const [merchant, setMerchant] = useState('')
  const [declared, setDeclared] = useState(false)
  const [saving, setSaving] = useState(false)
  const requestKey = useRef(`groupbuy:create:${Date.now()}:${Math.random().toString(36).slice(2)}`)

  async function submit(): Promise<void> {
    const targetCount = Number(target)
    const itemOptions = itemSpec.split(/[\n，,]/).map((item) => item.trim()).filter(Boolean)
    const priceFen = itemOptions.length > 1 ? 0 : price.trim() ? Math.round(Number(price) * 100) : 0
    if (!title.trim() || itemOptions.length === 0 || itemOptions.length > 12 || new Set(itemOptions).size !== itemOptions.length || !pickup.trim() || !Number.isInteger(targetCount) || targetCount < 1 || targetCount > 999) {
      toast('请填写标题、商品规格、目标份数和取货地点')
      return
    }
    if (!Number.isInteger(priceFen) || priceFen < 0) {
      toast('参考单价格式不正确')
      return
    }
    if (kind === 'membership' && (!merchant.trim() || !declared)) {
      toast('请填写商家并确认本人持有会员资格')
      return
    }
    setSaving(true)
    try {
      const result = await getContainer().useCases.manageGroupBuy.create({
        title, description, category, itemSpec: itemOptions.join('、'), itemOptions, targetCount, priceFen,
        pickupPlace: pickup, kind, merchantName: kind === 'membership' ? merchant : undefined,
        membershipDeclaration: kind === 'membership' && declared,
        idempotencyKey: requestKey.current,
      })
      if (!result.ok) {
        toast(result.error.message)
        if (result.error.code === 'UNAUTHENTICATED') void navigateTo(PAGE_PATHS.profile)
        return
      }
      toast('拼单已发起，24 小时内按总份数成团', 'success')
      void navigateTo(groupBuyDetailPath(result.value.id))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className={`kdy-page kdy-gb-create kdy-theme--${mode}`}>
      <KdyCard title='发起校园拼单'>
        <Text className='kdy-gb-create__hint'>用于宿舍群等线下拼单统计。创建后 24 小时内未凑满目标总份数，将自动取消。平台不收款。</Text>
        <View className='kdy-gb-create__choices'>
          <View onClick={() => setKind('ordinary')}><KdyTag tone={kind === 'ordinary' ? 'brand' : 'neutral'}>普通拼单</KdyTag></View>
          <View onClick={() => setKind('membership')}><KdyTag tone={kind === 'membership' ? 'brand' : 'neutral'}>会员代购</KdyTag></View>
        </View>
        {kind === 'membership' && (
          <View>
            <Text className='kdy-gb-create__label'>商家名称</Text>
            <Input className='kdy-gb-create__input' value={merchant} maxlength={100} placeholder='例如：山姆会员商店' onInput={(e) => setMerchant(e.detail.value)} />
            <View className='kdy-gb-create__declare' onClick={() => setDeclared(!declared)}>
              <Text>{declared ? '☑' : '□'} 我确认本人持有该商家有效会员资格</Text>
            </View>
            <Text className='kdy-gb-create__hint'>目前仅记录发起人声明，平台尚未核验会员资格。请勿填写卡号或密码。</Text>
          </View>
        )}
        <Text className='kdy-gb-create__label'>分类</Text>
        <View className='kdy-gb-create__choices'>
          {GROUP_BUY_CATEGORIES.map((value) => (
            <View key={value} onClick={() => setCategory(value)}>
              <KdyTag tone={category === value ? 'brand' : 'neutral'}>{GROUP_BUY_CATEGORY_LABELS[value]}</KdyTag>
            </View>
          ))}
        </View>
        <Text className='kdy-gb-create__label'>拼单标题</Text>
        <Input className='kdy-gb-create__input' value={title} maxlength={100} placeholder='例如：宿舍楼拼纸巾' onInput={(e) => setTitle(e.detail.value)} />
        <Text className='kdy-gb-create__label'>商品与规格（每行一种，最多 12 种）</Text>
        <Textarea className='kdy-gb-create__textarea' value={itemSpec} maxlength={1200} placeholder={'抽纸 3 包/份\n洗衣液 1 瓶/份'} onInput={(e) => setItemSpec(e.detail.value)} />
        <Text className='kdy-gb-create__label'>补充说明</Text>
        <Textarea className='kdy-gb-create__textarea' value={description} maxlength={1000} placeholder='采购方式、线下结算约定等' onInput={(e) => setDescription(e.detail.value)} />
        <Text className='kdy-gb-create__label'>目标总份数</Text>
        <Input className='kdy-gb-create__input' type='number' value={target} placeholder='例如：8' onInput={(e) => setTarget(e.detail.value)} />
        {itemSpec.split(/[\n，,]/).filter((item) => item.trim()).length <= 1 && <View><Text className='kdy-gb-create__label'>参考单价（元，可留空）</Text><Input className='kdy-gb-create__input' type='digit' value={price} placeholder='例如：12.50' onInput={(e) => setPrice(e.detail.value)} /></View>}
        <Text className='kdy-gb-create__label'>线下取货地点</Text>
        <Input className='kdy-gb-create__input' value={pickup} maxlength={100} placeholder='例如：三号宿舍楼大厅' onInput={(e) => setPickup(e.detail.value)} />
      </KdyCard>
      <View className='kdy-gb-create__submit'>
        <KdyButton block variant='primary' loading={saving} onClick={() => { void submit() }}>发起拼单</KdyButton>
      </View>
    </View>
  )
}
