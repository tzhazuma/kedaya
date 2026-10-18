import { Text, View } from '@tarojs/components'
import Input from '@taroify/core/input'
import '@taroify/core/input/style'
import { ArrowDown, ArrowUp, Checked, Close, Search } from '@taroify/icons'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../app/container'
import type { AgentMessage, AgentReply, AgentSource } from '../../../domain/models/agent'
import { navigateTo } from '../../../platform/navigation'
import { KdyButton, KdyMascot } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 可达鸭（`agent`）—— 全局助手页面。
 *
 * 客户端的三个不变式：
 *   1. **不决策**：调哪个工具、要不要登录、时间怎么算，全部由服务端完成；
 *      页面只渲染 `answer / facts / sources / steps`，把 `actions` 变成可点的跳转；
 *   2. **不静默**：请求失败也要落一条 agent 消息（带重试），
 *      绝不让用户的问题孤零零悬在那里 —— 那是死路；
 *   3. **不冒充**：`simulated`（演示数据）如实标注；模型不可用时退化成
 *      `usedModel: null` 的规则回答，页面只标一个「基础回答」，不暴露模型名。
 *
 * ## 为什么把 facts / sources 收进「思考过程」
 *
 * 回答正文（模型组织的话）本来就会把事实说一遍；再把 facts 原样铺在下面，
 * 同一条信息就在一个气泡里出现两次，看起来像"复读"——这是这个页面之前最丑的地方。
 * 现在正文只负责**说人话**，`steps` / `sources` / `facts` 收进一个可展开的
 * 「思考过程」：折叠时只给一行摘要（查了几项数据、参考了几条知识），
 * 展开后逐条列出"我查了什么、查到什么、依据是什么"。
 *
 * 这不是装饰：踩过坑的人才知道，校园场景里用户最想知道的是
 * 「这个数字你从哪来的」。让它**随时可查、但不挡路**，才是这个信息该在的位置。
 *
 * 上下文：从悬浮球进来时带着 `module` / `page` 参数，
 * 首屏据此拉"这个页面能问什么"的建议问题，用户不用自己想怎么问。
 */

/** 把 answer 按行渲染：小程序 `<Text>` 对 `\n` 的支持不稳定，逐行更可靠 */
function AnswerBody({ text }: { text: string }) {
  return (
    <View className='kdy-agent__answer'>
      {text.split('\n').map((line, index) => (
        <Text key={`${index}-${line}`} className='kdy-agent__answer-line'>
          {line}
        </Text>
      ))}
    </View>
  )
}

