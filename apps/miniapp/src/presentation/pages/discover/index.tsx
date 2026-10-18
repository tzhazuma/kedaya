import { Text, View } from '@tarojs/components'
import { ArrowRight } from '@taroify/icons'
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
    toast(`${module.nameZh}还在开发中`)
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
      <KdyHeading title='发现' />

      <KdyCard title='生活模块' elevated={false}>
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
        <Text className='kdy-discover__hint'>灰色的是还没上线的模块。</Text>
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
            <ArrowRight className='kdy-discover__nav-arrow' />
          </View>
        ))}
      </KdyCard>

      <KdyCard title='数据来源' elevated={false}>
        <Text className='kdy-discover__hint'>
          课表、校园卡、实名等校园数据为演示数据，非校方真实数据。
        </Text>
      </KdyCard>

      <KdyCard title='论坛与常见问题' elevated={false}>
        <Text className='kdy-discover__hint'>
          同学之间的问答与互助：论坛发帖、常见问题里找答案，找不到可以提工单。
        </Text>
        <View className='kdy-discover__actions'>
          <KdyButton
            size='sm'
            onClick={() => {
              void navigateTo(PAGE_PATHS.forumList).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            进入论坛
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void navigateTo(PAGE_PATHS.faq).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            进入常见问题
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void navigateTo(PAGE_PATHS.faqTickets).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            我的工单
          </KdyButton>
        </View>
      </KdyCard>

      <KdyCard title='野生动物' elevated={false}>
        <Text className='kdy-discover__hint'>
          认识校园里的野生居民，看看它们在哪活动；偶遇了可以上报一条观测。
        </Text>
        <View className='kdy-discover__actions'>
          <KdyButton
            size='sm'
            onClick={() => {
              void navigateTo(PAGE_PATHS.wildlifeArchive).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            居民档案
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void navigateTo(PAGE_PATHS.wildlifeReport).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            上报观测
          </KdyButton>
          <KdyButton
            size='sm'
            variant='ghost'
            onClick={() => {
              void navigateTo(PAGE_PATHS.wildlifeTracks).then((result) => {
                if (!result.ok) toast(result.error.message)
              })
            }}
          >
            推断轨迹
          </KdyButton>
        </View>
      </KdyCard>

      <KdyDemoTools>
        <KdyCard title='Mock 登录凭据' elevated={false}>
          <Text className='kdy-discover__hint'>
            本地默认 Mock 后端（TARO_APP_USE_MOCK=true）。演示账号
            demo@kedaya.dev / Kedaya2026，六类角色见 docs/local-development.md。
          </Text>
          <Text className='kdy-discover__hint'>
            登录页不显示这些字样：它是给真实用户的页面，Mock 凭据只在这里和文档里。
          </Text>
        </KdyCard>

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
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='discover' page={PAGE_PATHS.discover} />
    </View>
  )
}
