import { Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts'
import type { KedayaModule } from '@kedaya/contracts'

import { getContainer } from '../../../app/container'
import { moduleEntryPath } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyCard, KdyTag } from '../../components'
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
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return 'warning'
  return 'neutral'
}

function moduleBadge(module: KedayaModule): string {
  if (moduleEntryPath(module.id) !== null) return '已上线'
  if (module.requiresConsent) return '需二次同意'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return '高敏感'
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
      toast(`${module.nameZh}：需先二次同意（骨架未实现同意流程）`)
      return
    }
    toast(`${module.nameZh}：契约已登记，本骨架未实现`)
  }

  return (
    <View className='kdy-page kdy-home'>
      <View className='kdy-home__hero'>
        <Text className='kdy-home__brand'>可达鸭</Text>
        <Text className='kdy-home__slogan'>上科大，什么需求都可以到达</Text>
        <Text className='kdy-home__session'>
          {sessionState.profile === null
            ? '未登录 · 可在「我的」里用测试账号登录'
            : `已登录：${sessionState.profile.nickname}${
                sessionState.profile.campusBound ? '（已绑定校园系统）' : '（未绑定校园系统）'
              }`}
        </Text>
      </View>

      <KdyCard title='全部模块' extra={<Text>{MODULES.length} 个</Text>} elevated={false}>
        <View className='kdy-home__grid'>
          {MODULES.map((module) => (
            <View
              key={module.id}
              className='kdy-home__grid-item'
              onClick={() => handleModuleTap(module)}
            >
              <Text className='kdy-home__grid-name'>{module.nameZh}</Text>
              <KdyTag tone={moduleTone(module)}>{moduleBadge(module)}</KdyTag>
            </View>
          ))}
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
