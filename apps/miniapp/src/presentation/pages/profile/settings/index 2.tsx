import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PRIVACY_TOGGLES, SENSITIVITY_LABELS } from '../../../../domain/models/privacy'
import type { ConsentView, PrivacySettings } from '../../../../domain/models/privacy'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 隐私与数据（`profile → 隐私与数据`）—— 契约 §9 三项用户权利的落地页。
 *
 *   ① 开关：AI 画像 / 展示实名 / 心理 / 宿舍矛盾 —— 默认全关，开与关都即时生效；
 *   ② 同意：敏感模块逐个授权、**随时撤回**，并显示"哪些模块我还没授权"；
 *   ③ 数据可携：导出账号档案（账号 + 开关 + 同意 + 内容条数 + 审计摘要）。
 *
 * 与其他模块**相反**的一条纪律：设置类写入不做乐观更新 ——
 * "以为关掉了其实没关"是不可接受的，所以一律等服务端确认后才改本地状态，
 * 期间在开关旁显示"保存中…"，失败则保持原状并明确报错。
 */

/** 四个隐私开关的 key（从 `PRIVACY_TOGGLES` 推导，避免两处各写一份） */
type ToggleKey = (typeof PRIVACY_TOGGLES)[number]['key']

function Toggle({
  on,
  busy,
  onToggle,
}: {
  on: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <View
      className={['kdy-privacy__toggle', on ? 'kdy-privacy__toggle--on' : '', busy ? 'kdy-privacy__toggle--busy' : '']
        .filter((item) => item !== '')
        .join(' ')}
      onClick={() => {
        if (!busy) onToggle()
      }}
    >
      <View className='kdy-privacy__knob' />
    </View>
  )
}

function ConsentRow({
  consent,
  busy,
  timeLabel,
  onGrant,
  onRevoke,
}: {
  consent: ConsentView
  busy: boolean
  timeLabel: string
  onGrant: () => void
  onRevoke: () => void
}) {
  return (
    <View className='kdy-privacy__consent'>
      <View className='kdy-privacy__consent-head'>
        <Text className='kdy-privacy__consent-name'>{consent.nameZh}</Text>
        <KdyTag tone={consent.active ? 'success' : 'neutral'}>{consent.active ? '已授权' : '未授权'}</KdyTag>
      </View>
      {consent.summary !== '' && <Text className='kdy-privacy__consent-summary'>{consent.summary}</Text>}
      <View className='kdy-privacy__consent-foot'>
        <Text className='kdy-privacy__consent-meta'>
          {SENSITIVITY_LABELS[consent.sensitivity] ?? consent.sensitivity} · {timeLabel}
        </Text>
        <KdyButton
          size='sm'
          variant={consent.active ? 'ghost' : 'primary'}
          loading={busy}
          onClick={consent.active ? onRevoke : onGrant}
        >
          {consent.active ? '撤回同意' : '同意并开启'}
        </KdyButton>
      </View>
    </View>
  )
}

