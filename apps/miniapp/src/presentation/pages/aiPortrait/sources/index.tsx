import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro'
import { useMemo, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { AI_PORTRAIT_CATALOG_ID } from '../../../../application/aiPortrait/aiPortraitUseCases'
import {
  AI_PORTRAIT_DISCLAIMER,
  AI_PORTRAIT_EXCLUSION_TEXT,
  AI_PORTRAIT_REVOKE_NOTICE,
  AI_PORTRAIT_SENSITIVITY_LABEL,
  AI_PORTRAIT_TWO_SWITCH_NOTE,
  FORBIDDEN_PORTRAIT_SOURCES,
} from '../../../../domain/models/aiPortrait'
import type { PortraitSourceDescriptor } from '../../../../domain/models/aiPortrait'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * AI 校园画像 · 数据来源与开关。
 *
 * 这一页存在的唯一理由：让「这份画像是怎么来的」**可核对**。
 * 它按用户会问的顺序说清四件事：
 *
 *   1. **哪类数据用在哪** —— 直出后端 `GET /sources` 的清单，不在这里另写一份；
 *   2. **哪类数据被排除、为什么** —— 心理支持与宿舍矛盾，附排除理由；
 *   3. **现在真的用到了吗** —— 如实写「尚未接入任何一类数据」（`generation`），
 *      而不是把"将来会用到"说成"已经在用"；
 *   4. **两层开关的区别** —— 本页开关管"要不要看到"，
 *      「我的 → 隐私与数据」里的 AI 画像开关管"是否允许生成"，互相独立。
 *
 * 排除声明**不走接口**（用客户端常量渲染）：接口失败、离线、未同意时它都必须显示得出来。
 *
 * 从首页某条标签点「来源」进来时会带 `?highlight=id1,id2`，
 * 对应的行会被高亮 —— 用户此刻问的是"**这一条**是怎么来的"，
 * 不该让他自己在一张十几行的表里找。
 */

/** `?highlight=canteen,schedule` → id 集合 */
function parseHighlight(params: Record<string, string | undefined>): Set<string> {
  const raw = params.highlight
  if (raw === undefined || raw === '') return new Set()
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
}

function SourceRow({
  source,
  highlighted,
}: {
  source: PortraitSourceDescriptor
  highlighted: boolean
}) {
  const classes = ['kdy-portrait-sources__row', highlighted ? 'kdy-portrait-sources__row--on' : '']
    .filter((item) => item !== '')
    .join(' ')

  return (
    <View className={classes}>
      <View className='kdy-portrait-sources__head'>
        <Text className='kdy-portrait-sources__name'>{source.nameZh}</Text>
        <View className='kdy-portrait-sources__tags'>
          {highlighted && <KdyTag tone='brand'>本条用到了</KdyTag>}
          <KdyTag tone={source.allowed ? 'neutral' : 'danger'}>
            {source.allowed ? (source.connected ? '已接入' : '尚未接入') : '已排除'}
          </KdyTag>
        </View>
      </View>
      <Text className='kdy-portrait-sources__usage'>{source.usage}</Text>
      {source.exclusionReason !== undefined && (
        <Text className='kdy-portrait-sources__exclusion'>{source.exclusionReason}</Text>
      )}
    </View>
  )
}

export default function AiPortraitSourcesPage() {
  const container = getContainer()
  const aiPortrait = container.useCases.aiPortrait
  const state = useStore(aiPortrait.sources)
  const router = useRouter()

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const highlighted = useMemo(
    () => parseHighlight(router.params as Record<string, string | undefined>),
    [router.params],
  )

  useDidShow(() => {
    void aiPortrait.sources.load(AI_PORTRAIT_CATALOG_ID)
  })

  usePullDownRefresh(() => {
    void aiPortrait.sources.load(AI_PORTRAIT_CATALOG_ID).then(() => Taro.stopPullDownRefresh())
  })

  async function revoke(): Promise<void> {
    const confirmed = await Taro.showModal({
      title: '撤回同意？',
      content: AI_PORTRAIT_REVOKE_NOTICE,
      confirmText: '撤回',
    })
    if (!confirmed.confirm) return

    setBusy(true)
    setActionError(null)
    const result = await aiPortrait.revokeConsent()
    setBusy(false)
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    toast('已撤回同意', 'success')
  }

  const payload = state.data

  return (
    <View className='kdy-page kdy-portrait-sources'>
      <KdyHeading
        title='数据来源与开关'
        subtitle='这份画像用到哪些数据、哪些数据被排除，以及两个开关的区别。'
      />

      <KdyCard
        title='两层开关（互相独立）'
        extra={<KdyTag tone='danger'>{AI_PORTRAIT_SENSITIVITY_LABEL}</KdyTag>}
      >
        <Text className='kdy-portrait-sources__p'>{AI_PORTRAIT_TWO_SWITCH_NOTE}</Text>
        <Text className='kdy-portrait-sources__p'>{AI_PORTRAIT_REVOKE_NOTICE}</Text>
        {actionError !== null && <Text className='kdy-portrait-sources__error'>{actionError}</Text>}
        <View className='kdy-portrait-sources__actions'>
          <KdyButton size='sm' variant='danger' loading={busy} onClick={() => void revoke()}>
            撤回同意
          </KdyButton>
        </View>
      </KdyCard>

      {(state.status === 'idle' || state.status === 'loading') && <KdyEmpty mode='loading' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到来源清单'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void aiPortrait.sources.load(AI_PORTRAIT_CATALOG_ID)}
        />
      )}

      {state.status === 'ready' && payload !== null && (
        <KdyCard title='哪类数据 → 用在哪'>
          <Text className='kdy-portrait-sources__usage-note'>
            {payload.generation.implemented
              ? `已接入 ${String(payload.generation.connectedSources)} 类数据。`
              : payload.generation.note}
          </Text>
          <View className='kdy-portrait-sources__list'>
            {payload.catalog.map((source) => (
              <SourceRow key={source.id} source={source} highlighted={highlighted.has(source.id)} />
            ))}
          </View>
          <Text className='kdy-portrait-sources__rule'>{payload.explainability}</Text>
        </KdyCard>
      )}

      {/* 排除声明不走接口：接口失败 / 离线时也必须看得到 */}
      <KdyCard title='不参与画像的数据' extra={<KdyTag tone='danger'>已排除</KdyTag>}>
        <Text className='kdy-portrait-sources__p'>{AI_PORTRAIT_EXCLUSION_TEXT}</Text>
        {FORBIDDEN_PORTRAIT_SOURCES.map((source) => (
          <View key={source.id} className='kdy-portrait-sources__row'>
            <View className='kdy-portrait-sources__head'>
              <Text className='kdy-portrait-sources__name'>{source.nameZh}</Text>
              {highlighted.has(source.id) && <KdyTag tone='brand'>本条用到了</KdyTag>}
            </View>
            <Text className='kdy-portrait-sources__exclusion'>{source.reason}</Text>
          </View>
        ))}
      </KdyCard>

      <Text className='kdy-disclaimer'>{AI_PORTRAIT_DISCLAIMER}</Text>
    </View>
  )
}
