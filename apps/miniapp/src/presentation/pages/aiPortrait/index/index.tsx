import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import {
  AI_PORTRAIT_CATALOG_ID,
  AI_PORTRAIT_VIEW_ID,
} from '../../../../application/aiPortrait/aiPortraitUseCases'
import {
  AI_PORTRAIT_CONSENT_INTRO,
  AI_PORTRAIT_CONSENT_POINTS,
  AI_PORTRAIT_DECLINED_TEXT,
  AI_PORTRAIT_DISABLE_NOTICE,
  AI_PORTRAIT_DISCLAIMER,
  AI_PORTRAIT_EMPTY_TIP,
  AI_PORTRAIT_EMPTY_TITLE,
  AI_PORTRAIT_EXCLUSION_TEXT,
  AI_PORTRAIT_LOGIN_TIP,
  AI_PORTRAIT_POSITIONING,
  AI_PORTRAIT_REVOKE_NOTICE,
  AI_PORTRAIT_SENSITIVITY_LABEL,
  AI_PORTRAIT_TWO_SWITCH_NOTE,
  FORBIDDEN_PORTRAIT_SOURCES,
} from '../../../../domain/models/aiPortrait'
import type { PortraitTraitView } from '../../../../domain/models/aiPortrait'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * AI 校园画像 · 首页（**只读**）。
 *
 * ## 为什么这个模块不是「列表 → 发布 → 详情」
 *
 * 契约 §7 的三页结构服务的是**用户自己发布的内容**：列表（有别人的东西）→ 发布
 * （我产出一条）→ 详情（把一条东西展开）。画像三样都不成立：
 *
 *   · **没有列表**：画像永远按主体寻址，不存在"看别人的画像"的合法路径；
 *     后端也没有可分页的画像列表端点（真做出来就是隐私缺陷）。
 *   · **没有发布**：客户端**不允许编造标签**。`POST /items` 只给受信的服务端生成流程用，
 *     小程序端口连 `upsert` 都不开。
 *   · **没有详情**：一个具体诉求"我想知道为什么给我这个结论"由**来源页**回答，
 *     而不是把一条标签展开成一页。
 *
 * 所以本模块只有两页：**画像首页**（本页）+ **数据来源与开关**。这是刻意的偏离，
 * 不是漏做了两页。
 *
 * ## 三道门与三条纪律
 *
 * 顺序不能换：**登录 → 二次同意 → 读画像**。界面上对应三种"还没到主内容"的形态：
 * 登录引导、同意门（可"暂时不用"）、同意之后的主内容（loading / empty / error 三态齐全）。
 *
 *   · 心理支持 / 宿舍矛盾**不参与画像** —— 这句在同意门里、首页里、来源页里各出现一次：
 *     它是这个模块能不能被信任的前提，不能藏进二级页。
 *   · 说得清来源的标签才展示；说不清的被视图层丢弃，页面对丢弃条数如实说明。
 *   · 不做评价、不做预测、不做心理评估：全部文案停在"使用记录的聚合统计"。
 */

/** 一条标签：结论 + 它自己的来源（来源名就地可见；「来源」入口去来源页看全貌） */
function TraitCard({ trait }: { trait: PortraitTraitView }) {
  return (
    <View className='kdy-portrait__trait'>
      <Text className='kdy-portrait__trait-label'>{trait.label}</Text>
      {trait.detail !== null && <Text className='kdy-portrait__trait-detail'>{trait.detail}</Text>}
      <View className='kdy-portrait__trait-foot'>
        <View className='kdy-portrait__trait-sources'>
          {trait.sources.map((source) => (
            <KdyTag key={source.id} tone='neutral'>
              {source.nameZh}
            </KdyTag>
          ))}
        </View>
        <KdyChip
          onClick={() => {
            const ids = trait.sources.map((source) => source.id).join(',')
            void navigateTo(`${PAGE_PATHS.aiPortraitSources}?highlight=${encodeURIComponent(ids)}`)
          }}
        >
          来源
        </KdyChip>
      </View>
    </View>
  )
}

/** 「不参与画像」的两类数据：接口失败、离线、未同意时都必须显示得出来 */
function ExcludedSources() {
  return (
    <KdyCard title='这两类数据不参与画像' extra={<KdyTag tone='danger'>已排除</KdyTag>}>
      <Text className='kdy-portrait__p'>{AI_PORTRAIT_EXCLUSION_TEXT}</Text>
      {FORBIDDEN_PORTRAIT_SOURCES.map((source) => (
        <View key={source.id} className='kdy-portrait__excluded'>
          <Text className='kdy-portrait__excluded-name'>{source.nameZh}</Text>
          <Text className='kdy-portrait__excluded-reason'>{source.reason}</Text>
        </View>
      ))}
    </KdyCard>
  )
}

