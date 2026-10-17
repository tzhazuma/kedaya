import { Text, View } from '@tarojs/components'
import { AppsOutlined, ArrowRight, LikeOutlined } from '@taroify/icons'
import { useDidShow } from '@tarojs/taro'

import { getContainer } from '../../../app/container'
import {
  PAGE_PATHS,
  couPath,
  homeEntryPath,
  homeServicesPath,
  profileHomePath,
} from '../../../app/routes'
import { homeEntryById } from '../../../domain/models/homeEntries'
import type { HomeEntry } from '../../../domain/models/homeEntries'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyCard, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import { useStore } from '../../hooks'
import { homeEntryState } from './entryState'
import './index.scss'

/**
 * 首页 —— 「我的常用」+ 一个聚合入口。
 *
 * ## 这一版修掉的问题
 *
 * 上一版把契约里的 20 个模块一口气平铺成两屏宫格（「常用服务」写死 4 个 +
 * 「全部模块」再铺 20 个，重复出现 4 个）。模块越加越多，首页就越像一张目录，
 * 用户每次都要在里面**找**东西。现在：
 *
 *   · 首页只放**用户自己挑的**入口（默认 9 个，上限 12 个），
 *     在「我的 → 首页管理」里增删排序 —— 类似支付宝的「我的应用」；
 *   · 「全部」有专门的**服务大厅**页：按场景分组 + 搜索，不再挤在首页；
 *   · 多出的第四个位置固定给「全部服务」，它永远在同一格，不需要找。
 *
 * ## 模块清单依然是契约驱动的
 *
 * 首页没有任何写死的模块数组：入口目录来自 `domain/models/homeEntries`，
 * 它由 `@kedaya/contracts` 的 `MODULES` 派生（契约 §4 硬规则），
 * 路径来自 `app/routes.ts` 的 `homeEntryPath`。契约新增模块时，
 * `homeEntries.test.ts` 会先红，提醒你把新模块登记进分组。
 *
 * ## 两条不可协商的东西
 *
 * 1. **心理支持固定在首页**（`locked`，不能移除、不参与排序）——
 *    安全出口不能被一次误触的自定义藏掉；首页底部还有一条常驻热线横幅兜底。
 * 2. **未上线的模块如实说明**（当前只有「场馆预约」）——
 *    点它得到一句「契约已登记，页面尚未实现」，而不是一个白屏。
 */

export default function HomePage() {
  const container = getContainer()
  const session = container.useCases.session
  const sessionState = useStore(session)
  const layout = container.useCases.homeLayout
  useStore(layout)

  // 从「首页管理」改完返回首页时立刻是新布局（hydrate 是同步读缓存且幂等）
  useDidShow(() => {
    layout.hydrate()
  })

  const entries = layout.selectedEntries()
  const cou = homeEntryById('cou')
  const wellbeing = homeEntryById('wellbeing')

  function openEntry(entry: HomeEntry): void {
    const path = homeEntryPath(entry.id)
    if (path !== null) {
      void navigateTo(path)
      return
    }
    toast(`${entry.label}：契约已登记，页面尚未实现`)
  }

  return (
    <View className='kdy-page kdy-home'>
      <KdyHeading
        title={
          sessionState.profile
            ? `你好，${sessionState.profile.nickname}`
            : '校园生活，可达鸭。'
        }
        subtitle='上科大，什么需求都可以到达'
        eyebrow='KEDAYA · 上海科技大学'
      />

      {/* 聚合入口：凑凑（拼单 + 找搭子） */}
      <View className='kdy-home__hero kdy-glass' onClick={() => void navigateTo(couPath())}>
        <View className='kdy-home__hero-copy'>
          <KdyTag tone='brand'>{cou?.subLabel ?? '拼单 · 找搭子'}</KdyTag>
          <Text className='kdy-home__hero-title'>一个人凑不齐，凑一凑就够了</Text>
          <Text className='kdy-home__hero-description'>
            {cou?.hint ?? '发起拼单、找搭子组队，都从这里进。'}
          </Text>
          <View className='kdy-home__hero-link'>
            去凑凑 <ArrowRight />
          </View>
        </View>
        <View className='kdy-home__hero-art'>
          <KdyModuleIcon id='cou' />
        </View>
      </View>

      {/* 我的常用（用户自己挑的入口） */}
      <KdyCard
        title='我的常用'
        extra={
          <Text
            className='kdy-home__edit'
            onClick={() => void navigateTo(profileHomePath())}
          >
            编辑
          </Text>
        }
        elevated={false}
      >
        <View className='kdy-home__grid'>
          {entries.map((entry) => {
            const state = homeEntryState(entry)
            return (
              <View
                key={entry.id}
                className='kdy-home__grid-item'
                onClick={() => openEntry(entry)}
              >
                <KdyModuleIcon id={entry.icon} />
                <Text className='kdy-home__grid-name'>{entry.label}</Text>
                {state.label !== null && (
                  <Text className={`kdy-home__module-state kdy-home__module-state--${state.tone}`}>
                    {state.label}
                  </Text>
                )}
              </View>
            )
          })}

          {/* 「全部服务」永远在最后一格：用户不需要为了"找东西"而先自己去管理页 */}
          <View
            className='kdy-home__grid-item'
            onClick={() => void navigateTo(homeServicesPath())}
          >
            <View className='kdy-module-icon kdy-module-icon--plain'>
              <AppsOutlined />
            </View>
            <Text className='kdy-home__grid-name'>全部服务</Text>
          </View>
        </View>

        <Text className='kdy-home__grid-hint'>
          {entries.length} / 12 个服务。想换成别的，去「编辑」或「我的 → 首页管理」。
        </Text>
      </KdyCard>

      {/* 安全出口：常驻，不属于可自定义的内容 */}
      <View
        className='kdy-home__safety'
        onClick={() => {
          if (wellbeing !== undefined) openEntry(wellbeing)
        }}
      >
        <LikeOutlined />
        <View className='kdy-home__safety-body'>
          <Text className='kdy-home__safety-title'>你的感受，值得被听见</Text>
          <Text className='kdy-home__safety-description'>
            心理支持 · 24 小时热线 12356
          </Text>
        </View>
        <ArrowRight />
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='home' page={PAGE_PATHS.home} hint='不认识的地方，问我' />
    </View>
  )
}
