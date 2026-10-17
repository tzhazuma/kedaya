import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { PAGE_PATHS } from '../../../app/routes'
import { KdyHeading } from '../../components/KdyHeading'
import {
  SUBSCRIBE_TEMPLATES,
  requestSubscribeMessage,
} from '../../../platform/subscribeMessage'
import { KdyAgentFab, KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../components'
import './index.scss'

/**
 * 消息页 —— 站内信（空态）+ 订阅消息开关。
 *
 * 契约 §4.2：`notifications` 模块负责站内信与订阅消息。
 * 本骨架只实现「订阅消息申请」这条链路，站内信列表留空态并注明未实现。
 */

export default function MessagesPage() {
  const [status, setStatus] = useState<string | null>(null)
  const [subscribing, setSubscribing] = useState(false)

  async function handleSubscribe(): Promise<void> {
    setSubscribing(true)
    try {
      const result = await requestSubscribeMessage([
        SUBSCRIBE_TEMPLATES.groupBuyFull,
        SUBSCRIBE_TEMPLATES.groupBuyDeadline,
      ])
      if (result.ok) {
        setStatus(
          `已订阅 ${result.value.length} 个模板，成团时会推送一次性通知`,
        )
        return
      }
      setStatus(`${result.error.code}：${result.error.message}`)
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <View className='kdy-page kdy-messages'>
      <KdyHeading
        title='消息'
        subtitle='不错过每一份期待，也给生活留一点安静。'
      />
      <KdyCard
        title='订阅消息'
        extra={<KdyTag tone='danger'>微信特有</KdyTag>}
        elevated={false}
      >
        <Text className='kdy-messages__hint'>
          开启本次成团提醒，拼单有进展时及时知晓。微信订阅为一次性授权，下次参与时可再次开启。
        </Text>
        <View className='kdy-messages__actions'>
          <KdyButton
            size='sm'
            loading={subscribing}
            onClick={() => void handleSubscribe()}
          >
            申请成团提醒
          </KdyButton>
        </View>
        {status !== null && (
          <Text className='kdy-messages__status'>{status}</Text>
        )}
      </KdyCard>

      <KdyCard title='站内信' elevated={false}>
        <KdyEmpty
          mode='empty'
          title='还没有站内信'
          description='站内信功能正在准备中。目前可以先开启拼单订阅提醒。'
        />
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='notifications' page={PAGE_PATHS.messages} hint='通知看不懂？问我' />
    </View>
  )
}
