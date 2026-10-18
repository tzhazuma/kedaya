import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { CAPABILITIES } from '../../../platform'
import { SUBSCRIBE_TEMPLATES, requestSubscribeMessage } from '../../../platform/subscribeMessage'
import { KdyButton, KdyCard, KdyDock, KdyEmpty, KdyTag } from '../../components'
import { useThemeMode } from '../../theme/useThemeMode'
import './index.scss'

/**
 * 消息页 —— 站内信（空态）+ 订阅消息开关。
 *
 * 契约 §4.2：`notifications` 模块负责站内信与订阅消息。
 * 本骨架只实现「订阅消息申请」这条链路，站内信列表留空态并注明未实现。
 */

const CAPABILITY = CAPABILITIES.find((item) => item.id === 'subscribe-message')

export default function MessagesPage() {
  const { mode } = useThemeMode()
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
        setStatus(`已订阅 ${result.value.length} 个模板，成团时会推送一次性通知`)
        return
      }
      setStatus(`${result.error.code}：${result.error.message}`)
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <View className={`kdy-page kdy-page--dock kdy-messages kdy-theme--${mode}`}>
      <View className='kdy-head'>
        <Text className='kdy-head__title'>消息</Text>
        <Text className='kdy-head__sub'>成团提醒走订阅消息：一次性授权，只推一条</Text>
      </View>

      <KdyCard
        title='订阅消息'
        extra={<KdyTag tone='danger'>微信特有</KdyTag>}
        elevated={false}
      >
        <Text className='kdy-messages__hint'>
          微信订阅消息是「一次性」的：用户允许一次，只能推一条。因此每次关键动作都要重新申请。
        </Text>
        <View className='kdy-messages__actions'>
          <KdyButton size='sm' loading={subscribing} onClick={() => void handleSubscribe()}>
            申请成团提醒
          </KdyButton>
        </View>
        {status !== null && <Text className='kdy-messages__status'>{status}</Text>}
      </KdyCard>

      <KdyCard title='站内信' elevated={false}>
        <KdyEmpty
          mode='empty'
          title='还没有站内信'
          description='站内信列表（notifications 模块）尚未实现，当前只有订阅消息链路'
        />
      </KdyCard>

      {CAPABILITY !== undefined && (
        <KdyCard title='两端差异' elevated={false}>
          <Text className='kdy-messages__hint'>小程序：{CAPABILITY.weapp}</Text>
          <Text className='kdy-messages__hint'>H5 降级：{CAPABILITY.h5}</Text>
        </KdyCard>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyDock active='messages' />
    </View>
  )
}
