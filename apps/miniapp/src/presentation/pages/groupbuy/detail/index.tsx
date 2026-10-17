import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import { fenToYuan } from '@kedaya/shared'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath, readIdParam } from '../../../../app/routes'
import { navigateTo, toast } from '../../../../platform/navigation'
import { openLocation } from '../../../../platform/map'
import { shareToFriend } from '../../../../platform/share'
import { SUBSCRIBE_TEMPLATES, requestSubscribeMessage } from '../../../../platform/subscribeMessage'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 拼单详情页 —— 垂直切片的读 + 写。
 *
 * 动作覆盖：参团（写）、分享（微信特有 open-type）、复制链接（降级）、
 * 打开地图（微信原生 / H5 URI 降级）、订阅成团提醒（微信特有）。
 *
 * 三态：loading / error（带重试）/ ready。
 */

/** 上科大地标坐标（骨架占位；真实数据应由后端随拼单一起下发） */
const CAMPUS_POINT = {
  latitude: 31.179_431,
  longitude: 121.592_605,
  name: '上海科技大学',
  address: '上海市浦东新区华夏中路 393 号',
} as const

export default function GroupBuyDetailPage() {
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const container = getContainer()
  const detail = container.useCases.groupBuyDetail
  const join = container.useCases.joinGroupBuy
  const state = useStore(detail)
  const [joining, setJoining] = useState(false)
  const [quantity, setQuantity] = useState('1')
  const [itemQuantities, setItemQuantities] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState('')
  const profile = container.sessionStore.getSnapshot().profile

  useDidShow(() => {
    if (id === null) return
    detail.hydrate(id)
    void detail.load(id)
  })

  useEffect(() => {
    if (id === null) return
    detail.hydrate(id)
    void detail.load(id)
  }, [detail, id])

  useEffect(() => {
    const mine = state.groupBuy?.participants.find((participant) => participant.id === profile?.id)
    if (mine) {
      setQuantity(String(mine.quantity))
      setNote(mine.note ?? '')
      setItemQuantities(Object.fromEntries((mine.selections ?? []).map((line) => [line.item, String(line.quantity)])))
    }
  }, [state.groupBuy, profile?.id])

  useEffect(() => {
    setNotice(state.groupBuy?.pickupNotice ?? '')
  }, [state.groupBuy?.pickupNotice])

  useShareAppMessage(() => ({
    title: container.env.useMock ? '可达鸭拼单演示（本地数据不跨设备同步）' : state.summary?.title ?? '可达鸭 · 拼单',
    path: container.env.useMock || id === null ? PAGE_PATHS.groupBuyList : groupBuyDetailPath(id),
  }))

  async function handleJoin(): Promise<void> {
    if (id === null) return
    const options = state.groupBuy?.itemOptions?.length ? state.groupBuy.itemOptions : [state.groupBuy?.itemSpec || state.groupBuy?.title || '商品']
    const selections = options.length > 1
      ? options.map((item) => ({ item, quantity: Number(itemQuantities[item] ?? '0') })).filter((line) => line.quantity > 0)
      : [{ item: options[0]!, quantity: Number(quantity) }]
    const requested = selections.reduce((sum, line) => sum + line.quantity, 0)
    if (!Number.isInteger(requested) || requested < 1) { toast('份数必须是正整数'); return }
    if (selections.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) { toast('各商品份数须为正整数'); return }
    setJoining(true)
    try {
      const result = await join.join(id, requested, false, note.trim(), selections)
      if (!result.ok) {
        toast(result.error.message)
        if (result.error.code === 'UNAUTHENTICATED') {
          void navigateTo(PAGE_PATHS.profile)
        }
        return
      }

      // 参团成功后就地更新，避免整页重拉
      detail.applyUpdate(result.value.groupBuy)
      toast('参团成功', 'success')

      // 微信特有：一次性订阅「成团提醒」；H5 会返回 UNSUPPORTED，静默忽略
      const subscribed = await requestSubscribeMessage([SUBSCRIBE_TEMPLATES.groupBuyFull])
      if (!subscribed.ok && subscribed.error.code === 'REJECTED') {
        toast('未开启成团提醒，可在小程序设置里重新打开')
      }
    } finally {
      setJoining(false)
    }
  }

  async function handleWithdraw(): Promise<void> {
    if (id === null) return
    const result = await container.useCases.manageGroupBuy.withdraw(id)
    if (!result.ok) { toast(result.error.message); return }
    detail.applyUpdate(result.value)
    setQuantity('1')
    setItemQuantities({})
    setNote('')
    toast('已退出拼单', 'success')
  }

  async function handleCancel(): Promise<void> {
    if (id === null) return
    const confirmed = await Taro.showModal({ title: '取消拼单', content: '取消后同学们将无法继续登记。确定取消吗？' })
    if (!confirmed.confirm) return
    const result = await container.useCases.manageGroupBuy.cancel(id)
    if (!result.ok) { toast(result.error.message); return }
    detail.applyUpdate(result.value)
    toast('拼单已取消', 'success')
  }

  async function handlePublishNotice(): Promise<void> {
    if (id === null || !notice.trim()) { toast('请填写取货通知'); return }
    const result = await container.useCases.manageGroupBuy.publishPickupNotice(id, notice.trim())
    if (!result.ok) { toast(result.error.message); return }
    detail.applyUpdate(result.value)
    toast('取货通知已发布', 'success')
  }

  async function handleMarkReceived(memberId: string, received: boolean): Promise<void> {
    if (id === null) return
    const result = await container.useCases.manageGroupBuy.markReceived(id, memberId, received)
    if (!result.ok) { toast(result.error.message); return }
    detail.applyUpdate(result.value)
    toast(received ? '已标记领取' : '已撤销领取标记', 'success')
  }

  async function copySummary(): Promise<void> {
    if (!state.groupBuy) return
    const order = state.groupBuy
    const quantitySum = order.participants.reduce((sum, member) => sum + member.quantity, 0)
    const options = order.itemOptions?.length ? order.itemOptions : [order.itemSpec || order.title]
    const lines = [
      `【${order.title}】`,
      `总计：${quantitySum}/${order.targetCount} 份`,
      '按商品汇总：',
      ...options.map((item) => `${item} × ${order.participants.reduce((sum, member) => sum + (member.selections?.find((line) => line.item === item)?.quantity ?? (options.length === 1 ? member.quantity : 0)), 0)}`),
      '按成员汇总：',
      ...order.participants.map((member) => `${member.displayName}：${(member.selections ?? [{ item: options[0]!, quantity: member.quantity }]).map((line) => `${line.item} × ${line.quantity}`).join('、')}${member.note ? `（${member.note}）` : ''}`),
      `取货地点：${order.pickupPlace}`,
      '费用请线下自行协商，平台不收款。',
    ]
    try {
      await Taro.setClipboardData({ data: lines.join('\n') })
      toast('采购清单已复制', 'success')
    } catch {
      toast('复制失败，请检查剪贴板权限')
    }
  }

  async function handleShare(): Promise<void> {
    if (state.summary === null) return
    if (container.env.useMock) { toast('当前是本机演示数据，开启真实 API 后可分享给同学'); return }
    const result = await shareToFriend({
      title: state.summary.title,
      path: id === null ? PAGE_PATHS.groupBuyList : groupBuyDetailPath(id),
    })
    if (result.ok) {
      if (result.value === 'clipboard') toast('链接已复制', 'success')
      if (result.value === 'weapp-menu') toast('请点右上角「···」转发给好友')
      return
    }
    toast(result.error.message)
  }

  async function handleOpenMap(): Promise<void> {
    const place = state.summary?.pickupPlace ?? CAMPUS_POINT.name
    const result = await openLocation({ ...CAMPUS_POINT, name: place })
    if (result.ok) {
      if (result.value === 'clipboard') toast('坐标已复制', 'success')
      return
    }
    toast(result.error.message)
  }

  if (state.status === 'loading') {
    return (
      <View className='kdy-page kdy-gb-detail'>
        <KdyEmpty mode='loading' description='正在加载拼单详情' />
      </View>
    )
  }

  if (state.status === 'error' || state.summary === null) {
    return (
      <View className='kdy-page kdy-gb-detail'>
        <KdyEmpty
          mode='error'
          description={state.error ?? '拼单不存在或已被下架'}
          actionText='重试'
          onAction={() => {
            if (id !== null) void detail.load(id)
          }}
        />
      </View>
    )
  }

  const summary = state.summary
  const groupBuy = state.groupBuy
  const mine = groupBuy?.participants.find((participant) => participant.id === profile?.id)
  const isOwner = groupBuy?.initiatorId === profile?.id

  return (
    <View className='kdy-page kdy-gb-detail'>
      <KdyCard
        title={summary.title}
        extra={<KdyTag tone={summary.joinable ? 'brand' : 'neutral'}>{summary.statusLabel}</KdyTag>}
      >
        <View className='kdy-gb-detail__meta'>
          <KdyTag tone='neutral'>{summary.categoryLabel}</KdyTag>
          <KdyTag tone={summary.kind === 'membership' ? 'info' : 'neutral'}>
            {summary.kind === 'membership' ? '会员代购·发起人自述持卡' : '普通拼单'}
          </KdyTag>
          {state.fromCache && <KdyTag tone='info'>本地缓存</KdyTag>}
        </View>

        <View className='kdy-gb-detail__price-row'>
          <Text className='kdy-gb-detail__price'>{summary.itemCount > 1 ? '多商品·线下核价' : summary.priceFen > 0 ? `参考 ¥${fenToYuan(summary.priceFen)}` : '线下商议价格'}</Text>
          <Text className='kdy-gb-detail__price-unit'>/ 份</Text>
        </View>

        <View className='kdy-gb-detail__bar'>
          <View
            className='kdy-gb-detail__bar-inner'
            style={`width: ${summary.progressPercent}%`}
          />
        </View>
        <Text className='kdy-gb-detail__progress-text'>
          {summary.joinedQuantity}/{summary.targetCount} 份（{summary.joinedCount} 人，{summary.progressPercent}%）· 还差{' '}
          {summary.remainingSlots} 份 · {summary.deadlineLabel}
        </Text>

        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>取货地点</Text>
          <Text className='kdy-gb-detail__v'>{summary.pickupPlace}</Text>
        </View>
        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>发起人</Text>
          <Text className='kdy-gb-detail__v'>{summary.initiatorName}</Text>
        </View>
        {summary.merchantName && <View className='kdy-gb-detail__kv'><Text className='kdy-gb-detail__k'>商家</Text><Text className='kdy-gb-detail__v'>{summary.merchantName}</Text></View>}
        {groupBuy?.itemSpec && <View className='kdy-gb-detail__kv'><Text className='kdy-gb-detail__k'>商品规格</Text><Text className='kdy-gb-detail__v'>{groupBuy.itemSpec}</Text></View>}
        <View className='kdy-gb-detail__kv'>
          <Text className='kdy-gb-detail__k'>截止时间</Text>
          <Text className='kdy-gb-detail__v'>{summary.deadline}</Text>
        </View>

        {summary.status === 'cancelled' && <Text className='kdy-gb-detail__description'>{groupBuy?.cancelReason === 'TIMEOUT_24H' ? '创建后 24 小时未成团，已自动取消' : '该拼单已取消'}</Text>}
        {groupBuy?.pickupNotice && <Text className='kdy-gb-detail__description'>取货通知：{groupBuy.pickupNotice}</Text>}

        {groupBuy !== null && (
          <Text className='kdy-gb-detail__description'>{groupBuy.description}</Text>
        )}
      </KdyCard>

      <KdyCard title='已参团同学' elevated={false}>
        {groupBuy === null || groupBuy.participants.length === 0 ? (
          <Text className='kdy-gb-detail__empty-participants'>还没有人参团，你可以是第一个</Text>
        ) : (
          <View>
            {groupBuy.participants.map((participant) => (
              <View key={`${participant.id}-${participant.joinedAt}`} className='kdy-gb-detail__participant'>
                <Text className='kdy-gb-detail__participant-name'>
                  {participant.anonymous ? '匿名同学' : participant.displayName}
                </Text>
                <Text className='kdy-gb-detail__participant-qty'>× {participant.quantity}</Text>
                {participant.selections && participant.selections.length > 1 && <Text className='kdy-gb-detail__participant-qty'>{participant.selections.map((line) => `${line.item} × ${line.quantity}`).join('、')}</Text>}
                {participant.note && <Text className='kdy-gb-detail__participant-qty'>{participant.note}</Text>}
                {participant.receivedAt && <KdyTag tone='success'>已领取</KdyTag>}
                {isOwner && summary.status === 'full' && <KdyButton size='sm' variant='ghost' onClick={() => { void handleMarkReceived(participant.id, !participant.receivedAt) }}>{participant.receivedAt ? '撤销' : '标记领取'}</KdyButton>}
              </View>
            ))}
          </View>
        )}
      </KdyCard>

      {isOwner && summary.status === 'full' && <KdyCard title='发布取货通知'>
        <Input className='kdy-gb-detail__input' value={notice} maxlength={500} placeholder='例如：今晚 19:00 在宿舍楼大厅领取' onInput={(e) => setNotice(e.detail.value)} />
        <KdyButton block variant='primary' onClick={() => { void handlePublishNotice() }}>发布通知</KdyButton>
      </KdyCard>}

      <View className='kdy-gb-detail__actions'>
        {summary.joinable && (
          <View className='kdy-gb-detail__form'>
            {(groupBuy?.itemOptions?.length ?? 0) > 1 ? groupBuy?.itemOptions?.map((item) => <View key={item}>
              <Text>{item}（份）</Text>
              <Input className='kdy-gb-detail__input' type='number' value={itemQuantities[item] ?? ''} placeholder='0' onInput={(e) => setItemQuantities((previous) => ({ ...previous, [item]: e.detail.value }))} />
            </View>) : <View><Text>我的份数（目标按总份数计算）</Text><Input className='kdy-gb-detail__input' type='number' value={quantity} onInput={(e) => setQuantity(e.detail.value)} /></View>}
            <Text>备注（可选）</Text>
            <Input className='kdy-gb-detail__input' value={note} maxlength={200} placeholder='例如：口味、规格' onInput={(e) => setNote(e.detail.value)} />
          </View>
        )}
        <KdyButton
          block
          size='lg'
          variant='primary'
          loading={joining}
          disabled={!summary.joinable}
          onClick={() => {
            void handleJoin()
          }}
        >
          {summary.joinable ? (mine ? '修改我的份数' : '登记参团') : summary.statusLabel}
        </KdyButton>

        {summary.joinable && mine && <KdyButton block variant='ghost' onClick={() => { void handleWithdraw() }}>退出拼单</KdyButton>}
        {summary.joinable && isOwner && <KdyButton block variant='ghost' onClick={() => { void handleCancel() }}>取消我发起的拼单</KdyButton>}
        <KdyButton block variant='ghost' onClick={() => { void copySummary() }}>复制采购汇总</KdyButton>

        <View className='kdy-gb-detail__actions-row'>
          {/* 微信：必须由用户点击 open-type="share" 才会触发转发 */}
          {!container.env.useMock && <KdyButton size='sm' variant='ghost' openType='share'>分享给好友</KdyButton>}
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void handleShare()
            }}
          >
            复制链接
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void handleOpenMap()
            }}
          >
            查看地图
          </KdyButton>
        </View>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台。拼单为同学间自发组织，平台不代收货款。
      </Text>
    </View>
  )
}