export default function AiPortraitPage() {
  const container = getContainer()
  const aiPortrait = container.useCases.aiPortrait
  const state = useStore(aiPortrait.portrait)
  const session = useStore(container.useCases.session)

  const [consented, setConsented] = useState(() => aiPortrait.hasConsented())
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const loggedIn = session.tokens !== null
  const view = state.data === null ? null : state.data.view
  const hasProfile = state.data !== null && state.data.hasProfile

  /** 主内容加载：三道门都在用例里，这里只负责"该不该发这次请求" */
  async function load(): Promise<void> {
    aiPortrait.syncViewer()
    if (container.useCases.session.getSnapshot().tokens === null) return
    // 未同意时不发请求：否则只会拿到一串同义的 CONSENT_REQUIRED，而我们本来就要显示同意门
    if (!aiPortrait.hasConsented()) return
    await aiPortrait.portrait.load(AI_PORTRAIT_VIEW_ID)
  }

  function loadCatalog(): void {
    // 公开端点：不依赖登录与同意 —— "哪类数据用在哪、哪类被排除"必须永远说得出
    void aiPortrait.sources.load(AI_PORTRAIT_CATALOG_ID)
  }

  useDidShow(() => {
    setConsented(aiPortrait.hasConsented())
    loadCatalog()
    void load()
  })

  usePullDownRefresh(() => {
    loadCatalog()
    void (async () => {
      await load()
      Taro.stopPullDownRefresh()
    })()
  })

  async function accept(): Promise<void> {
    setBusy(true)
    setActionError(null)
    const result = await aiPortrait.acceptConsent()
    setBusy(false)
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    setConsented(true)
    setDeclined(false)
    void load()
  }

  async function toggleEnabled(next: boolean): Promise<void> {
    setBusy(true)
    setActionError(null)
    const result = await aiPortrait.setEnabled(next)
    setBusy(false)
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    toast(next ? '已开启画像' : '已关闭画像', 'success')
  }

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
    setConsented(false)
    setDeclined(false)
    toast('已撤回同意', 'success')
  }

  /* --------------------------- 门 1：未登录 --------------------------- */

  if (!loggedIn) {
    return (
      <View className='kdy-page kdy-portrait'>
        <KdyHeading
          title='AI 校园画像'
          subtitle='把你自己的使用记录汇总成一份统计画像，每条结论都能查到来源。'
          eyebrow='KEDAYA · 校园画像'
        />
        <Text className='kdy-portrait__positioning'>{AI_PORTRAIT_POSITIONING}</Text>
        <KdyEmpty
          mode='empty'
          title='登录后查看你的画像'
          description={AI_PORTRAIT_LOGIN_TIP}
          actionText='去登录'
          onAction={() => {
            void navigateTo(PAGE_PATHS.authLogin)
          }}
        />
        <ExcludedSources />
        <Text className='kdy-disclaimer'>{AI_PORTRAIT_DISCLAIMER}</Text>
      </View>
    )
  }

  /* --------------------------- 门 2：二次同意 --------------------------- */

  if (!consented) {
    return (
      <View className='kdy-page kdy-portrait'>
        <KdyHeading
          title='AI 校园画像'
          subtitle='把你自己的使用记录汇总成一份统计画像，每条结论都能查到来源。'
          eyebrow='KEDAYA · 校园画像'
        />

        {declined ? (
          <KdyCard title='已退出'>
            <Text className='kdy-portrait__p'>{AI_PORTRAIT_DECLINED_TEXT}</Text>
            <View className='kdy-portrait__actions'>
              <KdyButton onClick={() => setDeclined(false)}>重新阅读</KdyButton>
            </View>
          </KdyCard>
        ) : (
          <KdyCard
            title='开启前请先读这四点'
            extra={<KdyTag tone='danger'>{AI_PORTRAIT_SENSITIVITY_LABEL}</KdyTag>}
          >
            <Text className='kdy-portrait__p'>{AI_PORTRAIT_CONSENT_INTRO}</Text>
            {AI_PORTRAIT_CONSENT_POINTS.map((point) => (
              <Text key={point} className='kdy-portrait__li'>
                {point}
              </Text>
            ))}
            <Text className='kdy-portrait__notice'>{AI_PORTRAIT_EXCLUSION_TEXT}</Text>
            {actionError !== null && <Text className='kdy-portrait__error'>{actionError}</Text>}
            <View className='kdy-portrait__actions'>
              <KdyButton block loading={busy} onClick={() => void accept()}>
                我已阅读并同意
              </KdyButton>
              <KdyButton block variant='ghost' onClick={() => setDeclined(true)}>
                暂时不用
              </KdyButton>
            </View>
          </KdyCard>
        )}

        <ExcludedSources />
        <Text className='kdy-disclaimer'>{AI_PORTRAIT_DISCLAIMER}</Text>
      </View>
    )
  }

  /* ----------------------------- 主内容 ----------------------------- */

  const loading = state.status === 'idle' || state.status === 'loading'
  const enabled = view === null ? true : view.enabled

  return (
    <View className='kdy-page kdy-portrait'>
      <KdyHeading
        title='AI 校园画像'
        subtitle='把你自己的使用记录汇总成一份统计画像，每条结论都能查到来源。'
        eyebrow='KEDAYA · 校园画像'
      />

      <Text className='kdy-portrait__positioning'>{AI_PORTRAIT_POSITIONING}</Text>

      {loading && <KdyEmpty mode='loading' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          title='没能拿到你的画像'
          description={state.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void load()}
        />
      )}

      {/* 空态：后端还没有画像行（当前是常态）—— 如实说明，绝不拿假标签顶上 */}
      {state.status === 'ready' && view !== null && !hasProfile && (
        <KdyEmpty
          mode='empty'
          title={AI_PORTRAIT_EMPTY_TITLE}
          description={AI_PORTRAIT_EMPTY_TIP}
          actionText='看看数据来源'
          onAction={() => {
            void navigateTo(PAGE_PATHS.aiPortraitSources)
          }}
        />
      )}

      {state.status === 'ready' && view !== null && hasProfile && (
        <KdyCard
          title={enabled ? '你的画像' : '画像已关闭'}
          extra={
            <KdyTag tone={enabled ? 'danger' : 'neutral'}>
              {enabled ? AI_PORTRAIT_SENSITIVITY_LABEL : '已关闭'}
            </KdyTag>
          }
        >
          {enabled ? (
            <>
              {view.updatedLabel !== null && (
                <Text className='kdy-portrait__muted'>更新于 {view.updatedLabel}</Text>
              )}

              {view.traits.length === 0 ? (
                <Text className='kdy-portrait__muted'>
                  这份画像里暂时没有可展示的标签。说不清来源的标签不会展示。
                </Text>
              ) : (
                <View className='kdy-portrait__traits'>
                  {view.traits.map((trait) => (
                    <TraitCard key={trait.id} trait={trait} />
                  ))}
                </View>
              )}

              {view.note !== null && <Text className='kdy-portrait__muted'>{view.note}</Text>}
            </>
          ) : (
            // 关闭 = 不再展示（数据保留，重新开启就能再看到）
            <Text className='kdy-portrait__p'>{AI_PORTRAIT_DISABLE_NOTICE}</Text>
          )}

          {state.error !== null && <Text className='kdy-portrait__error'>{state.error}</Text>}
        </KdyCard>
      )}

      {/*
        开关与来源。
        `@taroify/core` 没有 Switch，因此用一个明确的按钮表达"关闭 / 重新开启"，
        而不是画一个看起来像开关、实际不生效的假控件。
      */}
      {state.status === 'ready' && view !== null && hasProfile && (
        <KdyCard
          title='开关与来源'
          extra={<KdyTag tone='danger'>{AI_PORTRAIT_SENSITIVITY_LABEL}</KdyTag>}
        >
          <Text className='kdy-portrait__p'>{AI_PORTRAIT_DISABLE_NOTICE}</Text>
          <Text className='kdy-portrait__muted'>{AI_PORTRAIT_TWO_SWITCH_NOTE}</Text>
          <View className='kdy-portrait__actions'>
            <KdyButton
              variant='ghost'
              onClick={() => {
                void navigateTo(PAGE_PATHS.aiPortraitSources)
              }}
            >
              数据来源与开关
            </KdyButton>
            {enabled ? (
              <KdyButton variant='danger' loading={busy} onClick={() => void toggleEnabled(false)}>
                关闭画像
              </KdyButton>
            ) : (
              <KdyButton loading={busy} onClick={() => void toggleEnabled(true)}>
                重新开启画像
              </KdyButton>
            )}
          </View>
        </KdyCard>
      )}

      {actionError !== null && <Text className='kdy-portrait__error'>{actionError}</Text>}

      <ExcludedSources />

      <KdyCard title='撤回同意' elevated={false}>
        <Text className='kdy-portrait__p'>{AI_PORTRAIT_REVOKE_NOTICE}</Text>
        <View className='kdy-portrait__actions'>
          <KdyButton size='sm' variant='danger' loading={busy} onClick={() => void revoke()}>
            撤回同意并退出
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>{AI_PORTRAIT_DISCLAIMER}</Text>
    </View>
  )
}
