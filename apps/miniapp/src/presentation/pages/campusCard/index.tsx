import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { formatYuan, daysLeftLabel } from '../../../domain/models/campusCard'
import type { CardTransactionView } from '../../../domain/models/campusCard'
import { navigateTo } from '../../../platform/navigation'
import { KdyAgentFab, KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 校园卡（`campus-card`）—— 「我还有多少钱 / 这钱是不是我花的 / 丢了怎么办」。
 *
 * 页面刻意**不**把流水当成主角：先把「余额 + 还能撑几天 + 异常扣款」摆前面，
 * 流水放最后（想核对时再往下翻）。
 *
 * 两条高可用纪律：
 *   1. **绝不显示假余额**：后端返回 `stale: true`（上游挂了、展示缓存）时，
 *      顶部显著提示"这是 X 点的数据"，不会让用户以为 12 元是此刻的真实余额；
 *   2. **挂失不撒谎**：可达鸭对校园卡系统没有写权限，所以挂失面板给的是
 *      "去哪儿办、怎么办"的可执行步骤，而不是一个假的"已挂失"按钮。
 */

function TransactionRow({ tx }: { tx: CardTransactionView }) {
  const outgoing = tx.amountFen < 0
  return (
    <View className='kdy-card-page__tx'>
      <View className='kdy-card-page__tx-body'>
        <Text className='kdy-card-page__tx-merchant'>{tx.merchant}</Text>
        <Text className='kdy-card-page__tx-meta'>{formatMoment(tx.happenedAt)}</Text>
      </View>
      <View className='kdy-card-page__tx-amount'>
        <Text className={outgoing ? 'kdy-card-page__tx-out' : 'kdy-card-page__tx-in'}>{tx.amountLabel}</Text>
        <Text className='kdy-card-page__tx-balance'>余额 {formatYuan(tx.balanceAfterFen)}</Text>
      </View>
    </View>
  )
}

/** `2026-10-17T09:12:00Z` → `10-17 09:12`（页面只展示到分钟） */
function formatMoment(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function CampusCardPage() {
  const container = getContainer()
  const campusCard = container.useCases.campus.campusCard
  const state = useStore(campusCard)
  const [showLostPanel, setShowLostPanel] = useState(false)

  useDidShow(() => {
    campusCard.hydrate()
    void campusCard.load()
  })

  const overview = state.overview

  async function handleLost(): Promise<void> {
    setShowLostPanel(true)
    // 失败也不关闭面板：面板里对"取不到指引"另有兜底文案，用户不会看到空白
    await campusCard.reportLost()
  }

  return (
    <View className='kdy-page kdy-card-page'>
      <KdyHeading
        title='校园卡'
        subtitle='余额与账单，都标着数据时间。'
      />

      {/* 缓存/上游不可用：必须显眼，且说清时间 */}
      {overview?.stale === true && (
        <View className='kdy-card-page__stale'>
          <Text className='kdy-card-page__stale-title'>
            校园卡系统暂时读不到，下面是你上一次成功同步的数据
          </Text>
          <Text className='kdy-card-page__stale-text'>
            {overview.staleReason ?? '上游服务不可用'}
            {overview.syncedAt === null ? '' : ` · 数据时间 ${formatMoment(overview.syncedAt)}`}
          </Text>
          <View className='kdy-card-page__stale-action'>
            <KdyButton size='sm' variant='secondary' onClick={() => void campusCard.load()}>
              重新读取
            </KdyButton>
          </View>
        </View>
      )}

      {state.fromCache && overview !== null && overview.stale === false && (
        <View className='kdy-card-page__stale'>
          <Text className='kdy-card-page__stale-text'>
            还没连上服务端，下拉或点「刷新」试试。
          </Text>
          <View className='kdy-card-page__stale-action'>
            <KdyButton size='sm' variant='secondary' onClick={() => void campusCard.load()}>
              刷新
            </KdyButton>
          </View>
        </View>
      )}

      {overview === null && state.status === 'error' && (
        <KdyCard title='校园卡'>
          <KdyEmpty
            mode='error'
            title='读不到校园卡数据'
            description={state.needsBinding ? '看起来还没有绑定校园卡系统。' : (state.error ?? '请稍后重试')}
            actionText={state.needsBinding ? '去绑定校园卡系统' : '重试'}
            onAction={() => {
              if (state.needsBinding) void navigateTo(PAGE_PATHS.identity)
              else void campusCard.load()
            }}
          />
        </KdyCard>
      )}

      {overview === null && state.status === 'loading' && (
        <KdyCard title='校园卡'>
          <Text className='kdy-card-page__muted'>正在读取余额…</Text>
        </KdyCard>
      )}

      {overview !== null && (
        <>
          {/* 主数字：余额 */}
          <KdyCard>
            <View className='kdy-card-page__balance'>
              <Text className='kdy-card-page__balance-label'>当前余额</Text>
              <Text className='kdy-card-page__balance-value'>{formatYuan(overview.balanceFen)}</Text>
              {overview.lowBalance && <KdyTag tone='warning'>余额偏低，建议充值</KdyTag>}
              {overview.simulated && <KdyTag tone='neutral'>演示数据</KdyTag>}
            </View>
            {daysLeftLabel(overview) !== null && (
              <Text className='kdy-card-page__muted'>{daysLeftLabel(overview)}</Text>
            )}
            <View className='kdy-card-page__facts'>
              <View className='kdy-card-page__fact'>
                <Text className='kdy-card-page__fact-k'>今天支出</Text>
                <Text className='kdy-card-page__fact-v'>
                  {formatYuan(overview.insight.todayOutFen)} · {overview.insight.todayOutCount} 笔
                </Text>
              </View>
              <View className='kdy-card-page__fact'>
                <Text className='kdy-card-page__fact-k'>近 7 天支出</Text>
                <Text className='kdy-card-page__fact-v'>
                  {formatYuan(overview.insight.weekOutFen)} · {overview.insight.weekOutCount} 笔
                </Text>
              </View>
              <View className='kdy-card-page__fact'>
                <Text className='kdy-card-page__fact-k'>数据时间</Text>
                <Text className='kdy-card-page__fact-v'>{formatMoment(overview.dataAsOf)}</Text>
              </View>
            </View>
            <View className='kdy-card-page__actions'>
              <KdyButton size='sm' variant='ghost' onClick={() => void campusCard.load()}>
                刷新
              </KdyButton>
              <KdyButton size='sm' variant='danger' onClick={() => void handleLost()}>
                卡片丢了
              </KdyButton>
            </View>
          </KdyCard>

          {/* 异常扣款：用户最需要的"这钱是不是我花的" */}
          {overview.insight.anomalies.length > 0 && (
            <KdyCard title='可能的异常扣款' extra={<KdyTag tone='danger'>{overview.insight.anomalies.length} 笔</KdyTag>}>
              <Text className='kdy-card-page__muted'>
                这些消费明显高于你的日常水平（中位数 {formatYuan(overview.insight.medianOutFen)}），值得核对一下：
              </Text>
              {overview.insight.anomalies.map((anomaly) => (
                <View key={`${anomaly.merchant}-${anomaly.happenedAt}`} className='kdy-card-page__anomaly'>
                  <Text className='kdy-card-page__anomaly-title'>{anomaly.merchant}</Text>
                  <Text className='kdy-card-page__anomaly-text'>
                    {formatYuan(anomaly.amountFen)} · {formatMoment(anomaly.happenedAt)} · 约为日常的 {anomaly.ratioToMedian.toFixed(1)} 倍
                  </Text>
                </View>
              ))}
              <Text className='kdy-card-page__muted'>
                如果不是你本人消费，请先按下面步骤挂失，再带流水截图到校园卡服务中心申诉。
              </Text>
            </KdyCard>
          )}

          {/* 常去地点：解释"钱花哪了" */}
          {overview.insight.topMerchants.length > 0 && (
            <KdyCard title='消费集中在哪里'>
              {overview.insight.topMerchants.map((merchant) => (
                <View key={merchant.merchant} className='kdy-card-page__fact'>
                  <Text className='kdy-card-page__fact-k'>{merchant.merchant}</Text>
                  <Text className='kdy-card-page__fact-v'>
                    {formatYuan(merchant.totalFen)} · {merchant.count} 笔
                  </Text>
                </View>
              ))}
            </KdyCard>
          )}

          {/* 挂失指引 */}
          {showLostPanel && (
            <KdyCard title='挂失与补办'>
              {state.loadingLost && <Text className='kdy-card-page__muted'>正在获取挂失指引…</Text>}
              {state.lostReport !== null && (
                <>
                  <Text className='kdy-card-page__lost-note'>{state.lostReport.note}</Text>
                  {state.lostReport.steps.map((step, index) => (
                    <View key={step} className='kdy-card-page__lost-step'>
                      <Text className='kdy-card-page__lost-step-index'>{index + 1}</Text>
                      <Text className='kdy-card-page__lost-step-text'>{step}</Text>
                    </View>
                  ))}
                  {state.lostReport.channels.map((channel) => (
                    <View key={channel.name} className='kdy-card-page__lost-channel'>
                      <Text className='kdy-card-page__lost-channel-name'>{channel.name}</Text>
                      <Text className='kdy-card-page__lost-channel-detail'>{channel.detail}</Text>
                    </View>
                  ))}
                  {state.lostReport.audited && (
                    <Text className='kdy-card-page__muted'>本次查看挂失指引已写入审计日志。</Text>
                  )}
                </>
              )}
              {state.lostReport === null && state.loadingLost === false && (
                <Text className='kdy-card-page__muted'>
                  暂时取不到在线指引。可以先到校园卡服务中心或自助终端办理挂失，越快越好 —— 挂失前的消费一般仍由本人承担。
                </Text>
              )}
              <View className='kdy-card-page__actions'>
                <KdyButton size='sm' variant='ghost' onClick={() => setShowLostPanel(false)}>
                  收起
                </KdyButton>
              </View>
            </KdyCard>
          )}

          <KdyCard title='最近流水' extra={<KdyTag tone='neutral'>{overview.transactions.length} 笔</KdyTag>}>
            {overview.transactions.length === 0 ? (
              <Text className='kdy-card-page__muted'>最近没有流水记录。</Text>
            ) : (
              overview.transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
            )}
          </KdyCard>
        </>
      )}

      {state.error !== null && overview !== null && <Text className='kdy-card-page__error'>{state.error}</Text>}

      <KdyAgentFab module='campus-card' page={PAGE_PATHS.campusCard} />
    </View>
  )
}
