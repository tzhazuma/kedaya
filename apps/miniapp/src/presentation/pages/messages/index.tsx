import { Text, View } from '@tarojs/components'
import { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import {
  SUBSCRIBE_TEMPLATES,
  requestSubscribeMessage,
} from '../../../platform/subscribeMessage'
import type { NotificationSource, NotificationSummary } from '../../../domain/models/notification'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyButton, KdyCard, KdyChip, KdyEmpty, KdyListSkeleton, KdyTag } from '../../components'
import type { KdyTagTone } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 消息页 —— 站内信（真实列表）+ 订阅消息。
 *
 * 三条产品纪律：
 *   · **只有已登记来源才显示来源标签**：后端新增了来源而小程序还没跟上时，
 *     降级成「通知」而不是显示一个英文枚举值；
 *   · **不可点的通知不假装可点**：`link` 为 null（或指向未知页面）时，
 *     卡片不显示箭头、点击只标记已读，绝不 `navigateTo` 一个白屏页；
 *   · **未读数是独立状态**：它同时驱动 tabBar 红点，因此不绑定列表加载状态。
 */

const SCOPES: readonly { id: 'all' | 'unread'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
]

/** 来源 → 标签色调（色值来自设计令牌，页面不自己拼颜色） */
function sourceTone(source: NotificationSource): KdyTagTone {
  if (source === 'groupbuy') return 'brand'
  if (source === 'errand') return 'info'
  if (source === 'flea-market') return 'warning'
  if (source === 'forum') return 'success'
  return 'neutral'
}

