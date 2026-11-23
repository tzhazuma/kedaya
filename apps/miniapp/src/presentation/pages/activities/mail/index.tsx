import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { activityDetailPath } from '../../../../app/routes'
import {
  CAMPUS_IMAP_HOST,
  CAMPUS_IMAP_PORT,
  formatMailTime,
  mailAccountFieldErrors,
  mailAccountFormProblem,
  type MailAccountFieldErrors,
  type MailAccountSummary,
  type MailEventItem,
  type MailSyncSummary,
} from '../../../../domain/models/mailActivity'
import { formatActivityInstant, type ActivityItem } from '../../../../domain/models/activity'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { KdyField } from '../../../components/KdyField'
import { KdyHeading } from '../../../components/KdyHeading'
import { buildMailRestore, buildPromoteOutcome } from './mailView'
import './index.scss'

/**
 * 校园邮箱绑定 / 同步入口（复用现成 `/mail` 模块）。
 *
 * 页面只做三件事：绑定（真连一次 IMAP 验证）、同步最近邮件、把一条
 * 归一后的邮件事件提升为候选活动。密码在**提交那一刻**清空，
 * 不留在组件状态里；服务端验证后用 AES-256-GCM 加密保存。
 *
 * 不做假成功：绑定 / 同步失败一律显示后端文案，账户与事件列表保持原状。
 */

function EventCard({
  event,
  busy,
  onPromote,
}: {
  event: MailEventItem
  busy: boolean
  onPromote: () => void
}) {
  const confidenceTone = event.confidence >= 0.8 ? 'success' : event.confidence >= 0.5 ? 'warning' : 'neutral'

  return (
    <KdyCard elevated={false}>
      <View className='kdy-mail-event'>
        <View className='kdy-mail-event__head'>
          <Text className='kdy-mail-event__title'>{event.title}</Text>
          <KdyTag tone={confidenceTone}>{Math.round(event.confidence * 100)}%</KdyTag>
        </View>
        <Text className='kdy-mail-event__time'>
          {formatActivityInstant(event.startsAt, new Date())}
        </Text>
        {event.location !== null || event.organizer !== null ? (
          <Text className='kdy-mail-event__where'>
            {[event.location, event.organizer].filter((value) => value !== null).join(' · ')}
          </Text>
        ) : null}
        {event.matchedText !== '' ? (
          <Text className='kdy-mail-event__evidence'>{event.matchedText}</Text>
        ) : null}
        <View className='kdy-mail-event__foot'>
          {event.stale ? <KdyTag tone='warning'>上次同步结果</KdyTag> : null}
          <KdyButton size='sm' variant='secondary' disabled={busy} onClick={onPromote}>
            提升为候选活动
          </KdyButton>
        </View>
      </View>
    </KdyCard>
  )
}

