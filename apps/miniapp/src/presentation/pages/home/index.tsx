import { Text, View } from '@tarojs/components'
import { MODULES } from '@kedaya/contracts/modules'
import type { KedayaModule } from '@kedaya/contracts'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyCard, KdyTag } from '../../components'
import type { KdyTagTone } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 首页 —— 模块宫格。
 *
 * **一级入口完全由 `@kedaya/contracts/modules` 的模块注册表驱动**（契约 §4 硬规则：
 * 禁止在各端硬编码模块清单）。因此这里没有任何写死的模块数组，
 * 后端/契约新增模块时首页自动出现。
 *
 * 敏感级展示规则（契约 §9）：需要二次同意的模块标红，high/critical 标黄。
 */

/** 已实现垂直切片的模块（其余点击后明确提示「开发中」，不假装可用） */
const IMPLEMENTED_MODULE_IDS: readonly string[] = ['groupbuy', 'wildlife']

// 从明确的模块入口读取原始注册表，避免新增 barrel 导出与旧公共包混用时
// 首页拿到 undefined。一级入口仍由共享契约的父子关系决定。
const HOME_MODULES = MODULES.filter((module) => module.parentId === undefined)

function moduleTone(module: KedayaModule): KdyTagTone {
  if (module.requiresConsent) return 'danger'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return 'warning'
  return 'neutral'
}

function moduleBadge(module: KedayaModule): string {
  if (module.id === 'groupbuy') return '拼单可用'
  if (IMPLEMENTED_MODULE_IDS.includes(module.id)) return '已上线'
  if (module.requiresConsent) return '需二次同意'
  if (module.sensitivity === 'high' || module.sensitivity === 'critical') return '高敏感'
  return '开发中'
}

export default function HomePage() {
  const container = getContainer()
  const session = container.useCases.session
  const sessionState = useStore(session)

  function handleModuleTap(module: KedayaModule): void {
    if (module.id === 'wildlife') {
      void navigateTo(PAGE_PATHS.wildlife)
      return
    }
    if (module.id === 'groupbuy') {
      void navigateTo(PAGE_PATHS.groupBuyList)
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

      <KdyCard title='全部模块' extra={<Text>{HOME_MODULES.length} 个</Text>} elevated={false}>
        <View className='kdy-home__grid'>
          {HOME_MODULES.map((module) => (
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
