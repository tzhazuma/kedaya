import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { techpieCapabilitiesPath, campusCardPath } from '../../../../app/routes'
import {
  CAMPUS_PLATFORM_LABELS,
  CAMPUS_PLATFORMS,
  CAMPUS_BINDING_STATUS_LABELS,
  PHASE1_BINDING_BLOCKED_REASON,
  isBindingUsable,
  isPhase0Bindable,
  type CampusBindingSummary,
  type CampusPlatform,
} from '../../../../domain/models/techpie'
import { CAMPUS_CARD_OPENID_NOTICE } from '../../../../domain/models/campusCard'
import { navigateTo, toast } from '../../../../platform/navigation'
import { requestWechatLoginCode } from '../../../../platform/wechatLogin'
import { KdyButton, KdyCampusCredentialNotice, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 绑定管理页（`techpie` 模块入口）—— 规格 §8.1 的 `/techpie/links`。
 *
 * ## 这页要回答的三个问题
 *
 * 1. **我绑了什么？** —— `GET /techpie/links`（响应**不含任何凭证**）；
 * 2. **我还能绑什么？** —— 只有校园卡（契约 §11.18-D：Phase 0 只允许 `ecard`，
 *    其余平台需要代持校园会话，**阻塞于信息办书面回复**）；
 * 3. **绑定会不会把我的校园密码交给可达鸭？** —— **不会**。
 *    校园卡走独立的 **OPENID** 通道，我们拿的是 `wx.login` 的一次性 code，
 *    既不是密码、也不是 openid（openid 由服务端换取）。
 *
 * ## ⚠️ 三个刻意的「不做」
 *
 * | 不做 | 为什么 |
 * | --- | --- |
 * | 不画 Phase 1 平台的「绑定」按钮 | 我们**没实现**那条路径。画出必然失败的按钮是骗用户做无用功 |
 * | 不在客户端存任何校园凭证 | 契约 §11.4 I2 + 规格 §10.3 |
 * | 不注入 cookie | 契约 §11.10-F：小程序 `web-view` 做不到，也不该试 |
 */

function statusTone(status: CampusBindingSummary['status']): KdyTagTone {
  if (isBindingUsable(status)) return 'success'
  if (status === 'EXPIRED') return 'warning'
  if (status === 'FAILED' || status === 'REVOKED') return 'danger'
  return 'neutral'
}

function formatTime(iso: string | null): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function BindingCard({
  binding,
  pending,
  onUnbind,
  onRenew,
}: {
  binding: CampusBindingSummary
  pending: boolean
  onUnbind: (id: string) => void
  onRenew: (id: string) => void
}) {
  const usable = isBindingUsable(binding.status)

  return (
    <KdyCard
      elevated={false}
      title={CAMPUS_PLATFORM_LABELS[binding.provider]}
      extra={<KdyTag tone={statusTone(binding.status)}>{CAMPUS_BINDING_STATUS_LABELS[binding.status]}</KdyTag>}
    >
      <View className='kdy-techpie-binding'>
        <Text className='kdy-techpie-binding__line'>对端标识：{binding.displayName ?? '（未提供）'}</Text>
        <Text className='kdy-techpie-binding__line'>绑定时间：{formatTime(binding.boundAt)}</Text>
        <Text className='kdy-techpie-binding__line'>最近同步：{formatTime(binding.lastSyncAt)}</Text>
        <Text className='kdy-techpie-binding__line'>到期时间：{formatTime(binding.expiresAt)}</Text>

        {binding.phase === 'phase1' ? (
          <Text className='kdy-techpie-binding__warn'>
            该绑定属于 Phase 1（需要代持校园会话）。可达鸭不会续期或刷新它 ——
            这类能力正在等待学校信息办的书面回复。
          </Text>
        ) : null}

        {!usable && (
          <Text className='kdy-techpie-binding__warn'>
            这个绑定当前不可用。重新绑定即可恢复；你的账号本身没有问题（契约 I4）。
          </Text>
        )}

        <View className='kdy-techpie-binding__actions'>
          {binding.provider === 'ecard' && (
            <KdyButton size='sm' variant='ghost' disabled={pending} onClick={() => onRenew(binding.id)}>
              手动续期
            </KdyButton>
          )}
          <KdyButton size='sm' variant='danger' disabled={pending} onClick={() => onUnbind(binding.id)}>
            解绑
          </KdyButton>
        </View>
      </View>
    </KdyCard>
  )
}

export default function TechpieLinksPage() {
  const container = getContainer()
  const bindings = container.useCases.listBindings
  const actions = container.useCases.bindCampus
  const session = container.useCases.session

  const state = useStore(bindings)
  const actionState = useStore(actions)
  const sessionState = useStore(session)

  const [busy, setBusy] = useState(false)
  const authenticated = sessionState.profile !== null && sessionState.tokens !== null

  const ecardBinding = state.items.find((item) => item.provider === 'ecard') ?? null

  useDidShow(() => {
    // 契约 §8 第 1 步（幂等）+ 第 3 步
    bindings.hydrate()
    void bindings.load()
  })

  usePullDownRefresh(() => {
    void bindings.load().then(() => Taro.stopPullDownRefresh())
  })

  async function handleBindEcard(): Promise<void> {
    if (!authenticated) {
      toast('请先登录（「我的」页）')
      return
    }
    setBusy(true)
    try {
      // 只取一次性的 wx.login code；**不取密码**、**不取 openid**
      const login = await requestWechatLoginCode()
      if (!login.ok) {
        toast(`${login.error.code}: ${login.error.message}`)
        return
      }
      const result = await actions.bindEcard({
        channel: 'wechat-openid',
        wechatLoginCode: login.value.code,
      })
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`)
        return
      }
      toast('校园卡绑定成功')
      await bindings.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleUnbind(id: string): Promise<void> {
    const confirmed = await Taro.showModal({
      title: '确认解绑',
      content: '解绑后服务端会删除该绑定的会话副本（不是仅标记失效）。',
      confirmText: '解绑',
    })
    if (!confirmed.confirm) return

    setBusy(true)
    try {
      const result = await actions.unbind(id)
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`)
        return
      }
      toast('已解绑')
      await bindings.load()
    } finally {
      setBusy(false)
    }
  }

  async function handleRenew(id: string): Promise<void> {
    setBusy(true)
    try {
      const result = await actions.renew(id)
      if (!result.ok) {
        // ⚠️ 规格 §10.1 F3：续期不可用时**不谎称已续期**
        toast(`${result.error.code}: ${result.error.message}`)
        return
      }
      toast('续期成功')
      await bindings.load()
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 演示控制（仅 mock） ---------------- */

  const mock = container.mockTechpieControls

  function handleSimulateError(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void bindings.load()
  }

  function handleSimulateEmpty(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void bindings.load()
  }

  function handleSeedBound(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法注入演示数据')
      return
    }
    mock.seedEcardBinding()
    void bindings.load()
  }

  function handleSimulateViolation(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法注入演示数据')
      return
    }
    // 演示契约 I1 的镜像断言：响应里夹带 castgc 时，客户端**拒绝**该条目
    mock.injectForbiddenKeysOnce()
    mock.seedEcardBinding()
    void bindings.load().then(() => toast('已注入一条带 castgc 的响应，客户端应拒绝它'))
  }

  function handleResetDemo(): void {
    mock?.reset()
    void bindings.load()
  }

  const phase1Platforms = CAMPUS_PLATFORMS.filter((platform) => !isPhase0Bindable(platform))

  return (
    <View className='kdy-page kdy-techpie-links'>
      <KdyCampusCredentialNotice compact />

      <View className='kdy-techpie-links__nav'>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(techpieCapabilitiesPath())}>
          校园能力清单
        </KdyButton>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(campusCardPath())}>
          校园卡
        </KdyButton>
      </View>

      {!authenticated && (
        <KdyCard elevated={false} title='还没有登录'>
          <Text className='kdy-techpie-links__hint'>
            未登录与未绑定是**两件不同的事**：未登录时校园能力不可用（UNAUTHENTICATED）；
            登录后如果还没绑定校园系统，那是**合法状态**，我们会引导你去绑定，而不是报错。
          </Text>
        </KdyCard>
      )}

      {/* 发起绑定 —— Phase 0 只有校园卡 */}
      <KdyCard elevated={false} title='发起绑定'>
        <View className='kdy-techpie-links__bind'>
          <Text className='kdy-techpie-links__bind-name'>校园卡（eCard）</Text>
          <KdyTag tone='info'>OPENID 通道</KdyTag>
        </View>
        <Text className='kdy-techpie-links__hint'>{CAMPUS_CARD_OPENID_NOTICE}</Text>

        {ecardBinding !== null && isBindingUsable(ecardBinding.status) ? (
          <Text className='kdy-techpie-links__ok'>校园卡已绑定。</Text>
        ) : (
          <View className='kdy-techpie-links__actions'>
            <KdyButton size='sm' loading={busy} disabled={!authenticated} onClick={() => void handleBindEcard()}>
              {ecardBinding === null ? '绑定校园卡' : '重新绑定校园卡'}
            </KdyButton>
          </View>
        )}

        <View className='kdy-techpie-links__blocked'>
          <Text className='kdy-techpie-links__blocked-title'>
            以下平台本轮**不提供**绑定入口（不是忘了做）
          </Text>
          {phase1Platforms.map((platform: CampusPlatform) => (
            <Text key={platform} className='kdy-techpie-links__blocked-item'>
              · {CAMPUS_PLATFORM_LABELS[platform]}
            </Text>
          ))}
          <Text className='kdy-techpie-links__blocked-reason'>{PHASE1_BINDING_BLOCKED_REASON}</Text>
        </View>
      </KdyCard>

      {/* 演示控制（仅 mock 模式） */}
      {mock !== null && (
        <View className='kdy-techpie-links__demo'>
          <KdyButton size='sm' variant='ghost' onClick={handleSimulateError}>
            模拟错误态
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleSimulateEmpty}>
            模拟空态
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleSeedBound}>
            注入已绑定
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleSimulateViolation}>
            注入带凭证的响应
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleResetDemo}>
            重置演示数据
          </KdyButton>
        </View>
      )}

      <Text className='kdy-techpie-links__section'>我的绑定（{state.items.length}）</Text>

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在拉取绑定列表' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => void bindings.load()}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='还没有绑定任何校园系统'
          description='未绑定是合法状态，不是错误。绑定校园卡即可使用余额、流水与付款码。'
          actionText='重置演示数据'
          onAction={handleResetDemo}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.fromCache && (
            <Text className='kdy-techpie-links__hint'>当前展示本地缓存，正在后台刷新…</Text>
          )}
          {state.items.map((binding) => (
            <BindingCard
              key={binding.id}
              binding={binding}
              pending={busy || actionState.pending !== null}
              onUnbind={(id) => void handleUnbind(id)}
              onRenew={(id) => void handleRenew(id)}
            />
          ))}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-techpie-links__soft-error'>
          后台刷新失败：{state.error}（已继续展示缓存数据，契约 §8 静默降级）
        </Text>
      )}

      {actionState.error !== null && (
        <Text className='kdy-techpie-links__soft-error'>最近一次操作失败：{actionState.error}</Text>
      )}
      {actionState.notice !== null && (
        <Text className='kdy-techpie-links__hint'>{actionState.notice}</Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
