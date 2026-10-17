import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'

import { getContainer } from '../../../../app/container'
import { campusCardPath, techpieLinksPath, techpieWebviewPath } from '../../../../app/routes'
import {
  CAMPUS_PLATFORM_LABELS,
  campusCapabilityDefinition,
} from '../../../../domain/models/techpie'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCampusCredentialNotice, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import { campusViewerOf } from '../../../../application/techpie/capabilities'
import type { CampusCapabilityEntry } from '../../../../application/techpie/capabilities'
import './index.scss'

/**
 * 校园能力清单页 —— 规格 §8.1 的 `GET /techpie/capabilities`。
 *
 * ## ⚠️ 本页存在的核心目的：把 `CAMPUS_BINDING_REQUIRED` 画成**引导**而不是**报错**
 *
 * 契约不变式 **I4**：`已登录但未绑定` 是**合法状态**，
 * 校园功能返回 `409 CAMPUS_BINDING_REQUIRED` 而**不是** `401 UNAUTHENTICATED`。
 *
 * 在客户端，这条不变式体现为**两种完全不同的渲染**：
 *
 * | 状态 | 契约码 | 渲染 |
 * | --- | --- | --- |
 * | 未登录 | `UNAUTHENTICATED` | 「需要先登录」+ 去登录（这是真的不可用） |
 * | 已登录未绑定 | `CAMPUS_BINDING_REQUIRED` | 「还差一步：绑定 X」+ 去绑定（**引导**） |
 * | 本阶段不提供 | — | 如实说明阻塞原因（等待信息办书面回复） |
 *
 * 判定逻辑**不在本文件**，而在纯函数 `resolveCapabilityEntry`
 * （`domain/models/techpie.ts`）—— 于是「引导 vs 报错」是**数据**，
 * 不取决于某个页面写得好不好，并且可以被单测直接钉死。
 */

function entryTone(entry: CampusCapabilityEntry): KdyTagTone {
  if (entry.decision.action === 'GO_BIND') return 'info'
  if (entry.decision.action === 'BLOCKED') return 'neutral'
  if (entry.decision.action === 'SIGN_IN') return 'warning'
  return 'success'
}

function entryTagLabel(entry: CampusCapabilityEntry): string {
  switch (entry.decision.action) {
    case 'SIGN_IN':
      return '未登录'
    case 'GO_BIND':
      return '待绑定'
    case 'BLOCKED':
      return '本阶段不提供'
    case 'OPEN_WEBVIEW':
      return '可直达'
    default:
      return '可用'
  }
}

