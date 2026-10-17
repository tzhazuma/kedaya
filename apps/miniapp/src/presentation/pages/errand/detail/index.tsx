import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useShareAppMessage, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { fenToYuan, yuanToFen } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam, errandDetailPath } from '../../../../app/routes'
import {
  hoursFromNowIso,
  resolveErrandDeadline,
  validateErrandDraft,
} from '../../../../application/errand/errandUseCases'
import {
  ERRAND_ACTION_LABELS,
  ERRAND_DEADLINE_PRESETS,
  availableErrandActions,
  canAcceptErrand,
  errandStatusLabel,
  errandViewerRole,
  formatMoment,
} from '../../../../domain/models/errand'
import type { ErrandAction, UpdateErrandTaskInput } from '../../../../domain/models/errand'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyReportEntry, KdyShareEntry, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 跑腿任务详情。
 *
 * 这一页把**领域规则**直接呈现在 UI 上：
 *   · 只渲染 `availableErrandActions()` 允许的动作 —— 路人看不到「确认完成」；
 *   · 未登录时点击动作先引导登录，而不是发一个注定 401 的请求；
 *   · 发布者可以就地改标题 / 赏金 / 地点 / 截止时间（`PATCH`），
 *     截止时间留「不修改」选项，对应后端的可选字段语义；
 *   · 删除前二次确认（微信 `showModal`）。
 */

const ACTION_VARIANT: Readonly<
  Record<ErrandAction, 'primary' | 'secondary' | 'ghost' | 'danger'>
> = {
  accept: 'primary',
  deliver: 'primary',
  complete: 'primary',
  cancel: 'ghost',
  edit: 'ghost',
  delete: 'danger',
}

const STATUS_TONES: Readonly<Record<string, KdyTagTone>> = {
  open: 'brand',
  accepted: 'info',
  delivered: 'warning',
  completed: 'success',
  cancelled: 'neutral',
}

const KEEP_DEADLINE = 'keep'