export default function PrivacySettingsPage() {
  const container = getContainer()
  const privacy = container.useCases.privacy
  const state = useStore(privacy)
  const [showExport, setShowExport] = useState(false)

  useDidShow(() => {
    privacy.hydrate()
    void privacy.load()
  })

  const settings: PrivacySettings | null = state.settings

  async function handleToggle(key: ToggleKey, next: boolean): Promise<void> {
    const patch: Partial<Record<ToggleKey, boolean>> = { [key]: next }
    const result = await privacy.updateSetting(patch)
    toast(result.ok ? result.message : `保存失败：${result.message}`)
  }

  async function handleConsent(consent: ConsentView): Promise<void> {
    const result = consent.active ? await privacy.revoke(consent.module) : await privacy.grant(consent.module)
    toast(result.ok ? result.message : `操作失败：${result.message}`)
  }

  async function handleExport(): Promise<void> {
    setShowExport(true)
    const result = await privacy.exportData()
    if (!result.ok) toast(`导出失败：${result.message}`)
  }

  const exported = state.exportResult

  return (
    <View className='kdy-page kdy-privacy'>
      <KdyHeading
        title='隐私与数据'
        subtitle='开关与同意随时可改、可撤回；你的数据你说了算'
        eyebrow='KEDAYA · 我的'
      />

      {state.status === 'error' && settings === null && (
        <KdyCard title='隐私设置'>
          <KdyEmpty
            mode='error'
            title='读不到隐私设置'
            description={state.error ?? '请稍后重试'}
            actionText='重试'
            onAction={() => void privacy.load()}
          />
        </KdyCard>
      )}

      {/* ① 开关 */}
      <KdyCard title='隐私开关' extra={state.busyKey !== null ? <KdyTag tone='warning'>保存中…</KdyTag> : undefined}>
        {settings === null && state.status === 'loading' && <Text className='kdy-privacy__muted'>正在读取…</Text>}
        {settings !== null &&
          PRIVACY_TOGGLES.map((toggle) => (
            <View key={toggle.key} className='kdy-privacy__row'>
              <View className='kdy-privacy__row-body'>
                <Text className='kdy-privacy__row-title'>{toggle.title}</Text>
                <Text className='kdy-privacy__row-detail'>{toggle.detail}</Text>
              </View>
              <Toggle
                on={settings[toggle.key]}
                busy={state.busyKey === toggle.key}
                onToggle={() => void handleToggle(toggle.key, !settings[toggle.key])}
              />
            </View>
          ))}
        {settings !== null && (
          <Text className='kdy-privacy__muted'>
            关闭后立即生效：相关模块不可用，已有数据不再被读取（不会被删除，撤回前你可以随时重新开启）。
          </Text>
        )}
      </KdyCard>

      {/* ② 同意管理 */}
      <KdyCard title='敏感模块同意'>
        {state.consents.length === 0 && state.status !== 'loading' && (
          <Text className='kdy-privacy__muted'>当前没有需要二次同意的模块。</Text>
        )}
        {state.consents
          .filter((consent) => consent.gated)
          .map((consent) => (
            <ConsentRow
              key={consent.module}
              consent={consent}
              busy={state.busyKey === consent.module}
              timeLabel={privacy.consentLabel(consent)}
              onGrant={() => void handleConsent(consent)}
              onRevoke={() => void handleConsent(consent)}
            />
          ))}
        <Text className='kdy-privacy__muted'>
          撤回同意是幂等的：重复撤回不会报错，撤回后该模块的记录不会进入任何通用画像或分析。
        </Text>
      </KdyCard>

      {/* ③ 数据导出 */}
      <KdyCard title='导出我的数据'>
        <Text className='kdy-privacy__row-detail'>
          生成一份包含账号信息、隐私开关、同意记录、各模块内容条数与审计摘要的档案，供你核对或带走。
        </Text>
        <View className='kdy-privacy__actions'>
          <KdyButton size='sm' loading={state.exporting} onClick={() => void handleExport()}>
            {showExport && exported !== null ? '重新生成' : '生成导出'}
          </KdyButton>
        </View>

        {state.exportError !== null && <Text className='kdy-privacy__error'>{state.exportError}</Text>}

        {showExport && exported !== null && (
          <View className='kdy-privacy__export'>
            <Text className='kdy-privacy__export-meta'>{privacy.exportLabel()}</Text>

            {exported.account !== null && (
              <View className='kdy-privacy__export-block'>
                <Text className='kdy-privacy__export-title'>账号</Text>
                <Text className='kdy-privacy__export-line'>昵称：{exported.account.displayName}</Text>
                <Text className='kdy-privacy__export-line'>
                  登录方式：{exported.account.identities.map((item) => item.provider).join('、') || '—'}
                </Text>
                <Text className='kdy-privacy__export-line'>
                  校园绑定：{exported.account.campusBindings.map((item) => `${item.platform}(${item.status})`).join('、') || '无'}
                </Text>
              </View>
            )}

            <View className='kdy-privacy__export-block'>
              <Text className='kdy-privacy__export-title'>同意记录（{exported.consents.length}）</Text>
              {exported.consents.length === 0 && <Text className='kdy-privacy__export-line'>无</Text>}
              {exported.consents.map((consent) => (
                <Text key={consent.module} className='kdy-privacy__export-line'>
                  {consent.nameZh} · v{consent.version} · {consent.revokedAt === null ? '有效' : '已撤回'}
                </Text>
              ))}
            </View>

            <View className='kdy-privacy__export-block'>
              <Text className='kdy-privacy__export-title'>我的内容</Text>
              {exported.content.length === 0 && <Text className='kdy-privacy__export-line'>无</Text>}
              {exported.content.map((item) => (
                <Text key={item.module} className='kdy-privacy__export-line'>
                  {item.nameZh}：{item.count} 条
                </Text>
              ))}
            </View>

            <View className='kdy-privacy__export-block'>
              <Text className='kdy-privacy__export-title'>敏感读取审计</Text>
              <Text className='kdy-privacy__export-line'>共 {exported.audit.total} 条记录</Text>
              {exported.audit.recent.slice(0, 5).map((entry) => (
                <Text key={`${entry.action}-${entry.at}`} className='kdy-privacy__export-line'>
                  {entry.action} · {entry.module ?? '—'} · {entry.resource}
                </Text>
              ))}
            </View>

            <Text className='kdy-privacy__muted'>{exported.note}</Text>
          </View>
        )}
      </KdyCard>

      {/* 说明：这一页是"权利"，不是"设置堆放" */}
      <KdyCard title='关于这些设置'>
        <Text className='kdy-privacy__row-detail'>
          体检、心理、宿舍矛盾等敏感数据与其它模块物理隔离，不进入通用画像，也不会被可达鸭检索。
        </Text>
        <Text className='kdy-privacy__row-detail'>
          实名信息默认在服务端打码；展开明文属于"高敏感读取"，会写一条审计日志，你可以在上面的导出里看到。
        </Text>
        <View className='kdy-privacy__chips'>
          <KdyChip>最小采集</KdyChip>
          <KdyChip>可撤回</KdyChip>
          <KdyChip>可导出</KdyChip>
          <KdyChip>读取留痕</KdyChip>
        </View>
      </KdyCard>
    </View>
  )
}
