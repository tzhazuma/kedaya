import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import { validateDraft } from '../../../../application/lostFound/lostFoundUseCases'
import {
  LOST_FOUND_ACTION_LABELS,
  availableActions,
  formatHappenedAtInput,
  kindBadge,
  kindLabel,
  parseHappenedAtInput,
  resolveActionLabel,
  resolveDoneLabel,
  statusLabel,
} from '../../../../domain/models/lostFound'
import type { LostFoundAction, LostFoundItem } from '../../../../domain/models/lostFound'
import { navigateTo, redirectTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyField, KdyImageGallery, KdyReportEntry, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 失物招领详情页。
 *
 * 这一页把**领域规则**直接呈现在 UI 上：
 *   · 只渲染 `availableActions()` 允许的动作 —— 别人家的登记不会出现「标记已找回」；
 *   · 未登录时点击动作会引导登录，而不是发一个注定 401 的请求；
 *   · 发布者可以就地改标题/地点/时间/描述（`PATCH`），省掉单独的编辑页；
 *   · 删除前二次确认（微信 `showModal`）。
 */

const ACTION_VARIANT: Readonly<
  Record<LostFoundAction, 'primary' | 'secondary' | 'ghost' | 'danger'>
> = {
  resolve: 'primary',
  reopen: 'secondary',
  edit: 'ghost',
  delete: 'danger',
}

export default function LostFoundDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const lostFound = container.useCases.lostFound
  const detail = useStore(lostFound.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editPlace, setEditPlace] = useState('')
  const [editHappenedAt, setEditHappenedAt] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editContact, setEditContact] = useState('')

  useDidShow(() => {
    if (id !== null) void lostFound.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少信息 id，请从列表进入' />
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
          title='没能打开这条信息'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void lostFound.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='信息不存在' />
      </View>
    )
  }

  // 已经过 null 校验：用非空局部变量，闭包（事件处理）里也能安全取用
  const item: LostFoundItem = detail.data
  const actions = availableActions(item, viewerId)
  const isOwner = viewerId !== null && item.reporterId === viewerId
  const editProblems = validateDraft(
    {
      kind: item.kind,
      title: editTitle,
      description: editDescription,
      place: editPlace,
      happenedAtText: editHappenedAt,
      contactHint: editContact,
    },
    container.clock.now(),
  )

  function startEdit(): void {
    setEditTitle(item.title)
    setEditPlace(item.place)
    setEditHappenedAt(formatHappenedAtInput(new Date(item.happenedAt)))
    setEditDescription(item.description ?? '')
    setEditContact(item.contactHint ?? '')
    setEditing(true)
  }

  async function handleEdit(): Promise<void> {
    const happenedAt = parseHappenedAtInput(editHappenedAt)
    if (happenedAt === null) {
      toast('请按「YYYY-MM-DD HH:mm」填写事发时间', 'error')
      return
    }

    const result = await lostFound.update(item.id, {
      title: editTitle.trim(),
      place: editPlace.trim(),
      happenedAt: happenedAt.toISOString(),
      description: editDescription.trim() === '' ? null : editDescription.trim(),
      contactHint: editContact.trim() === '' ? null : editContact.trim(),
    })
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    setEditing(false)
    toast('已保存', 'success')
  }

  async function handleAction(action: LostFoundAction): Promise<void> {
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
        title: '删除这条信息？',
        content: '删除后无法恢复，且不会再出现在列表里。',
        confirmText: '删除',
      })
      if (!confirmed.confirm) return
      const removed = await lostFound.remove(item.id)
      if (!removed.ok) {
        toast(removed.error.message, 'error')
        return
      }
      toast('已删除', 'success')
      await redirectTo(PAGE_PATHS.lostFoundList)
      return
    }

    const result =
      action === 'resolve' ? await lostFound.resolve(item.id) : await lostFound.reopen(item.id)
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast(action === 'resolve' ? `已标记为${resolveDoneLabel(item.kind)}` : '已重新开放', 'success')
  }

  return (
    <View className='kdy-page kdy-lost-detail'>
      <KdyHeading
        title={item.title}
        subtitle={`${kindLabel(item.kind)} · ${item.place}`}
        eyebrow='KEDAYA · 失物招领'
      />

      <KdyCard elevated={false}>
        <View className='kdy-lost-detail__hero'>
          <Text className='kdy-lost-detail__badge'>{kindBadge(item.kind)}</Text>
          <View className='kdy-lost-detail__status'>
            <KdyTag tone={item.status === 'open' ? 'brand' : 'success'}>
              {statusLabel(item.status)}
            </KdyTag>
            {isOwner ? <KdyTag tone='neutral'>我发布的</KdyTag> : null}
          </View>
        </View>

        {item.imageUrls.length > 0 && (
          <View className='kdy-lost-detail__images'>
            <KdyImageGallery urls={item.imageUrls} />
          </View>
        )}

        <View className='kdy-lost-detail__rows'>
          <View className='kdy-lost-detail__row'>
            <Text className='kdy-lost-detail__k'>类型</Text>
            <Text className='kdy-lost-detail__v'>{kindLabel(item.kind)}</Text>
          </View>
          <View className='kdy-lost-detail__row'>
            <Text className='kdy-lost-detail__k'>地点</Text>
            <Text className='kdy-lost-detail__v'>{item.place}</Text>
          </View>
          <View className='kdy-lost-detail__row'>
            <Text className='kdy-lost-detail__k'>事发时间</Text>
            <Text className='kdy-lost-detail__v'>
              {formatHappenedAtInput(new Date(item.happenedAt))}
            </Text>
          </View>
          <View className='kdy-lost-detail__row'>
            <Text className='kdy-lost-detail__k'>联系方式</Text>
            <Text className='kdy-lost-detail__v'>{item.contactHint ?? '未填写，可先站内私信'}</Text>
          </View>
          <View className='kdy-lost-detail__row'>
            <Text className='kdy-lost-detail__k'>详细描述</Text>
            <Text className='kdy-lost-detail__v'>{item.description ?? '没有填写描述'}</Text>
          </View>
          {item.resolvedAt === null ? null : (
            <View className='kdy-lost-detail__row'>
              <Text className='kdy-lost-detail__k'>{resolveDoneLabel(item.kind)}</Text>
              <Text className='kdy-lost-detail__v'>
                {formatHappenedAtInput(new Date(item.resolvedAt))}
              </Text>
            </View>
          )}
        </View>
      </KdyCard>

      {editing && (
        <KdyCard title='编辑信息' elevated={false}>
          <KdyField label='物品名称' value={editTitle} onChange={setEditTitle} maxLength={60} />
          <KdyField label='地点' value={editPlace} onChange={setEditPlace} maxLength={60} />
          <KdyField
            label='事发时间'
            value={editHappenedAt}
            onChange={setEditHappenedAt}
            placeholder='YYYY-MM-DD HH:mm'
            maxLength={20}
          />
          <KdyField
            label='详细描述'
            value={editDescription}
            onChange={setEditDescription}
            maxLength={2000}
          />
          <KdyField
            label='联系方式提示'
            value={editContact}
            onChange={setEditContact}
            maxLength={60}
          />
          {editProblems.length > 0 && (
            <Text className='kdy-lost-detail__hint'>还需要完善：{editProblems.join('、')}</Text>
          )}
          <View className='kdy-lost-detail__actions'>
            <KdyButton
              loading={detail.mutating}
              disabled={editProblems.length > 0}
              onClick={() => void handleEdit()}
            >
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
          <Text className='kdy-lost-detail__hint'>
            你是发布者：{resolveActionLabel(item.kind)}后信息会标为「已解决」；
            {item.status === 'resolved' ? '重新开放会清空已解决时间。' : '删除后无法恢复。'}
          </Text>
          <View className='kdy-lost-detail__actions'>
            {actions.map((action) => (
              <KdyButton
                key={action}
                variant={ACTION_VARIANT[action]}
                loading={detail.mutating}
                onClick={() => void handleAction(action)}
              >
                {action === 'resolve'
                  ? resolveActionLabel(item.kind)
                  : LOST_FOUND_ACTION_LABELS[action]}
              </KdyButton>
            ))}
          </View>
        </KdyCard>
      )}

      {!editing && actions.length === 0 && (
        <KdyCard elevated={false}>
          <Text className='kdy-lost-detail__hint'>
            {viewerId === null
              ? '登录后可以登记自己的失物 / 招领信息，也能管理已发布的内容。'
              : '这不是你发布的登记，因此不能修改状态；如需更正请联系发布者。'}
          </Text>
          {viewerId === null && (
            <View className='kdy-lost-detail__actions'>
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

      {detail.error !== null && <Text className='kdy-lost-detail__error'>{detail.error}</Text>}

      <KdyReportEntry
        targetType='lost-found-item'
        targetId={item.id}
        targetTitle={item.title}
        selfOwned={viewerId !== null && item.reporterId === viewerId}
      />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。领取前请与失主核对物品细节，谨防冒领。
      </Text>
    </View>
  )
}
