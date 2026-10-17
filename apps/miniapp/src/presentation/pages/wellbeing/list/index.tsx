import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, wellbeingDetailPath } from '../../../../app/routes'
import {
  CRISIS_FALLBACK,
  CRISIS_FALLBACK_NOTICE,
  WELLBEING_BOUNDARY_NOTICE,
  WELLBEING_CONSENT_POINTS,
  WELLBEING_CONSENT_TITLE,
  WELLBEING_PLATFORM_DISCLAIMER,
  WELLBEING_STATUS_LABELS,
  WELLBEING_STATUSES,
  isDialable,
} from '../../../../domain/models/wellbeing'
import type {
  WellbeingAppointmentSummary,
  WellbeingCrisisLine,
  WellbeingStatus,
} from '../../../../domain/models/wellbeing'
import { makePhoneCall } from '../../../../platform/dialer'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 心理支持列表页 —— 模块入口，也是**危机出口**所在的第一屏。
 *
 * 这一页的渲染顺序就是优先级顺序，别调换：
 *   1. **危机出口**：`GET /wellbeing/crisis-line` 是公开端点（无登录、无同意）。
 *      接口失败时用 `CRISIS_FALLBACK` —— 断网 / 未登录 / 未同意都必须看得到号码，
 *      这是本模块唯一不能降级的内容（"网络不好 → 热线一起消失"是最坏的失败）。
 *   2. **边界声明**：`WELLBEING_BOUNDARY_NOTICE`（倾听与预约入口，不做诊断、不做治疗）。
 *   3. **二次同意门**（契约 §9）：本地留痕决定门要不要弹，服务端记录才是放行依据；
 *      同意之前**一个预约字段都不请求**。
 *   4. 我的预约列表：永远是"我的"（后端强制按主体收窄，这里没有 mine 开关）。
 *
 * 「危机出口卡片」与「同意门」在两个页面上各有一份薄薄的标记（受"只允许新建这些
 * 文件"的约束无法抽公共组件）。内容的唯一真相是 `domain/models/wellbeing.ts`：
 * 号码与文案都从那里来，页面只负责摆放。
 */

const ALL_STATUS = 'all'
type StatusFilter = WellbeingStatus | typeof ALL_STATUS

const STATUS_FILTERS: readonly StatusFilter[] = [ALL_STATUS, ...WELLBEING_STATUSES]

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

function AppointmentCard({ item }: { item: WellbeingAppointmentSummary }) {
  return (
    <KdyCard
      elevated={false}
      onClick={() => {
        void navigateTo(wellbeingDetailPath(item.id))
      }}
    >
      <View className='kdy-wb-card'>
        <View className='kdy-wb-card__head'>
          <Text className='kdy-wb-card__counselor'>{item.counselor}</Text>
          <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
        </View>
        <Text className='kdy-wb-card__slot'>
          {item.slotLabel}（{item.slotRelative}）· {item.modeLabel}
        </Text>
        {item.crisisFlag ? (
          <Text className='kdy-wb-card__flag'>这次预约已给出紧急联系渠道</Text>
        ) : null}
        {item.notePreview === '' ? null : (
          <Text className='kdy-wb-card__preview'>{item.notePreview}</Text>
        )}
      </View>
    </KdyCard>
  )
}

