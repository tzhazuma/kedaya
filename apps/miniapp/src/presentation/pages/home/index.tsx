import { Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts'
import type { KedayaModule } from '@kedaya/contracts'

import { getContainer } from '../../../app/container'
import { moduleEntryPath } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab, KdyCard, KdyTag } from '../../components'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import { KdyHeading } from '../../components/KdyHeading'
import { LikeOutlined, ArrowRight } from '@taroify/icons'
import type { KdyTagTone } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 首页 —— 模块宫格。
 *
 * **模块清单完全由 `@kedaya/contracts` 的 `MODULES` 驱动**（契约 §4 硬规则：
 * 禁止在各端硬编码模块清单）。因此这里没有任何写死的模块数组，
 * 后端/契约新增模块时首页自动出现。
 *
 * 「哪些模块已经有真实页面」由 `app/routes.ts` 的 `MODULE_ENTRY_PATHS` 声明 ——
 * 这也是一张表，而不是散落在页面里的 `if (id === 'xxx')`。
 *
 * 敏感级展示规则（契约 §9）：需要二次同意的模块标红，high/critical 标黄。
 */

function moduleTone(module: KedayaModule): KdyTagTone {
  if (module.requiresConsent) return 'danger'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical')
    return 'warning'
  return 'neutral'
}

function moduleBadge(module: KedayaModule): string {
  if (moduleEntryPath(module.id) !== null) return '已上线'
  if (module.requiresConsent) return '需二次同意'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical')
    return '高敏感'
  return '开发中'
}

export default function HomePage() {
  const container = getContainer()
  const session = container.useCases.session
  const sessionState = useStore(session)

  function handleModuleTap(module: KedayaModule): void {
    const path = moduleEntryPath(module.id)
    if (path !== null) {
      void navigateTo(path)
      return
    }
    if (module.requiresConsent) {
      toast(`${module.nameZh}：需二次同意，该流程尚未实现`)
      return
    }
    toast(`${module.nameZh}：契约已登记，尚未实现`)
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

      <View
        className='kdy-home__feature kdy-glass'
        onClick={() => void navigateTo(PAGE_PATHS.groupBuyList)}
      >
        <View className='kdy-home__feature-copy'>
          <KdyTag tone='brand'>一起拼，更划算</KdyTag>
          <Text className='kdy-home__feature-title'>好东西，和同学分享</Text>
          <Text className='kdy-home__feature-description'>
            发现校园拼单，让每一份心意都有回应。
          </Text>
          <View className='kdy-home__feature-link'>
            去看看拼单 <ArrowRight />
          </View>
        </View>
        <View className='kdy-home__feature-art'>
          <KdyModuleIcon id='groupbuy' />
        </View>
      </View>

      <KdyCard
        title='常用服务'
        extra={<Text>校园日常，轻松到达</Text>}
        elevated={false}
      >
        <View className='kdy-home__grid'>
          {MODULES.filter((module) =>
            ['groupbuy', 'schedule', 'campus-card', 'lost-found'].includes(
              module.id,
            ),
          ).map((module) => (
            <View
              key={module.id}
              className='kdy-home__grid-item'
              onClick={() => handleModuleTap(module)}
            >
              <KdyModuleIcon id={module.id} />
              <Text className='kdy-home__grid-name'>{module.nameZh}</Text>
            </View>
          ))}
        </View>
      </KdyCard>

      <View
        className='kdy-home__support'
        onClick={() => {
          const module = MODULES.find((item) => item.id === 'wellbeing')
          if (module) handleModuleTap(module)
        }}
      >
        <LikeOutlined />
        <View>
          <Text className='kdy-home__support-title'>你的感受，值得被听见</Text>
          <Text className='kdy-home__support-description'>
            心理支持 · 需要帮助时，拨打 12356
          </Text>
        </View>
        <ArrowRight />
      </View>

      <KdyCard
        title='全部模块'
        extra={<Text>{MODULES.length} 个</Text>}
        elevated={false}
      >
        <View className='kdy-home__grid'>
          {MODULES.map((module) => (
            <View
              key={module.id}
              className='kdy-home__grid-item'
              onClick={() => handleModuleTap(module)}
            >
              <KdyModuleIcon id={module.id} />
              <Text className='kdy-home__grid-name'>{module.nameZh}</Text>
              <Text
                className={`kdy-home__module-state kdy-home__module-state--${moduleTone(module)}`}
              >
                {moduleBadge(module)}
              </Text>
            </View>
          ))}
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='home' page={PAGE_PATHS.home} hint='不认识的地方，问我' />
    </View>
  )
}
