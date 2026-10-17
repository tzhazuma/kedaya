import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { techpieLinksPath } from '../../../../app/routes'
import {
  CAMPUS_CARD_OPENID_NOTICE,
  CAMPUS_CARD_PAYMENT_CODE_GAP_NOTICE,
  formatBalance,
  formatTransactionAmount,
  type CampusCardTransaction,
} from '../../../../domain/models/campusCard'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCampusCredentialNotice, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 校园卡页 —— 余额 / 流水 / 付款码（规格 §2.5 / §9.1 Phase 0）。
 *
 * ## 与其它校园能力的根本区别
 *
 * 校园卡走**独立的 OPENID 通道**（规格 §2.5）：它**不依赖 CASTGC**，
 * 因此是 Phase 0 里唯一能拿到**结构化数据**的能力，
 * 而且**零合规风险** —— 我们不需要代持任何校园会话。
 *
 * 绑定它需要的是 `wx.login` 的一次性 code（不是密码、不是 openid）。
 *
 * ## 余额的诚实来源
 *
 * 冻结契约里**没有**独立余额端点。`CampusCardTxn.balanceFen` 是
 * 「该笔交易发生后的余额」，所以最新一笔的它就是当前余额 ——
 * 由 `deriveCardAccount` 推导。页面上会标注余额的取得方式，
 * 而不是假装有一个 `GET /campus-card/balance`。
 *
 * ## 付款码的诚实处理
 *
 * 付款码端点**尚未登记进冻结契约**。页面照常提供按钮，
 * 但把契约缺口**明确写在卡片上**（`CAMPUS_CARD_PAYMENT_CODE_GAP_NOTICE`），
 * 而不是让用户在真后端下对着 404 猜。
 */

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

function TransactionRow({ txn }: { txn: CampusCardTransaction }) {
  const outgoing = txn.amountFen < 0
  return (
    <View className='kdy-card-txn'>
      <View className='kdy-card-txn__main'>
        <Text className='kdy-card-txn__merchant'>{txn.merchant === '' ? '（未知商户）' : txn.merchant}</Text>
        <Text className='kdy-card-txn__time'>{formatTime(txn.occurredAt)}</Text>
      </View>
      <View className='kdy-card-txn__amount'>
        <Text className={`kdy-card-txn__value${outgoing ? ' kdy-card-txn__value--out' : ''}`}>
          {formatTransactionAmount(txn)}
        </Text>
        {txn.balanceFen !== null && (
          <Text className='kdy-card-txn__balance'>余额 ¥{(txn.balanceFen / 100).toFixed(2)}</Text>
        )}
      </View>
    </View>
  )
}

