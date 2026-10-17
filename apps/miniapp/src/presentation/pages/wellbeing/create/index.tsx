import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { validateDraft } from '../../../../application/wellbeing/wellbeingUseCases'
import type { WellbeingDraft } from '../../../../application/wellbeing/wellbeingUseCases'
import {
  CRISIS_FALLBACK,
  CRISIS_FALLBACK_NOTICE,
  WELLBEING_BOUNDARY_NOTICE,
  WELLBEING_CONSENT_POINTS,
  WELLBEING_CONSENT_TITLE,
  WELLBEING_COUNSELOR_MAX,
  WELLBEING_DEFAULT_MODE,
  WELLBEING_MODES,
  WELLBEING_MODE_LABELS,
  WELLBEING_NOTE_HINT,
  WELLBEING_NOTE_MAX,
  WELLBEING_PLATFORM_DISCLAIMER,
  formatSlotAtInput,
  isDialable,
} from '../../../../domain/models/wellbeing'
import type { WellbeingCrisisLine, WellbeingMode } from '../../../../domain/models/wellbeing'
import { needsConsent } from '../../../../domain/ports/errors'
import { makePhoneCall } from '../../../../platform/dialer'
import { navigateBack, navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 预约一次「心理支持」。
 *
 * 三条纪律（都来自后端领域规则）：
 *   · **归属只能是自己**：服务端从 JWT 取 `userId`，客户端连这个字段都不发；
 *   · **状态一律 requested**：不能通过请求体写 status；
 *   · **预约时间不能是已经过去的时间**（5 分钟时钟偏差），因此表单收文本、
 *     提交前解析，先用同一套规则提示，不用"发一个注定 400 的请求"来试探。
 *
 * 摘要**选填**：最小化采集，不写姓名/学号，也不写别人的隐私。
 * 这一页同样自带危机出口与同意门：填表的人可能正在难受，热线必须就近可见。
 */

/** 默认预约时间：明天整点（用户可改），避免一进来就是一个"已经过去"的时间 */
function defaultSlotText(now: Date): string {
  const target = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  target.setMinutes(0, 0, 0)
  return formatSlotAtInput(target)
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

export default function WellbeingCreatePage() {
  const container = getContainer()
  const wellbeing = container.useCases.wellbeing
  const crisis = useStore(wellbeing.crisis)
  const session = useStore(container.useCases.session)
  const loggedIn = session.tokens !== null

  const [checkingConsent, setCheckingConsent] = useState(true)
  const [consentNeeded, setConsentNeeded] = useState(true)
  const [accepting, setAccepting] = useState(false)

  const [counselor, setCounselor] = useState('')
  const [slotAtText, setSlotAtText] = useState(() => defaultSlotText(container.clock.now()))
  const [mode, setMode] = useState<WellbeingMode>(WELLBEING_DEFAULT_MODE)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const crisisLine = crisis.data ?? CRISIS_FALLBACK
  const crisisStale = crisis.data === null

  const draft: WellbeingDraft = { counselor, slotAtText, mode, note }
  const problems = validateDraft(draft, container.clock.now())

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
  }

  function applyPreset(hoursAhead: number): void {
    // 用容器时钟：mock 模式下与 mock 仓储同一时钟，不会互相矛盾
    const target = new Date(container.clock.now().getTime() + hoursAhead * 60 * 60 * 1000)
    target.setMinutes(0, 0, 0)
    setSlotAtText(formatSlotAtInput(target))
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await wellbeing.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      // 服务端明确要求同意：把同意门重新摆到用户面前，而不是只显示一行错误
      if (needsConsent(result.error.code)) setConsentNeeded(true)
      setError(result.error.message)
      return
    }
    toast('已提交，等中心确认时间', 'success')
    void navigateBack()
  }

  useDidShow(() => {
    void wellbeing.crisis.load('crisis-line')
    void refreshConsent()
  })

  const consentCard = (
    <KdyCard title={WELLBEING_CONSENT_TITLE} extra={<KdyTag tone='danger'>高敏感</KdyTag>}>
      {WELLBEING_CONSENT_POINTS.map((point) => (
        <Text key={point} className='kdy-wb-create__li'>
          · {point}
        </Text>
      ))}
      <View className='kdy-wb-create__actions'>
        <KdyButton block loading={accepting} onClick={() => void handleAcceptConsent()}>
          我已阅读并同意
        </KdyButton>
      </View>
    </KdyCard>
  )

  let body: ReactNode
  if (!loggedIn) {
    body = (
      <KdyEmpty
        mode='empty'
        title='登录后才能预约'
        description='预约只存在你自己的账号里，只有你和中心值班老师能看到。'
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
  } else {
    body = (
      <>
        <KdyCard title='想约谁' elevated={false}>
          <KdyField
            label='老师 / 咨询师'
            value={counselor}
            onChange={setCounselor}
            placeholder='例如：李老师'
            maxLength={WELLBEING_COUNSELOR_MAX}
            hint='不清楚可以填「中心值班老师（不限）」，由中心安排'
          />
        </KdyCard>

        <KdyCard title='时间与方式' elevated={false}>
          <KdyField
            label='预约时间'
            value={slotAtText}
            onChange={setSlotAtText}
            placeholder='YYYY-MM-DD HH:mm'
            maxLength={20}
            hint='按本地时间填写，支持 2026-11-05 10:00 或 2026/11/05 10:00'
          />
          <View className='kdy-wb-create__chips'>
            <KdyChip onClick={() => applyPreset(3)}>今天晚些</KdyChip>
            <KdyChip onClick={() => applyPreset(24)}>明天此时</KdyChip>
            <KdyChip onClick={() => applyPreset(24 * 7)}>一周后</KdyChip>
          </View>

          <Text className='kdy-wb-create__label'>方式</Text>
          <View className='kdy-wb-create__chips'>
            {WELLBEING_MODES.map((item) => (
              <KdyChip key={item} active={mode === item} onClick={() => setMode(item)}>
                {WELLBEING_MODE_LABELS[item]}
              </KdyChip>
            ))}
          </View>
        </KdyCard>

        <KdyCard title='想聊的（选填）' elevated={false}>
          <KdyField
            label='摘要'
            value={note}
            onChange={setNote}
            placeholder='一句话说清想从哪里说起就好'
            maxLength={WELLBEING_NOTE_MAX}
            hint={WELLBEING_NOTE_HINT}
          />
        </KdyCard>

        {problems.length > 0 && (
          <Text className='kdy-wb-create__problems'>还需要完善：{problems.join('、')}</Text>
        )}
        {error !== null && <Text className='kdy-wb-create__error'>{error}</Text>}

        <View className='kdy-wb-create__actions'>
          <KdyButton
            block
            loading={submitting}
            disabled={problems.length > 0}
            onClick={() => void handleSubmit()}
          >
            提交预约
          </KdyButton>
        </View>
      </>
    )
  }

  return (
    <View className='kdy-page kdy-wb-create'>
      <KdyHeading
        title='预约一次'
        subtitle='写清楚想约谁、什么时候，剩下的交给中心值班老师。'
        eyebrow='KEDAYA · 心理支持'
      />

      {/* 危机出口与边界：填表的人也可能正在难受，热线必须就近可见 */}
      <CrisisCard line={crisisLine} stale={crisisStale} />

      <Text className='kdy-wb-create__boundary'>{WELLBEING_BOUNDARY_NOTICE}</Text>

      {body}

      <Text className='kdy-disclaimer'>{WELLBEING_PLATFORM_DISCLAIMER}</Text>
    </View>
  )
}