export default function ActivityMailPage() {
  const mail = getContainer().useCases.mailActivity
  const [account, setAccount] = useState<MailAccountSummary | null>(null)
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<MailEventItem[]>([])
  const [stale, setStale] = useState(false)
  const [syncSummary, setSyncSummary] = useState<MailSyncSummary | null>(null)

  const [email, setEmail] = useState('')
  const [imapHost, setImapHost] = useState(CAMPUS_IMAP_HOST)
  const [imapPort, setImapPort] = useState(String(CAMPUS_IMAP_PORT))
  const [password, setPassword] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [binding, setBinding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoted, setPromoted] = useState<ActivityItem[]>([])
  const [attempted, setAttempted] = useState(false)

  const fieldErrors: MailAccountFieldErrors = mailAccountFieldErrors({
    email,
    imapHost,
    imapPort: Number(imapPort),
    password,
  })

  async function restore(): Promise<void> {
    const result = await mail.events()
    const restored = buildMailRestore(result)
    if (!restored.ok) {
      setError(restored.error)
      return
    }
    setError(null)
    setEvents(restored.events)
    setStale(restored.stale)
    if (restored.connected) setConnected(true)
  }

  useDidShow(() => {
    void restore()
  })

  async function runSync(): Promise<void> {
    setSyncing(true)
    setError(null)
    try {
      const result = await mail.sync()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setConnected(true)
      setEvents(result.value.items)
      setStale(result.value.stale)
      setSyncSummary(result.value.sync)
      setAccount((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              lastSyncAt: result.value.sync.lastSyncAt,
              status: result.value.stale ? 'stale' : 'active',
            },
      )
      setNotice(
        `同步完成：扫描 ${result.value.sync.scanned} 封，识别 ${result.value.sync.matched} 条活动，新增 ${result.value.sync.stored} 条。`,
      )
    } finally {
      setSyncing(false)
    }
  }

  async function handleBind(): Promise<void> {
    if (binding) return
    const port = Number(imapPort)
    setAttempted(true)
    const problem = mailAccountFormProblem({ email, imapHost, imapPort: port, password })
    setError(problem)
    setNotice(null)
    if (problem !== null) return

    setBinding(true)
    // 密码只用于这一次提交；请求一发出就从组件状态里清掉（失败也不保留）
    const pending = mail.bind({ email, imapHost, imapPort: port, password })
    setPassword('')
    try {
      const result = await pending
      if (!result.ok) {
        setError(result.error.message)
        return
      }

      setAttempted(false)
      setAccount(result.value)
      setConnected(true)
      setNotice('绑定成功。密码已交给服务端加密保存，客户端不留密码；正在同步最近邮件…')
      const synced = await mail.sync()
      if (!synced.ok) {
        setError(synced.error.message)
        return
      }
      setEvents(synced.value.items)
      setStale(synced.value.stale)
      setSyncSummary(synced.value.sync)
      setAccount((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              lastSyncAt: synced.value.sync.lastSyncAt,
              status: synced.value.stale ? 'stale' : 'active',
            },
      )
      setNotice(
        `绑定并同步完成：识别 ${synced.value.sync.matched} 条活动，新增 ${synced.value.sync.stored} 条。`,
      )
    } finally {
      setBinding(false)
    }
  }

  async function handleUnlink(): Promise<void> {
    const confirmed = await Taro.showModal({
      title: '解绑校园邮箱？',
      content: '服务端会硬删邮箱凭证与该邮箱归一出的活动；这一步不可撤销。',
      confirmText: '解绑',
      confirmColor: '#d94f4f',
    })
    if (!confirmed.confirm) return

    const result = await mail.unlink()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setAccount(null)
    setConnected(false)
    setEvents([])
    setStale(false)
    setSyncSummary(null)
    setPassword('')
    setNotice('已解绑校园邮箱，凭证与派生活动已从服务端删除。')
  }

  async function handlePromote(event: MailEventItem): Promise<void> {
    if (promotingId !== null) return
    setPromotingId(event.id)
    setError(null)
    setNotice(null)
    setPromoted([])
    try {
      const result = await mail.promote(event.id)
      const outcome = buildPromoteOutcome(result)
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      setPromoted(outcome.items)
      setNotice(outcome.notice)
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <View className='kdy-page kdy-mail'>
      <KdyHeading
        title='校园邮箱'
        subtitle='只读同步最近邮件里的活动信息；不存邮件正文与附件。'
      />

      {account === null && !connected ? (
        <KdyCard title='绑定校园邮箱' elevated={false}>
          <KdyField
            label='校园邮箱'
            name='email'
            required
            value={email}
            onChange={(value) => {
              setEmail(value)
              setAttempted(false)
            }}
            error={attempted ? fieldErrors.email ?? null : null}
            placeholder='name@shanghaitech.edu.cn'
            maxLength={320}
            hint='仅支持 @shanghaitech.edu.cn / @stu.shanghaitech.edu.cn'
          />
          <KdyField
            label='IMAP 服务器'
            name='imapHost'
            required
            value={imapHost}
            onChange={(value) => {
              setImapHost(value)
              setAttempted(false)
            }}
            error={attempted ? fieldErrors.imapHost ?? null : null}
            placeholder={CAMPUS_IMAP_HOST}
            maxLength={255}
            hint='学校 IMAP 主机，必须在校内域名下'
          />
          <KdyField
            label='端口'
            name='imapPort'
            type='number'
            required
            value={imapPort}
            onChange={(value) => {
              setImapPort(value)
              setAttempted(false)
            }}
            error={attempted ? fieldErrors.imapPort ?? null : null}
            placeholder='993'
            hint='默认 993（TLS）'
          />
          <KdyField
            label='客户端专用密码'
            name='password'
            required
            value={password}
            onChange={(value) => {
              setPassword(value)
              setAttempted(false)
            }}
            error={attempted ? fieldErrors.password ?? null : null}
            placeholder='邮箱设置里生成的客户端专用密码'
            password
            maxLength={1024}
            hint='不是网页登录密码。服务端验证后立即用 AES-256-GCM 加密保存，客户端不留密码。'
          />

          <View className='kdy-mail__actions'>
            <KdyButton block loading={binding} onClick={() => void handleBind()}>
              绑定并同步
            </KdyButton>
            <KdyButton
              block
              variant='secondary'
              loading={syncing}
              disabled={binding}
              onClick={() => void runSync()}
            >
              我已绑定过，直接同步
            </KdyButton>
          </View>
        </KdyCard>
      ) : (
        <KdyCard
          title={account === null ? '已连接' : '已绑定'}
          extra={
            <KdyTag tone='success'>
              {account !== null && account.status !== 'active' ? '上次同步失败' : '正常'}
            </KdyTag>
          }
        >
          {account !== null ? (
            <>
              <Text className='kdy-mail__line'>{account.email}</Text>
              <Text className='kdy-mail__muted'>
                {account.imapHost}:{account.imapPort} · 最近同步 {formatMailTime(account.lastSyncAt)}
              </Text>
            </>
          ) : (
            <Text className='kdy-mail__muted'>
              同步成功，但本机没有记录邮箱地址。可继续同步，或解绑后重新绑定以查看账户信息。
            </Text>
          )}
          <View className='kdy-mail__actions'>
            <KdyButton block loading={syncing} disabled={binding} onClick={() => void runSync()}>
              同步最近邮件
            </KdyButton>
            <KdyButton block variant='ghost' onClick={() => void handleUnlink()}>
              解绑并删除派生活动
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {stale ? (
        <View
          className='kdy-mail__warn'
          aria-label='上次同步失败，下面显示的是上一次成功同步的结果。'
        >
          上次同步失败，下面显示的是上一次成功同步的结果。
        </View>
      ) : null}

      {syncSummary !== null ? (
        <Text className='kdy-mail__muted kdy-mail__summary'>
          扫描 {syncSummary.scanned} 封 · 识别 {syncSummary.matched} 条 · 新增 {syncSummary.stored} 条
        </Text>
      ) : null}

      {notice !== null ? (
        <View className='kdy-mail__ok' aria-label={notice}>
          {notice}
        </View>
      ) : null}
      {error !== null ? (
        <View className='kdy-mail__error' aria-label={error}>
          {error}
        </View>
      ) : null}

      {promoted.length > 0 ? (
        <KdyCard title='已提升的候选活动' elevated={false}>
          <Text className='kdy-mail__muted'>
            服务端返回了 {promoted.length} 条候选；逐条确认后才加入日程。
          </Text>
          <View className='kdy-mail__list' aria-role='list'>
            {promoted.map((item) => (
              <View key={item.id} className='kdy-mail__promoted' aria-role='listitem'>
                <Text className='kdy-mail-event__title'>{item.title}</Text>
                <KdyButton
                  size='sm'
                  variant='secondary'
                  onClick={() => void navigateTo(activityDetailPath(item.id))}
                >
                  查看并确认
                </KdyButton>
              </View>
            ))}
          </View>
        </KdyCard>
      ) : null}

      <View className='kdy-mail__section'>
        <Text className='kdy-mail__section-title'>识别出的活动</Text>
        {events.length === 0 ? (
          <KdyEmpty
            title='还没有识别出的活动'
            description='绑定后点「同步最近邮件」；只有能识别出时间与标题的邮件才会出现在这里。'
          />
        ) : (
          <View className='kdy-mail__list' aria-role='list'>
            {events.map((event) => (
              <View key={event.id} aria-role='listitem'>
                <EventCard
                  event={event}
                  busy={promotingId !== null}
                  onPromote={() => void handlePromote(event)}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。只读收信，不发信；不保存邮件正文与附件。
      </Text>
    </View>
  )
}