export default function ErrandDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const errand = container.useCases.errand
  const detail = useStore(errand.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDetail, setEditDetail] = useState('')
  const [editReward, setEditReward] = useState('')
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editPresetId, setEditPresetId] = useState<string>(KEEP_DEADLINE)
  const [editUseCustom, setEditUseCustom] = useState(false)
  const [editCustomHours, setEditCustomHours] = useState('')

  useDidShow(() => {
    if (id !== null) void errand.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少任务 id，请从列表进入' />
      </View>
    )
  }

  /**
   * 分享给好友。
   *
   * 微信的硬性约束：转发**只能**由用户点击 `open-type="share"` 触发（组件是
   * 页面底部的 `<KdyShareEntry />`），代码不能静默分享。这里只负责
   * 「转发出去的标题 + 落地路径」。
   *
   * 落地路径**带上 id**：好友点开看到的就是这一条，
   * 而不是被丢回列表里再找一遍。
   */
  useShareAppMessage(() => ({
    title: detail.data === null ? '可达鸭 · 跑腿互助' : `【求助】${detail.data.title} · 可达鸭`,
    path: id === null ? PAGE_PATHS.errandList : errandDetailPath(id),
  }))

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
          title='没能打开这条任务'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void errand.detail.load(id)}
        />
      </View>
    )
  }

  const task = detail.data
  if (task === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='任务不存在' />
      </View>
    )
  }

  const actions = availableErrandActions(task, viewerId)
  const role = errandViewerRole(task, viewerId)
  const accept = canAcceptErrand(task, viewerId)

  function startEdit(): void {
    if (task === null) return
    setEditTitle(task.title)
    setEditDetail(task.detail ?? '')
    setEditReward(fenToYuan(task.rewardFen))
    setEditFrom(task.fromPlace)
    setEditTo(task.toPlace)
    setEditPresetId(KEEP_DEADLINE)
    setEditUseCustom(false)
    setEditCustomHours('')
    setEditing(true)
  }

  async function handleEdit(): Promise<void> {
    if (task === null || saving) return
    const now = container.clock.now()
    const rewardFen = editReward.trim() === '' ? Number.NaN : yuanToFen(editReward.trim())

    const patch: UpdateErrandTaskInput = {
      title: editTitle.trim(),
      detail: editDetail.trim() === '' ? null : editDetail.trim(),
      rewardFen,
      fromPlace: editFrom.trim(),
      toPlace: editTo.trim(),
    }

    let deadlineIso = task.deadline
    if (editPresetId !== KEEP_DEADLINE) {
      deadlineIso = editUseCustom
        ? (hoursFromNowIso(now, editCustomHours) ?? '')
        : resolveErrandDeadline(now, editPresetId).iso
      patch.deadline = deadlineIso
    }

    const problems = validateErrandDraft(
      {
        title: editTitle,
        detail: editDetail,
        rewardFen,
        fromPlace: editFrom,
        toPlace: editTo,
        deadlineIso: deadlineIso === '' ? null : deadlineIso,
      },
      now,
    )
    if (problems.length > 0) {
      toast(problems[0] ?? '请检查填写内容', 'error')
      return
    }

    setSaving(true)
    const result = await errand.update(task.id, patch)
    setSaving(false)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    errand.detail.seed(result.value)
    setEditing(false)
    toast('已保存', 'success')
  }

  async function handleAction(action: ErrandAction): Promise<void> {
    if (task === null) return
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
        title: '删除这条任务？',
        content: '删除后无法恢复。',
        confirmText: '删除',
      })
      if (!confirmed.confirm) return
      const removed = await errand.remove(task.id)
      if (!removed.ok) {
        toast(removed.error.message, 'error')
        return
      }
      toast('已删除', 'success')
      await navigateTo(PAGE_PATHS.errandList)
      return
    }

    const result =
      action === 'accept'
        ? await errand.accept(task.id)
        : action === 'deliver'
          ? await errand.deliver(task.id)
          : action === 'complete'
            ? await errand.complete(task.id)
            : await errand.cancel(task.id)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast(
      action === 'accept'
        ? '接单成功，记得按时送达'
        : action === 'deliver'
          ? '已标记送达，等待发布者确认'
          : action === 'complete'
            ? '任务已完成'
            : '任务已取消',
      'success',
    )
  }

  return (
    <View className='kdy-page kdy-errand-detail'>
      <KdyHeading
        title={task.title}
        subtitle={`${task.fromPlace} → ${task.toPlace}`}
      />

      <KdyCard elevated={false}>
        <View className='kdy-errand-detail__hero'>
          <View className='kdy-errand-detail__reward-box'>
            <Text className='kdy-errand-detail__reward-label'>悬赏</Text>
            <Text className='kdy-errand-detail__reward'>¥{fenToYuan(task.rewardFen)}</Text>
          </View>
          <KdyTag tone={STATUS_TONES[task.status] ?? 'neutral'}>
            {errandStatusLabel(task.status)}
          </KdyTag>
        </View>

        <View className='kdy-errand-detail__rows'>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>出发地</Text>
            <Text className='kdy-errand-detail__v'>{task.fromPlace}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>目的地</Text>
            <Text className='kdy-errand-detail__v'>{task.toPlace}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>截止时间</Text>
            <Text className='kdy-errand-detail__v'>{formatMoment(task.deadline)}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>任务明细</Text>
            <Text className='kdy-errand-detail__v'>{task.detail ?? '发布者没有填写明细'}</Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title='进度' elevated={false}>
        <View className='kdy-errand-detail__rows'>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>发布</Text>
            <Text className='kdy-errand-detail__v'>{formatMoment(task.createdAt)}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>接单</Text>
            <Text className='kdy-errand-detail__v'>{formatMoment(task.acceptedAt)}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>送达</Text>
            <Text className='kdy-errand-detail__v'>{formatMoment(task.deliveredAt)}</Text>
          </View>
          <View className='kdy-errand-detail__row'>
            <Text className='kdy-errand-detail__k'>完成</Text>
            <Text className='kdy-errand-detail__v'>{formatMoment(task.settledAt)}</Text>
          </View>
        </View>
        <Text className='kdy-errand-detail__hint'>
          {role === 'requester'
            ? '你是发布者：接单者送达后，请确认完成；未结束前可以编辑或取消。'
            : role === 'runner'
              ? task.status === 'accepted'
                ? '你是接单者：送达后请点「确认送达」，由发布者确认完成。'
                : '你是接单者：当前状态没有可执行的操作。'
              : task.status === 'open'
                ? accept.message
                : '当前状态没有可执行的操作。'}
        </Text>
      </KdyCard>

      {editing && (
        <KdyCard title='编辑任务' elevated={false}>
          <KdyField label='标题' value={editTitle} onChange={setEditTitle} maxLength={60} />
          <KdyField label='明细' value={editDetail} onChange={setEditDetail} maxLength={2000} />
          <KdyField
            label='悬赏（元）'
            value={editReward}
            onChange={setEditReward}
            type='digit'
            maxLength={10}
          />
          <KdyField label='出发地' value={editFrom} onChange={setEditFrom} maxLength={60} />
          <KdyField label='目的地' value={editTo} onChange={setEditTo} maxLength={60} />

          <Text className='kdy-errand-detail__hint'>截止时间</Text>
          <View className='kdy-errand-detail__chips'>
            <KdyChip
              active={editPresetId === KEEP_DEADLINE}
              onClick={() => {
                setEditPresetId(KEEP_DEADLINE)
                setEditUseCustom(false)
              }}
            >
              不修改（{formatMoment(task.deadline)}）
            </KdyChip>
            {ERRAND_DEADLINE_PRESETS.map((preset) => (
              <KdyChip
                key={preset.id}
                active={editPresetId === preset.id}
                onClick={() => {
                  setEditUseCustom(false)
                  setEditPresetId(preset.id)
                }}
              >
                {preset.label}
              </KdyChip>
            ))}
            <KdyChip
              active={editUseCustom}
              onClick={() => {
                setEditUseCustom(true)
                setEditPresetId('custom')
              }}
            >
              自定义
            </KdyChip>
          </View>

          {editUseCustom && (
            <KdyField
              label='多少小时后'
              value={editCustomHours}
              onChange={setEditCustomHours}
              placeholder='例如 4.5'
              type='digit'
              maxLength={6}
            />
          )}

          <View className='kdy-errand-detail__actions'>
            <KdyButton loading={saving} onClick={() => void handleEdit()}>
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
          <View className='kdy-errand-detail__actions'>
            {actions.map((action) => (
              <KdyButton
                key={action}
                variant={ACTION_VARIANT[action]}
                loading={detail.mutating}
                onClick={() => void handleAction(action)}
              >
                {ERRAND_ACTION_LABELS[action]}
              </KdyButton>
            ))}
          </View>
        </KdyCard>
      )}

      {!editing && actions.length === 0 && (
        <KdyCard elevated={false}>
          <Text className='kdy-errand-detail__hint'>
            {viewerId === null
              ? '登录后可以接单，或发布你自己的求助。'
              : '当前身份与任务状态下没有可执行的操作。'}
          </Text>
          {viewerId === null && (
            <View className='kdy-errand-detail__actions'>
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

      {detail.error !== null && <Text className='kdy-errand-detail__error'>{detail.error}</Text>}

      <KdyShareEntry />

      <KdyReportEntry
        targetType='errand-task'
        targetId={task.id}
        targetTitle={task.title}
        selfOwned={viewerId !== null && task.requesterId === viewerId}
      />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。悬赏由同学间自行结算，平台不参与资金往来。
      </Text>
    </View>
  )
}