export default function MessagesPage() {
  const container = getContainer()
  const notifications = container.useCases.notifications
  const state = useStore(notifications.list)
  const unread = useStore(notifications.unread)
  const session = useStore(container.useCases.session)

  const [status, setStatus] = useState<string | null>(null)
  const [subscribing, setSubscribing] = useState(false)
  const [marking, setMarking] = useState(false)

  const filters = state.query as { unreadOnly?: boolean }
  const scope: 'all' | 'unread' = filters.unreadOnly === true ? 'unread' : 'all'

  function refresh(patch: { unreadOnly?: boolean } = {}): void {
    void notifications.list.load({ cursor: null, ...patch })
  }

  useDidShow(() => {
    notifications.list.hydrate()
    refresh()
    void notifications.refreshUnread()
  })

  useReachBottom(() => {
    void notifications.list.loadMore()
  })

  usePullDownRefresh(() => {
    refresh()
    void notifications.refreshUnread()
  })

  async function handleSubscribe(): Promise<void> {
    setSubscribing(true)
    try {
      const result = await requestSubscribeMessage([
        SUBSCRIBE_TEMPLATES.groupBuyFull,
        SUBSCRIBE_TEMPLATES.groupBuyDeadline,
      ])
      if (result.ok) {
        setStatus(`已订阅 ${result.value.length} 个模板，成团时会推送一次性通知`)
        return
      }
      setStatus(`${result.error.code}：${result.error.message}`)
    } finally {
      setSubscribing(false)
    }
  }

  async function handleMarkAllRead(): Promise<void> {
    if (marking || unread === 0) return
    setMarking(true)
    const result = await notifications.markAllRead()
    setMarking(false)
    if (!result.ok) {
      toast(result.error.message)
      return
    }
    toast(`已把 ${result.value} 条标为已读`, 'success')
  }

  async function handleOpen(item: NotificationSummary): Promise<void> {
    // 先标记已读（幂等），再跳转。即使跳转失败，用户也不会再看到未读红点。
    if (item.unread) void notifications.markRead(item.id)
    if (item.link !== null) {
      await navigateTo(item.link)
      return
    }
    toast('这条通知没有可跳转的页面')
  }

  const showEmpty = state.status === 'empty'
  const showError = state.status === 'error'
  const showLoading = state.status === 'loading' || state.status === 'idle'

  return (
    <View className='kdy-page kdy-messages'>
      <KdyHeading
        title='消息'
        subtitle='不错过每一份期待，也给生活留一点安静。'
        eyebrow='KEDAYA · 消息'
      />

      <View className='kdy-messages__toolbar'>
        <View className='kdy-messages__scopes'>
          {SCOPES.map((item) => (
            <KdyChip
              key={item.id}
              active={scope === item.id}
              onClick={() => {
                refresh({ unreadOnly: item.id === 'unread' })
              }}
            >
              {item.id === 'unread' && unread > 0 ? `未读 ${unread}` : item.label}
            </KdyChip>
          ))}
        </View>
        {session.tokens !== null && unread > 0 && (
          <KdyButton size='sm' variant='ghost' loading={marking} onClick={() => void handleMarkAllRead()}>
            全部已读
          </KdyButton>
        )}
      </View>

      {session.tokens === null && (
        <KdyCard elevated={false}>
          <Text className='kdy-messages__hint'>登录后才会收到与你相关的提醒。</Text>
          <View className='kdy-messages__actions'>
            <KdyButton size='sm' onClick={() => void navigateTo(PAGE_PATHS.authLogin)}>
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {showLoading && <KdyListSkeleton />}

      {showError && (
        <KdyCard elevated={false}>
          <KdyEmpty
            mode='error'
            description={state.error ?? '请检查网络后重试'}
            actionText='重试'
            onAction={() => refresh()}
          />
        </KdyCard>
      )}

      {showEmpty && (
        <KdyCard elevated={false}>
          <KdyEmpty
            mode='empty'
            title={scope === 'unread' ? '没有未读消息' : '还没有消息'}
            description={
              scope === 'unread'
                ? '所有消息都已读完，去别处逛逛吧。'
                : '拼单成团、跑腿接单、闲置被预定等提醒都会出现在这里。'
            }
          />
        </KdyCard>
      )}

      {!showEmpty &&
        !showError &&
        !showLoading &&
        state.items.map((item) => (
          <KdyCard key={item.id} elevated={false} onClick={() => void handleOpen(item)}>
            <View className={`kdy-message${item.unread ? ' kdy-message--unread' : ''}`}>
              <View className='kdy-message__head'>
                <View className='kdy-message__title-wrap'>
                  {item.unread && <View className='kdy-message__dot' />}
                  <Text className='kdy-message__title'>{item.title}</Text>
                </View>
                <KdyTag tone={sourceTone(item.source)}>{item.sourceLabel}</KdyTag>
              </View>

              <Text className='kdy-message__body'>{item.body}</Text>

              <View className='kdy-message__foot'>
                <Text className='kdy-message__time'>{item.timeLabel}</Text>
                {item.link !== null && <Text className='kdy-message__link'>查看详情 ›</Text>}
              </View>
            </View>
          </KdyCard>
        ))}

      {state.nextCursor !== null && (
        <View className='kdy-messages__more'>
          <KdyButton
            size='sm'
            variant='secondary'
            loading={state.loadingMore}
            onClick={() => void notifications.list.loadMore()}
          >
            加载更多
          </KdyButton>
        </View>
      )}

      <KdyCard title='订阅消息' extra={<KdyTag tone='danger'>微信特有</KdyTag>} elevated={false}>
        <Text className='kdy-messages__hint'>
          开启本次成团提醒，拼单有进展时通过微信服务通知及时知晓。微信订阅为一次性授权，下次参与时可再次开启。
        </Text>
        <View className='kdy-messages__actions'>
          <KdyButton size='sm' loading={subscribing} onClick={() => void handleSubscribe()}>
            申请成团提醒
          </KdyButton>
        </View>
        {status !== null && <Text className='kdy-messages__status'>{status}</Text>}
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='notifications' page={PAGE_PATHS.messages} hint='通知看不懂？问我' />
    </View>
  )
}