export default function CampusCardPage() {
  const container = getContainer()
  const card = container.useCases.campusCard
  const session = container.useCases.session

  const state = useStore(card)
  const sessionState = useStore(session)
  const authenticated = sessionState.profile !== null && sessionState.tokens !== null

  const [busy, setBusy] = useState(false)

  useDidShow(() => {
    card.hydrate()
    void card.load()
  })

  usePullDownRefresh(() => {
    void card.load().then(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    void card.loadMore()
  })

  async function handleRequestPaymentCode(): Promise<void> {
    if (!authenticated) {
      toast('请先登录')
      return
    }
    setBusy(true)
    try {
      const result = await card.requestPaymentCode()
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`)
        return
      }
      toast('付款码已生成')
    } finally {
      setBusy(false)
    }
  }

  const mock = container.mockTechpieControls

  function handleSimulateError(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    void card.load()
  }

  function handleSimulateEmpty(): void {
    if (mock === null) {
      toast('当前是真实后端模式，无法清空数据')
      return
    }
    mock.clearAll()
    void card.load()
  }

  const expired = card.isPaymentCodeExpired()

  return (
    <View className='kdy-page kdy-card'>
      <KdyCampusCredentialNotice compact text={CAMPUS_CARD_OPENID_NOTICE} title='关于校园卡绑定' />

      <View className='kdy-card__nav'>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateTo(techpieLinksPath())}>
          绑定管理
        </KdyButton>
      </View>

      {/* 余额 —— 由最新一笔流水的 balanceFen 推导 */}
      <KdyCard
        elevated={false}
        title='余额'
        extra={
          <KdyTag tone={state.account.source === 'unavailable' ? 'neutral' : 'success'}>
            {state.account.source === 'latest-transaction' ? '来自最新一笔流水' : '暂不可得'}
          </KdyTag>
        }
      >
        <Text className='kdy-card__balance'>{formatBalance(state.account)}</Text>
        <Text className='kdy-card__balance-note'>
          {state.account.asOf === null
            ? '冻结契约没有独立余额端点；余额由最新一笔流水的「交易后余额」推导，因此没有流水时无法给出余额。'
            : `余额时间点：${formatTime(state.account.asOf)}`}
        </Text>
      </KdyCard>

      {/* 付款码 */}
      <KdyCard
        elevated={false}
        title='付款码'
        extra={
          <KdyTag tone={state.paymentCodeContractRegistered ? 'info' : 'warning'}>
            {state.paymentCodeContractRegistered ? '已登记' : '契约缺口'}
          </KdyTag>
        }
      >
        {!state.paymentCodeContractRegistered && (
          <Text className='kdy-card__gap'>{CAMPUS_CARD_PAYMENT_CODE_GAP_NOTICE}</Text>
        )}

        {state.paymentCodeStatus === 'loading' && <Text className='kdy-card__code'>正在生成…</Text>}

        {state.paymentCodeStatus === 'error' && (
          <Text className='kdy-card__code kdy-card__code--error'>
            {state.paymentCodeError ?? '付款码获取失败'}
          </Text>
        )}

        {state.paymentCode !== null && state.paymentCodeStatus === 'ready' && (
          <View className='kdy-card__code-box'>
            <Text className={`kdy-card__code${expired ? ' kdy-card__code--error' : ''}`}>
              {state.paymentCode.code}
            </Text>
            <Text className='kdy-card__code-note'>
              {expired
                ? '付款码已过期，请重新生成。'
                : `有效至 ${formatTime(state.paymentCode.expiresAt)}`}
            </Text>
          </View>
        )}

        <View className='kdy-card__actions'>
          <KdyButton size='sm' loading={busy} disabled={!authenticated} onClick={() => void handleRequestPaymentCode()}>
            {state.paymentCode === null ? '生成付款码' : '刷新付款码'}
          </KdyButton>
        </View>

        <Text className='kdy-card__code-note'>
          ⚠️ 付款码是一次性的支付凭证，可达鸭**不记录**它（日志里只有它的到期时间）。
        </Text>
      </KdyCard>

      {mock !== null && (
        <View className='kdy-card__demo'>
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

      <Text className='kdy-card__section'>交易流水（{state.transactions.length}）</Text>

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在拉取校园卡流水' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => void card.load()}
        />
      )}

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='没有流水记录'
          description='校园卡还没有交易记录，或者尚未绑定校园卡。'
          actionText='去绑定'
          onAction={() => void navigateTo(techpieLinksPath())}
        />
      )}

      {state.status === 'ready' && (
        <View>
          {state.fromCache && (
            <Text className='kdy-card__hint'>当前展示本地缓存，正在后台刷新…</Text>
          )}
          {state.transactions.map((txn) => (
            <TransactionRow key={txn.id} txn={txn} />
          ))}
          {state.loadingMore && <Text className='kdy-card__hint'>正在加载更多…</Text>}
          {!state.loadingMore && state.nextCursor === null && (
            <Text className='kdy-card__hint'>没有更多了</Text>
          )}
        </View>
      )}

      {state.error !== null && state.status === 'ready' && (
        <Text className='kdy-card__soft-error'>
          后台刷新失败：{state.error}（已继续展示缓存数据，契约 §8 静默降级）
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
