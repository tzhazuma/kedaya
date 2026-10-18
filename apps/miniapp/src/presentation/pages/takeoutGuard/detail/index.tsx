import { Text, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import {
  TAKEOUT_GUARD_NOTICE,
  escalateEligibility,
  formatHappenedAtInput,
  resolveEligibility,
  statusLabel,
  statusTimeline,
} from '../../../../domain/models/takeoutGuard'
import type { TakeoutGuardReport, TakeoutGuardStatus } from '../../../../domain/models/takeoutGuard'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyImageGallery, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 偷外卖详情页 —— 这是**只有记录人本人**能打开的一页，因此可以展示完整订单号。
 *
 * 这一页把领域规则直接呈现在 UI 上：
 *   · 详情只有本人可见（非本人 / 不存在，后端一律 404，不泄露"这条记录存在"）；
 *   · 「升级处理」/「标记已解决」两个动作只按 `escalateEligibility` /
 *     `resolveEligibility` 的结果出现，未登录时引导登录而不是发一个注定 401 的请求；
 *   · 动作成功后 `detail.mutate` 会用服务端返回的实体**就地刷新**，页面不写乐观更新。
 *
 * 刻意**不放**举报入口与转发入口：转发出去就等于公开一条可能指向具体同学的记录，
 * 与本模块「只记录、不公开」的定位冲突。
 */

const STEP_CLASS: Readonly<Record<string, string>> = {
  done: 'kdy-tg-detail__step--done',
  current: 'kdy-tg-detail__step--current',
  todo: 'kdy-tg-detail__step--todo',
}

function statusTone(status: TakeoutGuardStatus): KdyTagTone {
  if (status === 'resolved') return 'success'
  if (status === 'escalated') return 'brand'
  return 'warning'
}

export default function TakeoutGuardDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const takeoutGuard = container.useCases.takeoutGuard
  const detail = useStore(takeoutGuard.detail)
  const session = useStore(container.useCases.session)
  const viewerId = session.profile?.id ?? null

  useDidShow(() => {
    if (id !== null) void takeoutGuard.detail.load(id)
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
          title='没能打开这条记录'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void takeoutGuard.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='记录不存在' />
      </View>
    )
  }

  // 已经过 null 校验：用非空局部变量，闭包（事件处理）里也能安全取用
  const item: TakeoutGuardReport = detail.data
  const timeline = statusTimeline(item.status)
  const escalate = escalateEligibility(item, viewerId)
  const resolve = resolveEligibility(item, viewerId)
  const evidence =
    item.evidenceUrl === null || item.evidenceUrl === '' ? [] : [item.evidenceUrl]

  async function runAction(kind: 'escalate' | 'resolve'): Promise<void> {
    if (viewerId === null) {
      toast('请先登录')
      await navigateTo(PAGE_PATHS.authLogin)
      return
    }

    const eligibility = kind === 'escalate' ? escalate : resolve
    if (!eligibility.allowed) {
      toast(eligibility.message)
      return
    }

    const result =
      kind === 'escalate' ? await takeoutGuard.escalate(item.id) : await takeoutGuard.resolve(item.id)
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast(kind === 'escalate' ? '已升级处理' : '已标记为已解决', 'success')
  }

  return (
    <View className='kdy-page kdy-tg-detail'>
      <KdyHeading
        title={item.place}
        subtitle='只有你自己能看到这条记录'
      />

      <KdyCard elevated={false}>
        <View className='kdy-tg-detail__hero'>
          <KdyTag tone={statusTone(item.status as TakeoutGuardStatus)}>{statusLabel(item.status)}</KdyTag>
          <Text className='kdy-tg-detail__hero-time'>
            记录于 {formatHappenedAtInput(new Date(item.createdAt))}
          </Text>
        </View>

        {evidence.length > 0 && (
          <View className='kdy-tg-detail__images'>
            <KdyImageGallery urls={evidence} />
          </View>
        )}

        <View className='kdy-tg-detail__rows'>
          <View className='kdy-tg-detail__row'>
            <Text className='kdy-tg-detail__k'>取餐点</Text>
            <Text className='kdy-tg-detail__v'>{item.place}</Text>
          </View>
          <View className='kdy-tg-detail__row'>
            <Text className='kdy-tg-detail__k'>发生时间</Text>
            <Text className='kdy-tg-detail__v'>
              {formatHappenedAtInput(new Date(item.happenedAt))}
            </Text>
          </View>
          <View className='kdy-tg-detail__row'>
            <Text className='kdy-tg-detail__k'>订单号</Text>
            <Text className='kdy-tg-detail__v'>{item.orderNo}</Text>
          </View>
          <View className='kdy-tg-detail__row'>
            <Text className='kdy-tg-detail__k'>经过</Text>
            <Text className='kdy-tg-detail__v'>{item.detail ?? '没有填写经过'}</Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title='处理进度' elevated={false}>
        <View className='kdy-tg-detail__timeline'>
          {timeline.map((step) => (
            <View key={step.id} className={`kdy-tg-detail__step ${STEP_CLASS[step.state] ?? ''}`}>
              <Text className='kdy-tg-detail__step-label'>{step.label}</Text>
              <Text className='kdy-tg-detail__step-desc'>{step.description}</Text>
            </View>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='可以做什么' elevated={false}>
        <Text className='kdy-tg-detail__hint'>
          升级处理只是请平台或辅导员帮忙沟通，不会公开这条记录；标记已解决用于对方已归还、
          或者事情已经说清楚的情况。
        </Text>
        <View className='kdy-tg-detail__actions'>
          <KdyButton
            variant='secondary'
            loading={detail.mutating}
            disabled={!escalate.allowed}
            onClick={() => void runAction('escalate')}
          >
            升级处理
          </KdyButton>
          <KdyButton
            loading={detail.mutating}
            disabled={!resolve.allowed}
            onClick={() => void runAction('resolve')}
          >
            标记已解决
          </KdyButton>
        </View>
        {viewerId === null ? (
          <View className='kdy-tg-detail__actions'>
            <KdyButton
              variant='ghost'
              onClick={() => {
                void navigateTo(PAGE_PATHS.authLogin)
              }}
            >
              去登录
            </KdyButton>
          </View>
        ) : null}
      </KdyCard>

      <Text className='kdy-tg-detail__notice'>{TAKEOUT_GUARD_NOTICE}</Text>

      {detail.error !== null && <Text className='kdy-tg-detail__error'>{detail.error}</Text>}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。请勿公开点名或在群里扩散他人信息。
      </Text>
    </View>
  )
}
