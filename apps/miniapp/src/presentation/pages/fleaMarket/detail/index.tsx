import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { fenToYuan, yuanToFen } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import {
  FLEA_ACTION_LABELS,
  FLEA_CATEGORIES,
  FLEA_CATEGORY_LABELS,
  FLEA_CONDITIONS,
  FLEA_CONDITION_LABELS,
  availableActions,
  canReserve,
  categoryBadge,
  categoryLabel,
  conditionLabel,
  statusLabel,
} from '../../../../domain/models/fleaMarket'
import type { FleaAction } from '../../../../domain/models/fleaMarket'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 闲置详情页。
 *
 * 这一页把**领域规则**直接呈现在 UI 上：
 *   · 只渲染 `availableActions()` 允许的动作 —— 别人家的商品不会出现「标记售出」；
 *   · 未登录时点击动作会引导登录，而不是发一个注定 401 的请求；
 *   · 卖家可以就地改标题/价格/描述（`PATCH`），省掉单独的编辑页；
 *   · 删除前二次确认（微信 `showModal`）。
 */

const ACTION_VARIANT: Readonly<Record<FleaAction, 'primary' | 'secondary' | 'ghost' | 'danger'>> = {
  reserve: 'primary',
  release: 'ghost',
  sold: 'secondary',
  edit: 'ghost',
  delete: 'danger',
}

