import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import {
  BUDDY_ACTION_LABELS,
  availableBuddyActions,
  buddyActivityBadge,
  buddyActivityLabel,
  buddyRoleLabel,
  buddyStatusLabel,
  buddyViewerRole,
  canJoinBuddy,
  countMembers,
  formatMoment,
} from '../../../../domain/models/buddy'
import type { BuddyAction } from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyReportEntry, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 搭子详情。
 *
 * 这一页的关键差别是「详情 = 小组 + 成员列表」：
 *   · 动作权限函数 `availableBuddyActions()` 需要成员列表才能判定
 *     「我是组长 / 我是成员 / 我能不能加入」；
 *   · 动作成功后用例会重新拉一次详情，成员变化立刻可见；
 *   · 未登录时点击动作先引导登录，而不是发 401。
 *
 * 顺带展示活动类型白名单的说明 —— 与服务端 `BUDDY_ACTIVITIES` 同一份。
 */

const ACTION_VARIANT: Readonly<
  Record<BuddyAction, 'primary' | 'secondary' | 'ghost' | 'danger'>
> = {
  join: 'primary',
  leave: 'ghost',
  close: 'secondary',
  cancel: 'danger',
}

const STATUS_TONES: Readonly<Record<string, KdyTagTone>> = {
  recruiting: 'brand',
  full: 'success',
  closed: 'neutral',
  cancelled: 'danger',
}

export default function BuddyDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const buddy = container.useCases.buddy
  const detail = useStore(buddy.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  useDidShow(() => {
    if (id !== null) void buddy.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少搭子 id，请从列表进入' />
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
          title='没能打开这个搭子'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void buddy.detail.load(id)}
        />
      </View>
    )
  }

  const group = detail.data
  if (group === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='搭子不存在' />
      </View>
    )
  }

  const actions = availableBuddyActions(group, viewerId)
  const join = canJoinBuddy(group, viewerId)
  const role = buddyViewerRole(group, viewerId)
  const joined = countMembers(group.members)

  async function handleAction(action: BuddyAction): Promise<void> {
    if (group === null) return
    if (viewerId === null) {
      toast('请先登录')
      await navigateTo(PAGE_PATHS.authLogin)
      return
    }

    if (action === 'close' || action === 'cancel') {
      const confirmed = await Taro.showModal({
        title: action === 'close' ? '停止招募？' : '取消这个搭子？',
        content:
          action === 'close'
            ? '停止后不再接受新成员，已加入的同学仍可退出。'
            : '取消后无法恢复，所有成员都会看到这个搭子已解散。',
        confirmText: action === 'close' ? '停止招募' : '取消搭子',
      })
      if (!confirmed.confirm) return
    }

    const result =
      action === 'join'
        ? await buddy.join(group.id)
        : action === 'leave'
          ? await buddy.leave(group.id)
          : action === 'close'
            ? await buddy.close(group.id)
            : await buddy.cancel(group.id)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }

    toast(
      action === 'join'
        ? '加入成功，记得按时赴约'
        : action === 'leave'
          ? '已退出搭子'
          : action === 'close'
            ? '已停止招募'
            : '已取消搭子',
      'success',
    )
  }

  return (
    <View className='kdy-page kdy-buddy-detail'>
      <KdyHeading
        title={group.title}
        subtitle={`${buddyActivityLabel(group.activity)} · ${group.campusSpot}`}
        eyebrow='KEDAYA · 找搭子'
      />

      <KdyCard elevated={false}>
        <View className='kdy-buddy-detail__hero'>
          <Text className='kdy-buddy-detail__badge'>{buddyActivityBadge(group.activity)}</Text>
          <View className='kdy-buddy-detail__hero-right'>
            <KdyTag tone={STATUS_TONES[group.status] ?? 'neutral'}>
              {buddyStatusLabel(group.status)}
            </KdyTag>
            <Text className='kdy-buddy-detail__count'>
              已加入 {joined}/{group.capacity} 人
            </Text>
          </View>
        </View>

        <View className='kdy-buddy-detail__rows'>
          <View className='kdy-buddy-detail__row'>
            <Text className='kdy-buddy-detail__k'>集合地点</Text>
            <Text className='kdy-buddy-detail__v'>{group.campusSpot}</Text>
          </View>
          <View className='kdy-buddy-detail__row'>
            <Text className='kdy-buddy-detail__k'>开始时间</Text>
            <Text className='kdy-buddy-detail__v'>{formatMoment(group.startsAt)}</Text>
          </View>
          <View className='kdy-buddy-detail__row'>
            <Text className='kdy-buddy-detail__k'>简介</Text>
            <Text className='kdy-buddy-detail__v'>
              {group.description ?? '组长没有填写简介'}
            </Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title={`成员（${joined}/${group.capacity}）`} elevated={false}>
        {group.members.length === 0 ? (
          <Text className='kdy-buddy-detail__hint'>还没有成员信息。</Text>
        ) : (
          <View className='kdy-buddy-detail__members'>
            {group.members.map((member) => (
              <View key={member.userId} className='kdy-buddy-detail__member'>
                <Text className='kdy-buddy-detail__member-name'>
                  {member.displayName}
                  {viewerId !== null && member.userId === viewerId ? '（我）' : ''}
                </Text>
                <Text className='kdy-buddy-detail__member-role'>
                  {buddyRoleLabel(member.role)} · {formatMoment(member.joinedAt)}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text className='kdy-buddy-detail__hint'>
          {role === 'owner'
            ? '你是组长：招募中可以停止招募；想解散请用「取消招募」（组长不能直接退出）。'
            : role === 'member'
              ? '你已经在这个搭子里，可以随时退出。'
              : group.status === 'recruiting'
                ? join.message
                : '当前状态没有可执行的操作。'}
        </Text>
      </KdyCard>

      {actions.length > 0 && (
        <KdyCard title='可以做什么' elevated={false}>
          <View className='kdy-buddy-detail__actions'>
            {actions.map((action) => (
              <KdyButton
                key={action}
                variant={ACTION_VARIANT[action]}
                loading={detail.mutating}
                onClick={() => void handleAction(action)}
              >
                {BUDDY_ACTION_LABELS[action]}
              </KdyButton>
            ))}
          </View>
        </KdyCard>
      )}

      {actions.length === 0 && (
        <KdyCard elevated={false}>
          <Text className='kdy-buddy-detail__hint'>
            {viewerId === null
              ? '登录后可以加入这个搭子。'
              : '当前身份与搭子状态下没有可执行的操作。'}
          </Text>
          {viewerId === null && (
            <View className='kdy-buddy-detail__actions'>
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

      {detail.error !== null && <Text className='kdy-buddy-detail__error'>{detail.error}</Text>}

      <KdyReportEntry
        targetType='buddy-group'
        targetId={group.id}
        targetTitle={group.title}
        selfOwned={viewerId !== null && group.ownerId === viewerId}
      />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。线下见面请优先选择人多明亮的公共场所。
      </Text>
    </View>
  )
}