/**
 * 工具名 → 人话。
 *
 * 和 `KdyModuleIcon` 的图标表一样，这是**纯视觉映射**：工具清单始终由服务端
 * 决定（`capabilities.tools` / `steps[].tool`），这里只回答"这个工具怎么念给用户听"。
 * 没登记的工具直接显示原始名字 —— 与其编一个可能不准的说法，不如如实露出。
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  'schedule.today': '今日课表',
  'schedule.next': '下一节课',
  'card.overview': '校园卡',
  'profile.consents': '隐私与授权',
  'identity.view': '校园绑定',
  'account.guide': '账号流程',
}

const SOURCE_KIND_LABELS: Readonly<Record<AgentSource['kind'], string>> = {
  module: '模块说明',
  guide: '使用指南',
  faq: '常见问题',
  live: '实时数据',
}

/** 思考过程（可折叠）：查了哪些数据、成败如何、参考了哪些知识 */
function Thinking({ reply }: { reply: AgentReply }) {
  const [open, setOpen] = useState(false)

  const summary: string[] = []
  if (reply.steps.length > 0) summary.push(`查了 ${reply.steps.length} 项数据`)
  if (reply.facts.length > 0) summary.push(`${reply.facts.length} 条事实`)
  if (reply.sources.length > 0) summary.push(`参考 ${reply.sources.length} 条知识`)
  if (summary.length === 0) return null

  return (
    <View className='kdy-agent__thinking'>
      <View className='kdy-agent__thinking-head' onClick={() => setOpen(!open)}>
        <Text className='kdy-agent__thinking-title'>思考过程</Text>
        <Text className='kdy-agent__thinking-summary'>{summary.join(' · ')}</Text>
        <View
          className={`kdy-agent__thinking-caret${open ? ' kdy-agent__thinking-caret--open' : ''}`}
        >
          <ArrowDown />
        </View>
      </View>

      {open && (
        <View className='kdy-agent__thinking-body'>
          {reply.steps.map((step, index) => (
            <View key={`${step.tool}-${index}`} className='kdy-agent__step'>
              <View className={`kdy-agent__step-mark${step.ok ? ' kdy-agent__step-mark--ok' : ''}`}>
                {step.ok ? <Checked /> : <Close />}
              </View>
              <View className='kdy-agent__step-body'>
                <Text className='kdy-agent__step-title'>
                  {TOOL_LABELS[step.tool] ?? step.tool}
                </Text>
                {step.error !== undefined && (
                  <Text className='kdy-agent__step-error'>{step.error}</Text>
                )}
              </View>
            </View>
          ))}

          {reply.facts.map((fact) => (
            <View key={`${fact.tool}-${fact.label}`} className='kdy-agent__fact'>
              <Text className='kdy-agent__fact-label'>{fact.label}</Text>
              <Text className='kdy-agent__fact-value'>
                {fact.value}
                {fact.simulated === true ? '（演示数据）' : ''}
              </Text>
            </View>
          ))}

          {reply.sources.map((source) => (
            <View key={source.id} className='kdy-agent__source'>
              <Text className='kdy-agent__source-kind'>{SOURCE_KIND_LABELS[source.kind]}</Text>
              <Text className='kdy-agent__source-title'>{source.title}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function ActionButtons({ actions }: { actions: AgentReply['actions'] }) {
  if (actions.length === 0) return null
  return (
    <View className='kdy-agent__actions'>
      {actions.map((action) => (
        <KdyButton
          key={action.path + action.label}
          size='sm'
          variant='secondary'
          onClick={() => void navigateTo(action.path)}
        >
          {action.label}
        </KdyButton>
      ))}
    </View>
  )
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: AgentMessage
  onRetry: (messageId: string) => void
}) {
  if (message.role === 'user') {
    return (
      <View className='kdy-agent__row kdy-agent__row--user' id={message.id}>
        <View className='kdy-agent__bubble kdy-agent__bubble--user'>
          <Text className='kdy-agent__bubble-text'>{message.text}</Text>
        </View>
      </View>
    )
  }

  const reply = message.reply
  return (
    <View className='kdy-agent__row kdy-agent__row--agent' id={message.id}>
      <KdyMascot size={34} plate className='kdy-agent__avatar' />
      <View className='kdy-agent__bubble kdy-agent__bubble--agent'>
        <AnswerBody text={message.text} />

        {reply !== null && <Thinking reply={reply} />}

        {reply !== null && (reply.simulated || reply.usedModel === null) && (
          <View className='kdy-agent__meta'>
            {reply.simulated && <Text className='kdy-agent__badge'>含演示数据</Text>}
            {reply.usedModel === null && <Text className='kdy-agent__badge'>基础回答</Text>}
          </View>
        )}

        {reply !== null && <ActionButtons actions={reply.actions} />}

        {message.failed === true && (
          <View className='kdy-agent__retry'>
            <KdyButton size='sm' onClick={() => onRetry(message.id)}>
              重试
            </KdyButton>
          </View>
        )}
      </View>
    </View>
  )
}

/** 等待回答时的气泡：三个跳动的点 + 一行"在做什么"，而不是一句干等着的「让我查一下」 */
function PendingBubble() {
  return (
    <View className='kdy-agent__row kdy-agent__row--agent'>
      <KdyMascot size={34} plate className='kdy-agent__avatar' />
      <View className='kdy-agent__bubble kdy-agent__bubble--agent kdy-agent__bubble--pending'>
        <View className='kdy-agent__dots'>
          <View className='kdy-agent__dot' />
          <View className='kdy-agent__dot' />
          <View className='kdy-agent__dot' />
        </View>
        <Text className='kdy-agent__pending-text'>正在查你的数据并组织语言…</Text>
      </View>
    </View>
  )
}

export default function AgentPage() {
  const container = getContainer()
  const agent = container.useCases.agent
  const router = useRouter()
  const state = useStore(agent)
  const [draft, setDraft] = useState('')

  const module = typeof router.params.module === 'string' ? router.params.module : undefined
  const page = typeof router.params.page === 'string' ? router.params.page : undefined

  useDidShow(() => {
    // 首屏建议 + 能力清单：让用户"打开就知道能问什么"（失败也不阻塞，静默降级）
    void agent.loadSuggestions(page, module)
    if (agent.getSnapshot().capabilities === null) void agent.loadCapabilities()
  })

  useEffect(() => {
    // 新消息后滚到底部：用页面滚动而不是内嵌滚动区，在小程序里更稳
    if (state.messages.length === 0) return
    void Taro.pageScrollTo({ scrollTop: 100000, duration: 200 })
    // 只在消息数量变化时滚动，避免每次输入都触发
  }, [state.messages.length])

  async function send(question: string): Promise<void> {
    const text = question.trim()
    if (text === '') return
    setDraft('')
    await agent.ask(text, { page, module })
  }

  const capabilities = state.capabilities
  const canSend = !state.pending && draft.trim() !== ''
  /** 模型不可用时如实说明这是规则回答（不暴露模型名） */
  const rulesOnly = capabilities !== null && capabilities.mode === 'rules'
  const suggestions = state.suggestions

  return (
    <View className='kdy-page kdy-agent'>
      <View className='kdy-agent__header'>
        <KdyMascot size={40} plate />
        <View className='kdy-agent__header-main'>
          <Text className='kdy-agent__title'>可达鸭</Text>
          <Text className='kdy-agent__subtitle'>课表、余额、绑定流程，都能问我</Text>
        </View>
        <View className='kdy-agent__status'>
          <View className='kdy-agent__status-dot' />
          <Text className='kdy-agent__status-text'>{rulesOnly ? '基础回答' : '在线'}</Text>
        </View>
      </View>

      {state.messages.length === 0 && (
        <View className='kdy-agent__welcome'>
          <View className='kdy-agent__welcome-hero'>
            <KdyMascot size={76} />
          </View>
          <Text className='kdy-agent__welcome-title'>有什么可以帮你的？</Text>
          <Text className='kdy-agent__welcome-sub'>
            我的回答只依据两类东西：你自己的实时数据（按你的权限查），以及公开的模块说明与常见问题。
          </Text>

          <View className='kdy-agent__chips'>
            {suggestions.length === 0 ? (
              <Text className='kdy-agent__muted'>正在准备建议问题…</Text>
            ) : (
              suggestions.map((suggestion) => (
                <View
                  key={suggestion}
                  className='kdy-agent__chip'
                  onClick={() => void send(suggestion)}
                  hoverClass='kdy-agent__chip--pressed'
                  hoverStayTime={70}
                >
                  <Search />
                  <Text className='kdy-agent__chip-text'>{suggestion}</Text>
                </View>
              ))
            )}
          </View>

          <View className='kdy-agent__promise'>
            <Text className='kdy-agent__promise-text'>
              {capabilities === null
                ? '查不到就说查不到，不编数字。'
                : `查不到就说查不到，不编数字。这些内容不进公共检索：${capabilities.notIndexed.join('、')}。`}
            </Text>
          </View>
        </View>
      )}

      {state.messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onRetry={(id) => void agent.retry(id, { page, module })}
        />
      ))}

      {state.pending && <PendingBubble />}

      {state.messages.length > 0 && (
        <View className='kdy-agent__clear' onClick={() => agent.clear()}>
          <Text className='kdy-agent__clear-text'>清空对话</Text>
        </View>
      )}

      <View className='kdy-agent__composer'>
        <Input
          className='kdy-agent__composer-input'
          value={draft}
          placeholder='问可达鸭…'
          confirmType='send'
          onChange={(event) => setDraft(String(event.detail.value ?? ''))}
          onConfirm={() => void send(draft)}
        />
        <View
          className={`kdy-agent__send${canSend ? '' : ' kdy-agent__send--disabled'}`}
          hoverClass={canSend ? 'kdy-agent__send--pressed' : 'none'}
          hoverStayTime={70}
          onClick={() => {
            if (canSend) void send(draft)
          }}
        >
          <ArrowUp />
        </View>
      </View>

      {state.error !== null && <Text className='kdy-agent__error'>{state.error}</Text>}

      <Text className='kdy-agent__footnote'>
        对话只保留在本次使用中，不上传、不落盘。
      </Text>
    </View>
  )
}