export default function WellbeingListPage() {
  const container = getContainer()
  const wellbeing = container.useCases.wellbeing
  const state = useStore(wellbeing.list)
  const crisis = useStore(wellbeing.crisis)
  const session = useStore(container.useCases.session)
  const loggedIn = session.tokens !== null

  const [checkingConsent, setCheckingConsent] = useState(true)
  const [consentNeeded, setConsentNeeded] = useState(true)
  const [accepting, setAccepting] = useState(false)

  const filters = state.query as { status?: WellbeingStatus }
  const crisisLine = crisis.data ?? CRISIS_FALLBACK
  const crisisStale = crisis.data === null

  function refreshList(patch: { status?: WellbeingStatus } = {}): void {
    void wellbeing.list.load(patch)
  }

  /**
   * 进入页面前先过同意门（契约 §9）。
   *
   * 未登录：不发注定 401 的请求，直接给登录引导；
   * 已登录：`needsConsent()` 会顺带和服务端对齐一次（本地有、服务端没有 → 重新同意）。
   */
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
    if (!needed) refreshList()
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
    refreshList()
  }

  useDidShow(() => {
    // 危机出口优先：即使下面全都加载不出来，这一块也必须已经能显示
    void wellbeing.crisis.load('crisis-line')
    wellbeing.list.hydrate()
    void refreshConsent()
  })

  usePullDownRefresh(() => {
    if (container.useCases.session.getSnapshot().tokens === null) {
      Taro.stopPullDownRefresh()
      return
    }
    void wellbeing.list.load().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void wellbeing.list.loadMore()
  })

  function requireLogin(next: string): boolean {
    if (container.useCases.session.getSnapshot().tokens !== null) return true
    toast('请先登录')
    void navigateTo(next)
    return false
  }

  return (
    <View className='kdy-page kdy-wb'>
      <KdyHeading
        title='心理支持'
        subtitle='一个可以慢慢说的地方；需要时也能帮你约到中心的老师。'
      />

      {/* 1. 危机出口 —— 永远在第一屏 */}
      <CrisisCard line={crisisLine} stale={crisisStale} />

      {/* 2. 边界：这里是倾听与预约入口，不是医疗 */}
      <Text className='kdy-wb__boundary'>{WELLBEING_BOUNDARY_NOTICE}</Text>

      {/* 3. 同意门 / 列表 */}
      {!loggedIn ? (
        <KdyEmpty
          mode='empty'
          title='登录后查看你的预约'
          description='预约与摘要只有你和中心值班老师能看到，登录后才能查看与创建。'
          actionText='去登录'
          onAction={() => {
            void navigateTo(PAGE_PATHS.authLogin)
          }}
        />
      ) : checkingConsent ? (
        <KdyEmpty mode='loading' />
      ) : consentNeeded ? (
        <KdyCard title={WELLBEING_CONSENT_TITLE} extra={<KdyTag tone='danger'>高敏感</KdyTag>}>
          {WELLBEING_CONSENT_POINTS.map((point) => (
            <Text key={point} className='kdy-wb__li'>
              · {point}
            </Text>
          ))}
          <View className='kdy-wb__actions'>
            <KdyButton block loading={accepting} onClick={() => void handleAcceptConsent()}>
              我已阅读并同意
            </KdyButton>
          </View>
        </KdyCard>
      ) : (
        <>
          <View className='kdy-wb__filters'>
            {STATUS_FILTERS.map((status) => (
              <KdyChip
                key={status}
                active={(filters.status ?? ALL_STATUS) === status}
                onClick={() => refreshList({ status: status === ALL_STATUS ? undefined : status })}
              >
                {status === ALL_STATUS ? '全部' : WELLBEING_STATUS_LABELS[status]}
              </KdyChip>
            ))}
          </View>

          {state.status === 'loading' && <KdyListSkeleton />}

          {state.status === 'empty' && (
            <KdyEmpty
              mode='empty'
              title='还没有预约'
              description={
                filters.status === undefined
                  ? '想找人聊一聊，或者只是想把烦心事说出来，都可以先约一次。'
                  : '这个状态下还没有预约，换个筛选条件看看。'
              }
              actionText='预约一次'
              onAction={() => {
                if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.wellbeingCreate)
              }}
            />
          )}

          {state.status === 'error' && (
            <KdyEmpty
              mode='error'
              title='没能拿到你的预约'
              description={state.error ?? '请稍后重试'}
              actionText='重试'
              onAction={() => refreshList()}
            />
          )}

          {state.items.map((item) => (
            <AppointmentCard key={item.id} item={item} />
          ))}

          {state.nextCursor !== null && state.status === 'ready' && (
            <View className='kdy-wb__more'>
              <KdyButton
                size='sm'
                variant='ghost'
                loading={state.loadingMore}
                onClick={() => {
                  void wellbeing.list.loadMore()
                }}
              >
                加载更多
              </KdyButton>
            </View>
          )}

          {state.error !== null && state.status === 'ready' && (
            <Text className='kdy-wb__inline-error'>{state.error}</Text>
          )}

          <View className='kdy-wb__fab'>
            <KdyButton
              onClick={() => {
                if (requireLogin(PAGE_PATHS.authLogin)) void navigateTo(PAGE_PATHS.wellbeingCreate)
              }}
            >
              预约一次
            </KdyButton>
          </View>
        </>
      )}

      <Text className='kdy-disclaimer'>{WELLBEING_PLATFORM_DISCLAIMER}</Text>
    </View>
  )
}
