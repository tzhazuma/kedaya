import { Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts'
import type { KedayaModule } from '@kedaya/contracts'
import { useState } from 'react'

import { MODULE_ENTRY_PATHS, PAGE_PATHS } from '../../../app/routes'
import { CAPABILITIES, currentPlatform } from '../../../platform'
import { openLocation } from '../../../platform/map'
import { navigateTo, toast } from '../../../platform/navigation'
import { scanCode } from '../../../platform/scanner'
import { shareToFriend } from '../../../platform/share'
import { SUBSCRIBE_TEMPLATES, requestSubscribeMessage } from '../../../platform/subscribeMessage'
import { KdyAgentFab, KdyButton, KdyCard, KdyTag } from '../../components'
import type { KdyTagTone } from '../../components'
import { KdyDemoTools } from '../../components/KdyDemoTools'
import { KdyHeading } from '../../components/KdyHeading'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import './index.scss'

/**
 * 发现页 —— 模块入口 + 校园服务 + 平台能力试跑。
 *
 * 与本轮之前的区别：这里曾经是**纯能力演示台**，并且写着"拼单是当前唯一跑通的
 * 业务模块"—— 六个生活模块与四个核心模块都已实现，那句话会直接误导用户。
 * 现在真实内容在上，「平台能力试跑」收进折叠的演示工具里。
 *
 * 模块清单来自 `@kedaya/contracts` 的 `MODULES`（契约 §4：禁止各端硬编码模块清单）；
 * 「点进去看哪个页面」的映射来自 `app/routes.ts` 的 `MODULE_ENTRY_PATHS`，
 * 与首页共用同一份，不会出现两页各写一套而漂移。
 */

/** 「发现」页要突出展示的六个生活模块（顺序即展示顺序） */
const LIFE_MODULE_IDS: readonly string[] = [
  'groupbuy',
  'flea-market',
  'errand',
  'buddy',
  'lost-found',
  'forum',
]

/** 校园服务入口（含内置助手与我的资产） */
const CAMPUS_ENTRIES: readonly { label: string; detail: string; path: string }[] = [
  { label: '我的课表', detail: '今天上什么、下一节在哪', path: PAGE_PATHS.schedule },
  { label: '校园卡', detail: '余额、流水与异常扣款', path: PAGE_PATHS.campusCard },
  { label: '身份与绑定', detail: '统一身份 / 教务 / 校园卡逐系统授权', path: PAGE_PATHS.identity },
  { label: '我的资产', detail: '我发起和参与的拼单', path: PAGE_PATHS.profileAssets },
  { label: '消息中心', detail: '参团、接单、回复提醒', path: PAGE_PATHS.messages },
  { label: '可达鸭助手', detail: '校园生活的事都可以问它', path: PAGE_PATHS.agent },
]

const CAMPUS_POINT = {
  latitude: 31.179_431,
  longitude: 121.592_605,
  name: '上海科技大学',
} as const

function moduleTone(module: KedayaModule): KdyTagTone {
  if (module.requiresConsent) return 'danger'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return 'warning'
  return 'neutral'
}

export default function DiscoverPage() {
  const [lastResult, setLastResult] = useState('还没有调用过平台能力')

  function report(label: string, outcome: { ok: boolean; detail: string }): void {
    setLastResult(`${label} → ${outcome.ok ? 'OK' : 'FAIL'} · ${outcome.detail}`)
  }

  /** 未登记的模块要说清"为什么点不动"，而不是静默无反应 */
  function openModule(module: KedayaModule): void {
    const route = MODULE_ENTRY_PATHS[module.id]
    if (route !== undefined) {
      void navigateTo(route)
      return
    }
    if (module.requiresConsent) {
      toast(`${module.nameZh}：需二次同意，该流程尚未实现`)
      return
    }
    toast(`${module.nameZh}：契约已登记，页面尚未实现`)
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
    const result = await shareToFriend({
      title: '可达鸭 · 上科大校园服务',
      path: PAGE_PATHS.home,
    })
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

  const lifeModules = LIFE_MODULE_IDS.map((id) => MODULES.find((module) => module.id === id)).filter(
    (module): module is KedayaModule => module !== undefined,
  )

  return (
    <View className='kdy-page kdy-discover'>
      <KdyHeading
        title='发现校园的更多可能'
        subtitle='拼单、闲置、跑腿、组队、失物、论坛 —— 校园日常都在这里。'
        eyebrow='KEDAYA · 发现'
      />

      <KdyCard title='生活模块' extra={<KdyTag tone='brand'>已上线</KdyTag>} elevated={false}>
        <View className='kdy-discover__grid'>
          {lifeModules.map((module) => (
            <View
              key={module.id}
              className='kdy-discover__grid-item'
              onClick={() => openModule(module)}
            >
              <KdyModuleIcon id={module.id} />
              <Text className='kdy-discover__grid-name'>{module.nameZh}</Text>
            </View>
          ))}
        </View>
        <View className='kdy-discover__tips'>
          {MODULES.filter(
            (module) =>
              !LIFE_MODULE_IDS.includes(module.id) &&
              !(module.id in MODULE_ENTRY_PATHS) &&
              module.category === 'business',
          ).map((module) => (
            <View
              key={module.id}
              className='kdy-discover__tip'
              onClick={() => openModule(module)}
            >
              <KdyTag tone={moduleTone(module)}>{module.nameZh}</KdyTag>
              <Text className='kdy-discover__hint'>{module.summary}</Text>
            </View>
          ))}
        </View>
        <Text className='kdy-discover__hint'>
          上排之外的模块若显示为「开发中」，点它会明确告知状态，不会假装可用。
        </Text>
      </KdyCard>

      <KdyCard title='校园服务' elevated={false}>
        {CAMPUS_ENTRIES.map((item) => (
          <View
            key={item.path}
            className='kdy-discover__nav'
            onClick={() => void navigateTo(item.path)}
          >
            <View className='kdy-discover__nav-body'>
              <Text className='kdy-discover__nav-title'>{item.label}</Text>
              <Text className='kdy-discover__nav-detail'>{item.detail}</Text>
            </View>
            <Text className='kdy-discover__nav-arrow'>›</Text>
          </View>
        ))}
      </KdyCard>

      <KdyCard title='提示' elevated={false}>
        <Text className='kdy-discover__hint'>
          校园数据（课表 / 校园卡）需先在「身份与绑定」里完成授权；未绑定时功能会明确提示，
          不会展示编造的数据。拼单与线下面交均不涉及资金流转。
        </Text>
      </KdyCard>

      <KdyDemoTools>
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
      </KdyDemoTools>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='discover' page={PAGE_PATHS.discover} hint='想找什么？问我' />
    </View>
  )
}
