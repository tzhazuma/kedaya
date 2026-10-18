import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam } from '../../../../app/routes'
import {
  CRISIS_FALLBACK,
  CRISIS_FALLBACK_NOTICE,
  WELLBEING_BOUNDARY_NOTICE,
  WELLBEING_CONSENT_POINTS,
  WELLBEING_CONSENT_TITLE,
  WELLBEING_PLATFORM_DISCLAIMER,
  cancellable,
  formatSlotAtInput,
  isDialable,
  modeLabel,
  statusLabel,
  statusTimeline,
} from '../../../../domain/models/wellbeing'
import type {
  WellbeingAppointment,
  WellbeingCrisisLine,
  WellbeingStatus,
} from '../../../../domain/models/wellbeing'
import { makePhoneCall } from '../../../../platform/dialer'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 心理支持详情页 —— 只有本人能打开（非本人 / 不存在，后端一律 404，不泄露"存在"）。
 *
 * 与列表页一样，这里也**自带危机出口与同意门**：详情页可能被深链直接打开
 * （冷启动时本地留痕为空），如果它自己不过这两道门，就会出现"有数据接口
 * 但没有同意入口"的死路。所以：
 *   · 危机卡片（公开数据，`data ?? CRISIS_FALLBACK`）永远在顶部；
 *   · 同意门没通过之前，不请求任何预约字段；
 *   · 「取消预约」只按 `cancellable()` 的结果出现，未登录引导登录，
 *     不用"发一个注定 409 的请求"来试探。
 *
 * 刻意**不放**举报入口与转发入口：预约内容可能指向具体的人，转发或"举报"
 * 都是错的用法。
 */

const STEP_CLASS: Readonly<Record<string, string>> = {
  done: 'kdy-wb-detail__step--done',
  current: 'kdy-wb-detail__step--current',
  todo: 'kdy-wb-detail__step--todo',
}

function statusTone(status: WellbeingStatus): KdyTagTone {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'neutral'
  if (status === 'confirmed') return 'brand'
  return 'warning'
}

/** 危机出口卡片：醒目但克制（浅底 + 左侧一道暖色，不用大面积红） */
function CrisisCard({ line, stale }: { line: WellbeingCrisisLine; stale: boolean }) {
  async function dial(number: string): Promise<void> {
    const result = await makePhoneCall(number)
    // 用户自己点「取消」不是错误，静默即可；其余情况必须给反馈 ——「点了没反应」在危机卡上最糟
    if (!result.ok && result.error.code !== 'REJECTED') {
      toast('没能拉起拨号，请手动拨打', 'error')
    }
  }

  return (
    <KdyCard
      className='kdy-wb-crisis'
      elevated={false}
      title={line.title}
      extra={<KdyTag tone='danger'>紧急</KdyTag>}
    >
      <Text className='kdy-wb-crisis__message'>{line.message}</Text>

      <View className='kdy-wb-crisis__hotlines'>
        {line.hotlines.map((hotline) => (
          <View key={`${hotline.name}-${hotline.number}`} className='kdy-wb-crisis__hotline'>
            <View className='kdy-wb-crisis__hotline-text'>
              <Text className='kdy-wb-crisis__name'>{hotline.name}</Text>
              <Text className='kdy-wb-crisis__number'>{hotline.number}</Text>
            </View>
            {isDialable(hotline.number) ? (
              <KdyButton size='sm' onClick={() => void dial(hotline.number)}>
                拨打
              </KdyButton>
            ) : null}
          </View>
        ))}
      </View>

      {line.channels.length > 0 && (
        <View className='kdy-wb-crisis__channels'>
          {line.channels.map((channel) => (
            <View key={channel.name} className='kdy-wb-crisis__channel'>
              <Text className='kdy-wb-crisis__name'>{channel.name}</Text>
              <Text className='kdy-wb-crisis__instruction'>{channel.instruction}</Text>
            </View>
          ))}
        </View>
      )}

      {stale && <Text className='kdy-wb-crisis__stale'>{CRISIS_FALLBACK_NOTICE}</Text>}
    </KdyCard>
  )
}