export default function TechpieCapabilitiesPage() {
  const container = getContainer()
  const capabilities = container.useCases.capabilities
  const bindings = container.useCases.listBindings
  const session = container.useCases.session

  const state = useStore(capabilities)
  const bindingState = useStore(bindings)
  const sessionState = useStore(session)

  // ⚠️ 唯一的「未登录 vs 未绑定」判定入口（见 `campusViewerOf`）
  const viewer = campusViewerOf(sessionState, bindingState.items)
  const entries = capabilities.entries(viewer)
  const unboundCount = capabilities.unboundCount(viewer)

  useDidShow(() => {
    bindings.hydrate()
    capabilities.hydrate()
    void bindings.load()
    void capabilities.load()
  })

  usePullDownRefresh(() => {
    void Promise.all([capabilities.load(), bindings.load()]).then(() => Taro.stopPullDownRefresh())
  })

  function handleOpen(entry: CampusCapabilityEntry): void {
    const { decision, capability, delivery } = entry

    if (decision.action === 'SIGN_IN') {
      toast('请先在「我的」页登录')
      return
    }
    if (decision.action === 'GO_BIND') {
      // 引导：跳到绑定管理页，而不是弹一个错误
      void navigateTo(techpieLinksPath())
      return
    }
    if (decision.action === 'BLOCKED') {
      toast(decision.detail)
      return
    }
    if (delivery === 'webview') {
      // ⚠️ 必须用目录里的 `webviewTargetId`，**不是** `capability.key`：
      // 「学生请假」与「学生活动」两个能力的 key 不同，但都指向同一个 eGate 目标。
      // 用 key 去查目标会查不到，用户会看到一个"未知的校园系统"错误页。
      const targetId = campusCapabilityDefinition(capability.key)?.webviewTargetId ?? null
      if (targetId === null) {
        toast('该能力暂无校园系统入口')
        return
      }
      void navigateTo(techpieWebviewPath(targetId))
      return
    }
    if (campusCapabilityDefinition(capability.key)?.nativeRoute === 'campus-card') {
      void navigateTo(campusCardPath())
      return
    }
    toast('该能力暂无端内页面')
  }

  const mock = container.mockTechpieControls

  function handleSimulateError(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void capabilities.load()
  }

  function handleSimulateEmpty(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void capabilities.load()
  }

  return (
    <View className='kdy-page kdy-techpie-caps'>
      <KdyCampusCredentialNotice compact />

      {unboundCount > 0 && (
        // 引导条：**不是**错误条。文案刻意用「还差一步」而不是「失败」
        <View className='kdy-techpie-caps__guide'>
          <Text className='kdy-techpie-caps__guide-text'>
            还差 {unboundCount} 项：绑定校园系统之后即可使用对应能力（这是正常的初始状态，不是错误）。
          </Text>
          <KdyButton size='sm' onClick={() => void navigateTo(techpieLinksPath())}>
            去绑定
          </KdyButton>
        </View>
      )}

      <View className='kdy-techpie-caps__nav'>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(techpieLinksPath())}>
          绑定管理
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(campusCardPath())}>
          校园卡
        </KdyButton>
      </View>

      {mock !== null && (
        <View className='kdy-techpie-caps__demo'>
          <KdyButton size='sm' variant='ghost' onClick={handleSimulateError}>
            模拟错误态
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleSimulateEmpty}>
            模拟空态
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => mock.reset()}>
            重置演示数据
          </KdyButton>
        </View>
      )}

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在拉取校园能力清单' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => void capabilities.load()}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='没有可展示的校园能力'
          description='服务端返回了空清单。可达鸭不会用本地硬编码的能力清单去填补它 —— 那会让「学校到底给了什么」变得不可信。'
          actionText='重试'
          onAction={() => void capabilities.load()}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {entries.map((entry) => (
            <KdyCard
              key={entry.capability.key}
              elevated={false}
              title={entry.capability.nameZh}
              extra={<KdyTag tone={entryTone(entry)}>{entryTagLabel(entry)}</KdyTag>}
            >
              <View className={`kdy-techpie-caps__item kdy-techpie-caps__item--${entry.decision.action}`}>
                <Text className='kdy-techpie-caps__title'>{entry.decision.title}</Text>
                <Text className='kdy-techpie-caps__detail'>{entry.decision.detail}</Text>

                {entry.capability.requiredProvider !== null && (
                  <Text className='kdy-techpie-caps__provider'>
                    需要：{CAMPUS_PLATFORM_LABELS[entry.capability.requiredProvider]}
                  </Text>
                )}

                {/* GO_BIND 是**引导**：按钮是行动号召，不是「重试」 */}
                {entry.decision.action === 'GO_BIND' && (
                  <View className='kdy-techpie-caps__actions'>
                    <KdyButton size='sm' onClick={() => handleOpen(entry)}>
                      去绑定
                    </KdyButton>
                  </View>
                )}

                {(entry.decision.action === 'OPEN_WEBVIEW' || entry.decision.action === 'OPEN_NATIVE') && (
                  <View className='kdy-techpie-caps__actions'>
                    <KdyButton size='sm' onClick={() => handleOpen(entry)}>
                      {entry.decision.action === 'OPEN_WEBVIEW' ? '打开校园系统' : '进入'}
                    </KdyButton>
                  </View>
                )}

                {entry.decision.action === 'SIGN_IN' && (
                  <View className='kdy-techpie-caps__actions'>
                    <KdyButton size='sm' variant='secondary' onClick={() => handleOpen(entry)}>
                      去登录
                    </KdyButton>
                  </View>
                )}

                {entry.decision.action === 'BLOCKED' && (
                  <Text className='kdy-techpie-caps__blocked'>
                    可达鸭不会为这一项画出可点的入口 —— 没实现的能力不该假装能用。
                  </Text>
                )}
              </View>
            </KdyCard>
          ))}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-techpie-caps__soft-error'>
          刷新失败：{state.error}
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
