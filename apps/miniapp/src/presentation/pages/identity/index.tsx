import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import {
  CAMPUS_PLATFORM_GAIN,
  CAMPUS_PLATFORM_LABELS,
  CAMPUS_PLATFORM_PURPOSE,
} from '../../../domain/models/identity'
import type { CampusPlatform, CampusPlatformStatus } from '../../../domain/models/identity'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyAgentFab } from '../../components'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../components'
import type { KdyTagTone } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 身份（`auth`）—— 「我和校园系统之间是什么关系」。
 *
 * 这个页面要回答的问题只有一个：**我能用哪些校园数据，怎么才能用上**。
 * 因此它不做"漂亮的个人信息展示"，而是把四个校园系统的状态与能力摆清楚：
 *   已绑定 / 未绑定 / 已过期 + 这个系统能换来什么 + 一键绑定/解绑。
 *
 * 三条设计纪律：
 *   1. **实名默认打码**（契约 §9）：页面加载时只请求脱敏视图；
 *      展开明文是**用户主动动作**，并且页面会先说明"这次查看会被记录审计"；
 *   2. **未绑定不是错误**：空态给的是绑定入口 + 绑了能得到什么，而不是红字报错；
 *   3. **绑定失败可恢复**：错误分类展示（需要重新登录 / 可重试 / 需要重新绑定），
 *      并且不会把已有的绑定状态清空。
 */

function platformStatus(status: CampusPlatformStatus): { label: string; tone: KdyTagTone } {
  if (status.available) return { label: status.simulated ? '已绑定 · 演示' : '已绑定', tone: 'brand' }
  if (status.expired) return { label: '已过期', tone: 'warning' }
  return { label: '未绑定', tone: 'neutral' }
}

