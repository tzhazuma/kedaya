import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { PAGE_PATHS } from '../../../app/routes'
import { CAPABILITIES, currentPlatform } from '../../../platform'
import { openLocation } from '../../../platform/map'
import { navigateTo, toast } from '../../../platform/navigation'
import { scanCode } from '../../../platform/scanner'
import { shareToFriend } from '../../../platform/share'
import { SUBSCRIBE_TEMPLATES, requestSubscribeMessage } from '../../../platform/subscribeMessage'
import { KdyButton, KdyCard, KdyDock, KdyTag } from '../../components'
import { useThemeMode } from '../../theme/useThemeMode'
import './index.scss'

/**
 * 发现页 —— 平台能力演示台。
 *
 * 这个页面存在的意义：把「微信特有 / H5 降级」的差异**变成可点击、可观察的事实**，
 * 而不是只写在注释里。每个按钮都会真实调用 `src/platform/*`，
 * 并把 `PlatformResult` 的 code 原样显示出来（UNSUPPORTED / REJECTED / FAILED）。
 */

const CAMPUS_POINT = {
  latitude: 31.179_431,
  longitude: 121.592_605,
  name: '上海科技大学',
} as const

export default function DiscoverPage() {
  const { mode } = useThemeMode()
  const [lastResult, setLastResult] = useState('还没有调用过平台能力')

  function report(label: string, outcome: { ok: boolean; detail: string }): void {
    setLastResult(`${label} → ${outcome.ok ? 'OK' : 'FAIL'} · ${outcome.detail}`)
  }

  async function handleScan(): Promise<void> {
    const result = await scanCode()
    report(
      '扫码',
      result.ok
        ? { ok: true, detail: result.value }
        : { ok: false, detail: `${result.error.code}: ${result.error.message}` },
    )
  }

  async function handleSubscribe(): Promise<void> {
    const result = await requestSubscribeMessage([SUBSCRIBE_TEMPLATES.groupBuyFull])
    report(
      '订阅消息',
      result.ok
        ? { ok: true, detail: `已订阅 ${result.value.length} 个模板` }
        : { ok: false, detail: `${result.error.code}: ${result.error.message}` },
    )
  }

  async function handleShare(): Promise<void> {
    const result = await shareToFriend({ title: '可达鸭 · 上科大校园服务', path: PAGE_PATHS.home })
    report(
      '分享',
      result.ok
        ? { ok: true, detail: `渠道 = ${result.value}` }
        : { ok: false, detail: `${result.error.code}: ${result.error.message}` },
    )
  }

  async function handleMap(): Promise<void> {
    const result = await openLocation(CAMPUS_POINT)
    report(
      '地图',
      result.ok
        ? { ok: true, detail: `渠道 = ${result.value}` }
        : { ok: false, detail: `${result.error.code}: ${result.error.message}` },
    )
  }

  return (
    <View className={`kdy-page kdy-page--dock kdy-discover kdy-theme--${mode}`}>
      <View className='kdy-head'>
        <Text className='kdy-head__title'>发现</Text>
        <Text className='kdy-head__sub'>平台能力试跑台：微信特有 / H5 降级的差异都在这里点得出来</Text>
      </View>

      <KdyCard title='当前运行端' elevated={false}>
        <View className='kdy-discover__platform'>
          <KdyTag tone='brand'>{currentPlatform()}</KdyTag>
          <Text className='kdy-discover__hint'>
            weapp = 微信小程序（主端）；h5 = 次要编译目标
          </Text>
        </View>
      </KdyCard>

      <KdyCard title='平台能力试跑' elevated={false}>
        <View className='kdy-discover__actions'>
          <KdyButton size='sm' variant='ghost' onClick={() => void handleScan()}>
            扫码
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => void handleSubscribe()}>
            订阅消息
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => void handleShare()}>
            分享
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => void handleMap()}>
            地图
          </KdyButton>
        </View>
        <Text className='kdy-discover__result'>{lastResult}</Text>
      </KdyCard>

      <KdyCard title='能力差异矩阵' elevated={false}>
        {CAPABILITIES.map((capability) => (
          <View key={capability.id} className='kdy-discover__cap'>
            <View className='kdy-discover__cap-head'>
              <Text className='kdy-discover__cap-name'>{capability.nameZh}</Text>
              <KdyTag tone={capability.weappOnly ? 'danger' : 'info'}>
                {capability.weappOnly ? '微信特有' : '两端均有'}
              </KdyTag>
            </View>
            <Text className='kdy-discover__cap-line'>小程序：{capability.weapp}</Text>
            <Text className='kdy-discover__cap-line'>H5 降级：{capability.h5}</Text>
          </View>
        ))}
      </KdyCard>

      <KdyCard title='凑凑' elevated={false}>
        <Text className='kdy-discover__hint'>
          拼单已可使用，找搭子的发布与报名页面正在建设中。
        </Text>
        <View className='kdy-discover__actions'>
          <KdyButton
            size='sm'
            onClick={() => {
              void navigateTo(PAGE_PATHS.groupBuyList).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            进入凑凑
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyDock active='discover' />
    </View>
  )
}