export default function WellbeingDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const wellbeing = container.useCases.wellbeing
  const detail = useStore(wellbeing.detail)
  const crisis = useStore(wellbeing.crisis)
  const session = useStore(container.useCases.session)
  const loggedIn = session.tokens !== null
  const viewerId = session.profile?.id ?? null

  const [checkingConsent, setCheckingConsent] = useState(true)
  const [consentNeeded, setConsentNeeded] = useState(true)
  const [accepting, setAccepting] = useState(false)

  const crisisLine = crisis.data ?? CRISIS_FALLBACK
  const crisisStale = crisis.data === null

  async function refreshConsent(): Promise<void> {
    if (container.useCases.session.getSnapshot().tokens === null) {
      setConsentNeeded(true)
      setCheckingConsent(false)
      return
    }
    setCheckingConsent(true)
    const needed = await wellbeing.needsConsent()
    setConsentNeeded(needed)
    setCheckingConsent(false)
    if (!needed && id !== null) void wellbeing.detail.load(id)
  }

  async function handleAcceptConsent(): Promise<void> {
    if (accepting) return
    setAccepting(true)
    const result = await wellbeing.acceptConsent()
    setAccepting(false)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    setConsentNeeded(false)
    if (id !== null) void wellbeing.detail.load(id)
  }

  useDidShow(() => {
    void wellbeing.crisis.load('crisis-line')
    void refreshConsent()
  })

  async function handleCancel(item: WellbeingAppointment): Promise<void> {
    if (viewerId === null) {
      toast('请先登录')
      void navigateTo(PAGE_PATHS.authLogin)
      return
    }
    const eligibility = cancellable(item, viewerId)
    if (!eligibility.allowed) {
      toast(eligibility.message)
      return
    }

    const confirmed = await Taro.showModal({
      title: '取消这次预约？',
      content: '取消之后可以重新预约；这次的时间会释放给其他同学。',
      confirmText: '取消预约',
      cancelText: '再想想',
    })
    if (!confirmed.confirm) return

    const result = await wellbeing.cancel(item.id)
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast('已取消这次预约', 'success')
  }

  const consentCard = (
    <KdyCard title={WELLBEING_CONSENT_TITLE} extra={<KdyTag tone='danger'>高敏感</KdyTag>}>
      {WELLBEING_CONSENT_POINTS.map((point) => (
        <Text key={point} className='kdy-wb-detail__li'>
          · {point}
        </Text>
      ))}
      <View className='kdy-wb-detail__actions'>
        <KdyButton block loading={accepting} onClick={() => void handleAcceptConsent()}>
          我已阅读并同意
        </KdyButton>
      </View>
    </KdyCard>
  )

  let body: ReactNode
  if (id === null) {
    body = <KdyEmpty mode='error' title='链接不对' description='缺少预约 id，请从列表进入' />
  } else if (!loggedIn) {
    body = (
      <KdyEmpty
        mode='empty'
        title='登录后才能查看这条预约'
        description='预约与摘要只有你和中心值班老师能看到。'
        actionText='去登录'
        onAction={() => {
          void navigateTo(PAGE_PATHS.authLogin)
        }}
      />
    )
  } else if (checkingConsent) {
    body = <KdyEmpty mode='loading' />
  } else if (consentNeeded) {
    body = consentCard
  } else if (detail.status === 'loading' && detail.data === null) {
    body = <KdyEmpty mode='loading' />
  } else if (detail.status === 'error' && detail.data === null) {
    body = (
      <KdyEmpty
        mode='error'
        title='没能打开这条预约'
        description={detail.error ?? '请稍后重试'}
        actionText='重试'
        onAction={() => void wellbeing.detail.load(id)}
      />
    )
  } else if (detail.data === null) {
    body = <KdyEmpty mode='empty' title='预约不存在' />
  } else {
    const item = detail.data
    const timeline = statusTimeline(item.status)
    const canCancel = cancellable(item, viewerId)

    body = (
      <>
        <KdyCard elevated={false}>
          <View className='kdy-wb-detail__hero'>
            <KdyTag tone={statusTone(item.status as WellbeingStatus)}>
              {statusLabel(item.status)}
            </KdyTag>
            <Text className='kdy-wb-detail__hero-time'>
              提交于 {formatSlotAtInput(new Date(item.createdAt))}
            </Text>
          </View>

          <View className='kdy-wb-detail__rows'>
            <View className='kdy-wb-detail__row'>
              <Text className='kdy-wb-detail__k'>老师 / 咨询师</Text>
              <Text className='kdy-wb-detail__v'>{item.counselor}</Text>
            </View>
            <View className='kdy-wb-detail__row'>
              <Text className='kdy-wb-detail__k'>预约时间</Text>
              <Text className='kdy-wb-detail__v'>{formatSlotAtInput(new Date(item.slotAt))}</Text>
            </View>
            <View className='kdy-wb-detail__row'>
              <Text className='kdy-wb-detail__k'>方式</Text>
              <Text className='kdy-wb-detail__v'>{modeLabel(item.mode)}</Text>
            </View>
            <View className='kdy-wb-detail__row'>
              <Text className='kdy-wb-detail__k'>想聊的</Text>
              <Text className='kdy-wb-detail__v'>{item.note ?? '没有填写'}</Text>
            </View>
          </View>

          {item.crisisFlag ? (
            <Text className='kdy-wb-detail__flag'>
              这条预约曾触发过紧急联系渠道；如果需要，上面的热线一直有效。
            </Text>
          ) : null}
        </KdyCard>

        <KdyCard title='进度' elevated={false}>
          {item.status === 'cancelled' ? (
            <Text className='kdy-wb-detail__cancelled'>这次预约已取消。需要时可以重新预约。</Text>
          ) : null}
          <View className='kdy-wb-detail__timeline'>
            {timeline.map((step) => (
              <View
                key={step.id}
                className={`kdy-wb-detail__step ${STEP_CLASS[step.state] ?? ''}`}
              >
                <Text className='kdy-wb-detail__step-label'>{step.label}</Text>
                <Text className='kdy-wb-detail__step-desc'>{step.description}</Text>
              </View>
            ))}
          </View>
        </KdyCard>

        <KdyCard title='可以做什么' elevated={false}>
          <Text className='kdy-wb-detail__hint'>
            想换个时间或方式，可以直接联系中心值班老师；不想去了就在下面取消，把时间让给别的同学。
          </Text>
          <View className='kdy-wb-detail__actions'>
            <KdyButton
              variant='danger'
              loading={detail.mutating}
              disabled={!canCancel.allowed}
              onClick={() => void handleCancel(item)}
            >
              取消预约
            </KdyButton>
            {viewerId === null ? (
              <KdyButton
                variant='ghost'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.authLogin)
                }}
              >
                去登录
              </KdyButton>
            ) : null}
          </View>
          {!canCancel.allowed && canCancel.message !== '' ? (
            <Text className='kdy-wb-detail__hint'>{canCancel.message}</Text>
          ) : null}
        </KdyCard>

        {detail.error !== null && <Text className='kdy-wb-detail__error'>{detail.error}</Text>}
      </>
    )
  }

  return (
    <View className='kdy-page kdy-wb-detail'>
      <KdyHeading
        title='预约详情'
        subtitle='只有你和中心值班老师能看到这一页。'
      />

      <CrisisCard line={crisisLine} stale={crisisStale} />

      <Text className='kdy-wb-detail__boundary'>{WELLBEING_BOUNDARY_NOTICE}</Text>

      {body}

      <Text className='kdy-disclaimer'>{WELLBEING_PLATFORM_DISCLAIMER}</Text>
    </View>
  )
}