export default function FleaMarketDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const flea = container.useCases.fleaMarket
  const detail = useStore(flea.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDescription, setEditDescription] = useState('')

  useDidShow(() => {
    if (id !== null) void flea.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少商品 id，请从列表进入' />
      </View>
    )
  }

  if (detail.status === 'loading' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='loading' />
      </View>
    )
  }

  if (detail.status === 'error' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty
          mode='error'
          title='没能打开这件商品'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void flea.detail.load(id)}
        />
      </View>
    )
  }

  const item = detail.data
  if (item === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='商品不存在' />
      </View>
    )
  }

  const actions = availableActions(item, viewerId)
  const reserve = canReserve(item, viewerId)
  const isOwner = viewerId !== null && item.sellerId === viewerId

  function startEdit(): void {
    setEditTitle(item?.title ?? '')
    setEditPrice(item === null ? '' : fenToYuan(item.priceFen))
    setEditDescription(item?.description ?? '')
    setEditing(true)
  }

  async function handleEdit(): Promise<void> {
    const priceFen = editPrice.trim() === '' ? Number.NaN : yuanToFen(editPrice.trim())
    const result = await flea.update(item?.id ?? '', {
      title: editTitle.trim(),
      description: editDescription.trim() === '' ? null : editDescription.trim(),
      priceFen,
    })
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    flea.detail.seed(result.value)
    setEditing(false)
    toast('已保存', 'success')
  }

  async function handleAction(action: FleaAction): Promise<void> {
    if (viewerId === null) {
      toast('请先登录')
      await navigateTo(PAGE_PATHS.authLogin)
      return
    }

    if (action === 'edit') {
      startEdit()
      return
    }

    if (action === 'delete') {
      const confirmed = await Taro.showModal({
        title: '删除这件商品？',
        content: '删除后无法恢复。',
        confirmText: '删除',
      })
      if (!confirmed.confirm) return
      const removed = await flea.remove(item?.id ?? '')
      if (!removed.ok) {
        toast(removed.error.message, 'error')
        return
      }
      toast('已删除', 'success')
      await navigateTo(PAGE_PATHS.fleaList)
      return
    }

    const result =
      action === 'reserve'
        ? await flea.reserve(item?.id ?? '')
        : action === 'release'
          ? await flea.release(item?.id ?? '')
          : await flea.markSold(item?.id ?? '')

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast(action === 'reserve' ? '已预定，尽快联系卖家' : '状态已更新', 'success')
  }

  return (
    <View className='kdy-page kdy-flea-detail'>
      <KdyHeading
        title={item.title}
        subtitle={`${categoryLabel(item.category)} · ${conditionLabel(item.condition)}`}
        eyebrow='KEDAYA · 跳蚤'
      />

      <KdyCard elevated={false}>
        <View className='kdy-flea-detail__hero'>
          <Text className='kdy-flea-detail__badge'>{categoryBadge(item.category)}</Text>
          <View className='kdy-flea-detail__price-row'>
            <Text className='kdy-flea-detail__price'>¥{fenToYuan(item.priceFen)}</Text>
            <KdyTag tone={item.status === 'on-sale' ? 'brand' : item.status === 'reserved' ? 'warning' : 'neutral'}>
              {statusLabel(item.status)}
            </KdyTag>
          </View>
        </View>

        <View className='kdy-flea-detail__rows'>
          <View className='kdy-flea-detail__row'>
            <Text className='kdy-flea-detail__k'>交易地点</Text>
            <Text className='kdy-flea-detail__v'>{item.campusSpot ?? '未约定，可私聊'}</Text>
          </View>
          <View className='kdy-flea-detail__row'>
            <Text className='kdy-flea-detail__k'>成色</Text>
            <Text className='kdy-flea-detail__v'>{conditionLabel(item.condition)}</Text>
          </View>
          <View className='kdy-flea-detail__row'>
            <Text className='kdy-flea-detail__k'>描述</Text>
            <Text className='kdy-flea-detail__v'>{item.description ?? '卖家没有填写描述'}</Text>
          </View>
        </View>
      </KdyCard>

      {editing && (
        <KdyCard title='编辑商品' elevated={false}>
          <KdyField label='标题' value={editTitle} onChange={setEditTitle} maxLength={60} />
          <KdyField label='价格（元）' value={editPrice} onChange={setEditPrice} type='digit' maxLength={10} />
          <KdyField
            label='描述'
            value={editDescription}
            onChange={setEditDescription}
            maxLength={2000}
          />
          <View className='kdy-flea-detail__actions'>
            <KdyButton loading={detail.mutating} onClick={() => void handleEdit()}>
              保存
            </KdyButton>
            <KdyButton variant='ghost' onClick={() => setEditing(false)}>
              取消
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {!editing && actions.length > 0 && (
        <KdyCard title='可以做什么' elevated={false}>
          {actionHint(reserve, isOwner, item.status)}
          <View className='kdy-flea-detail__actions'>
            {actions.map((action) => (
              <KdyButton
                key={action}
                variant={ACTION_VARIANT[action]}
                loading={detail.mutating}
                onClick={() => void handleAction(action)}
              >
                {FLEA_ACTION_LABELS[action]}
              </KdyButton>
            ))}
          </View>
        </KdyCard>
      )}

      {!editing && actions.length === 0 && (
        <KdyCard elevated={false}>
          <Text className='kdy-flea-detail__hint'>
            {viewerId === null
              ? '登录后可以预定这件商品。'
              : item.status === 'sold'
                ? '这件商品已经卖出去啦。'
                : item.sellerId === viewerId
                  ? '这是你发布的商品，当前无可执行操作。'
                  : '当前状态不支持任何操作。'}
          </Text>
          {viewerId === null && (
            <View className='kdy-flea-detail__actions'>
              <KdyButton
                onClick={() => {
                  void navigateTo(PAGE_PATHS.authLogin)
                }}
              >
                去登录
              </KdyButton>
            </View>
          )}
        </KdyCard>
      )}

      {detail.error !== null && <Text className='kdy-flea-detail__error'>{detail.error}</Text>}

      <KdyCard title='分类与成色说明' elevated={false}>
        <View className='kdy-flea-detail__chips'>
          {FLEA_CATEGORIES.slice(0, 4).map((category) => (
            <KdyChip key={category}>{FLEA_CATEGORY_LABELS[category]}</KdyChip>
          ))}
        </View>
        <View className='kdy-flea-detail__chips'>
          {FLEA_CONDITIONS.map((condition) => (
            <KdyChip key={condition} active={condition === item.condition}>
              {FLEA_CONDITION_LABELS[condition]}
            </KdyChip>
          ))}
        </View>
        <Text className='kdy-flea-detail__hint'>
          面交前请再确认物品状态；平台不参与资金往来，因此也没有退款流程。
        </Text>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}

function actionHint(
  reserve: { allowed: boolean; message: string },
  isOwner: boolean,
  status: string,
) {
  if (isOwner) {
    return (
      <Text className='kdy-flea-detail__hint'>
        你是卖家：可以先「标记已售出」或「解除预定」；删除后无法恢复。
      </Text>
    )
  }
  if (!reserve.allowed && status === 'on-sale') {
    return <Text className='kdy-flea-detail__hint'>{reserve.message}</Text>
  }
  return null
}
