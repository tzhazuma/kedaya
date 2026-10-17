import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../app/container'
import type { AgentAction, AgentMessage } from '../../../domain/models/agent'
import { navigateTo } from '../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 可达鸭（`agent`）—— 全局助手页面。
 *
 * 客户端的三个不变式：
 *   1. **不决策**：调哪个工具、要不要登录、时间怎么算，全部由服务端完成；
 *      页面只渲染 `answer / facts / sources`，把 `actions` 变成可点的跳转；
 *   2. **不静默**：请求失败也要落一条 agent 消息（带重试），
 *      绝不让用户的问题孤零零悬在那里 —— 那是死路；
 *   3. **不冒充**：`simulated`（演示数据）如实标注；模型不可用时退化成
 *      `usedModel: null` 的规则回答，页面只淡淡标一个「基础回答」，不暴露模型名。
 *
 * 上下文：从悬浮球进来时带着 `module` / `page` 参数，
 * 首屏据此拉"这个页面能问什么"的建议问题，用户不用自己想怎么问。
 */

/** 把 agent 的 answer 按行渲染：小程序 `<Text>` 对 `\n` 的支持不稳定，逐行更可靠 */
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

function ActionButtons({ actions }: { actions: AgentAction[] }) {
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
      <View className='kdy-agent__avatar'>
        <Text className='kdy-agent__avatar-emoji'>🦆</Text>
      </View>
      <View className='kdy-agent__bubble kdy-agent__bubble--agent'>
        <AnswerBody text={message.text} />

        {reply !== null && reply.facts.length > 0 && (
          <View className='kdy-agent__facts'>
            {reply.facts.map((fact) => (
              <View key={`${fact.tool}-${fact.label}`} className='kdy-agent__fact'>
                <Text className='kdy-agent__fact-label'>{fact.label}</Text>
                <Text className='kdy-agent__fact-value'>
                  {fact.value}
                  {fact.simulated === true ? '（演示数据）' : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {reply !== null && reply.sources.length > 0 && (
          <View className='kdy-agent__sources'>
            <Text className='kdy-agent__sources-title'>参考</Text>
            {reply.sources.map((source) => (
              <Text key={source.id} className='kdy-agent__source'>
                {source.title}
              </Text>
            ))}
          </View>
        )}

        {reply !== null && (
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
  /** 只有走规则回答时才需要说明（用户看得出来回答短一些），正常情况不必解释 */
  const modeLabel = capabilities !== null && capabilities.mode === 'rules' ? '基础回答' : null

  return (
    <View className='kdy-page kdy-agent'>
      <View className='kdy-agent__header'>
        <View className='kdy-agent__header-main'>
          <Text className='kdy-agent__title'>可达鸭</Text>
          <Text className='kdy-agent__subtitle'>
            {modeLabel === null ? '课表、校园卡、绑定流程，问我就行' : `${modeLabel} · 问我就行`}
          </Text>
        </View>
        {state.messages.length > 0 && (
          <KdyButton size='sm' variant='ghost' onClick={() => agent.clear()}>
            清空
          </KdyButton>
        )}
      </View>

      {state.messages.length === 0 && (
        <KdyCard title='可以这样问我'>
          {state.suggestions.length === 0 && <Text className='kdy-agent__muted'>正在准备建议问题…</Text>}
          <View className='kdy-agent__chips'>
            {state.suggestions.map((suggestion) => (
              <KdyChip key={suggestion} onClick={() => void send(suggestion)}>
                {suggestion}
              </KdyChip>
            ))}
          </View>
          {capabilities !== null && (
            <View className='kdy-agent__caps'>
              <Text className='kdy-agent__caps-title'>我不会做的事</Text>
              <Text className='kdy-agent__caps-line'>
                不把个人数据放进检索：{capabilities.notIndexed.join('、')}。
              </Text>
              <Text className='kdy-agent__caps-line'>
                个人信息按你的权限实时查；查不到就说查不到，不编数字。
              </Text>
            </View>
          )}
        </KdyCard>
      )}

      {state.messages.map((message) => (
        <MessageBubble key={message.id} message={message} onRetry={(id) => void agent.retry(id, { page, module })} />
      ))}

      {state.pending && (
        <View className='kdy-agent__row kdy-agent__row--agent'>
          <View className='kdy-agent__avatar'>
            <Text className='kdy-agent__avatar-emoji'>🦆</Text>
          </View>
          <View className='kdy-agent__bubble kdy-agent__bubble--agent'>
            <Text className='kdy-agent__bubble-text'>让我查一下…</Text>
          </View>
        </View>
      )}

      <View className='kdy-agent__composer'>
        <KdyField
          value={draft}
          onChange={setDraft}
          placeholder='问我：今天有哪些课、卡里还剩多少钱…'
          maxLength={200}
          hint={state.error === null ? undefined : state.error}
        />
        <View className='kdy-agent__composer-action'>
          <KdyButton
            size='sm'
            loading={state.pending}
            disabled={state.pending || draft.trim() === ''}
            onClick={() => void send(draft)}
          >
            发送
          </KdyButton>
        </View>
      </View>

      <Text className='kdy-agent__footnote'>
        对话只保留在本次使用中，不上传、不落盘。我可以查课表、余额等「你自己的」数据，但不会把它们写进公共知识库。
      </Text>
    </View>
  )
}