/** 绑定到期时间 → `10 月 21 日到期`（只展示日期，不展示时分，减少噪音） */
function expiryLabel(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日到期`
}

export default function IdentityPage() {
  const container = getContainer()
  const identity = container.useCases.campus.identity
  const state = useStore(identity)
  const [revealNoticeShown, setRevealNoticeShown] = useState(false)

  useDidShow(() => {
    // 先 hydrate（同步读缓存，立刻有内容），再后台刷新 —— 契约 §8 时序
    identity.hydrate()
    void identity.load()
  })

  const platforms = state.overview?.platforms ?? []
  const egate = platforms.find((item) => item.platform === 'EGATE')
  const revealed = state.identity !== null && state.identity.masked === false

  async function handleReveal(): Promise<void> {
    if (revealed) {
      await identity.reveal(false)
      return
    }
    // 明文只在用户明确要看时请求，并且如实告知会被记录
    if (!revealNoticeShown) setRevealNoticeShown(true)
    await identity.reveal(true)
    toast('已记录本次查看')
  }

  async function handleToggleBinding(platform: CampusPlatform, available: boolean): Promise<void> {
    const result = available ? await identity.unbind(platform) : await identity.bind(platform)
    if (result.error !== null) {
      toast(result.error)
      return
    }
    toast(available ? `已解绑${CAMPUS_PLATFORM_LABELS[platform]}` : `已绑定${CAMPUS_PLATFORM_LABELS[platform]}`)
  }

  return (
    <View className='kdy-page kdy-identity'>
      <KdyHeading
        title='身份'
        subtitle='登录回答「你是谁」，绑定校园系统才能读到课表、余额与实名信息'
      />

      {state.overview?.dataMode === 'mock' && (
        <View className='kdy-identity__notice'>
          <Text className='kdy-identity__notice-text'>
            校园数据为演示数据，非真实数据。
          </Text>
        </View>
      )}

      {state.status === 'error' && state.overview === null && (
        <KdyCard title='暂时读不到绑定状态'>
          <KdyEmpty
            mode='error'
            title='读取绑定状态失败'
            description={state.error ?? '请稍后重试'}
            actionText='重试'
            onAction={() => void identity.load()}
          />
        </KdyCard>
      )}

      {/* 实名信息：默认脱敏，展开是用户主动动作 */}
      <KdyCard
        title='实名信息'
        extra={
          state.identity === null ? undefined : (
            <KdyTag tone={state.identity.masked ? 'neutral' : 'warning'}>
              {state.identity.masked ? '已打码' : '明文'}
            </KdyTag>
          )
        }
      >
        {state.identity === null ? (
          <Text className='kdy-identity__muted'>
            {egate?.available === true
              ? '实名信息默认以打码形式展示。需要核对时可以展开查看，展开会被记录一条审计日志。'
              : '还没有绑定统一身份认证（EGATE），绑定后可以在这里核对你的学号与院系。'}
          </Text>
        ) : (
          <View className='kdy-identity__facts'>
            {[
              { key: '姓名', value: state.identity.identity.realName },
              { key: '学号', value: state.identity.identity.studentId },
              { key: '院系', value: state.identity.identity.department ?? '未提供' },
              { key: '邮箱', value: state.identity.identity.email ?? '未提供' },
              { key: '校区', value: state.identity.identity.campus ?? '未提供' },
            ].map((fact) => (
              <View key={fact.key} className='kdy-identity__fact'>
                <Text className='kdy-identity__fact-k'>{fact.key}</Text>
                <Text className='kdy-identity__fact-v'>{fact.value}</Text>
              </View>
            ))}
          </View>
        )}

        {egate?.available === true && (
          <View className='kdy-identity__actions'>
            <KdyButton size='sm' variant='ghost' loading={state.revealing} onClick={() => void handleReveal()}>
              {revealed ? '收起重置为打码' : '查看完整信息'}
            </KdyButton>
          </View>
        )}

        {state.revealing === false && revealed && state.identity?.audited === true && (
          <Text className='kdy-identity__muted'>本次查看已写入审计日志，你可以在「我的 → 隐私与数据」里导出查看。</Text>
        )}

        {state.identity?.simulated === true && (
          <Text className='kdy-identity__muted'>以上为演示数据。</Text>
        )}
      </KdyCard>

      {/* 四个校园系统：状态 + 能换来什么 + 绑定入口 */}
      <KdyCard title='校园系统绑定'>
        {platforms.length === 0 && state.status === 'loading' && <Text className='kdy-identity__muted'>正在读取绑定状态…</Text>}
        {platforms.length === 0 && state.status !== 'loading' && (
          <KdyEmpty
            title='还没有绑定任何校园系统'
            description='绑定后可以同步课表、查看校园卡余额，并核对实名信息。'
            actionText='重试'
            onAction={() => void identity.load()}
          />
        )}

        {platforms.map((status) => {
          const tone = platformStatus(status)
          const busy = state.busyPlatform === status.platform
          return (
            <View key={status.platform} className='kdy-identity__platform'>
              <View className='kdy-identity__platform-head'>
                <Text className='kdy-identity__platform-name'>{CAMPUS_PLATFORM_LABELS[status.platform]}</Text>
                <KdyTag tone={tone.tone}>{tone.label}</KdyTag>
              </View>
              <Text className='kdy-identity__platform-purpose'>{CAMPUS_PLATFORM_PURPOSE[status.platform]}</Text>
              <Text className='kdy-identity__muted'>
                {status.available
                  ? (expiryLabel(status.expiresAt) ?? '已绑定')
                  : CAMPUS_PLATFORM_GAIN[status.platform]}
              </Text>
              <View className='kdy-identity__actions'>
                <KdyButton
                  size='sm'
                  variant={status.available ? 'ghost' : 'primary'}
                  loading={busy}
                  onClick={() => void handleToggleBinding(status.platform, status.available)}
                >
                  {status.available ? '解除授权' : status.expired ? '重新绑定' : '绑定'}
                </KdyButton>
              </View>
            </View>
          )
        })}
      </KdyCard>

      {state.error !== null && state.overview !== null && (
        <Text className='kdy-identity__error'>{state.error}</Text>
      )}

      <KdyCard title='为什么需要绑定'>
        <Text className='kdy-identity__p'>
          登录只解决「你是谁」；课表、校园卡、通知属于校园系统里的数据，必须由你逐系统授权后才能读取。
        </Text>
        <Text className='kdy-identity__p'>
          授权凭据在服务端加密保存，本地只留「绑定了哪些系统」这一条状态；解绑后对应数据立即不可读。
        </Text>
        <View className='kdy-identity__actions'>
          <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(PAGE_PATHS.profileSettings)}>
            隐私与数据设置
          </KdyButton>
        </View>
      </KdyCard>

      <KdyAgentFab module='auth' page={PAGE_PATHS.identity} />
    </View>
  )
}
