import type { AgentCapabilities, AgentChatInput, AgentMessage } from '../../domain/models/agent'
import type { AgentRepository } from '../../domain/ports/agentRepository'
import { isRetryable } from '../../domain/ports/errors'
import type { ClockPort } from '../../domain/ports/clockPort'

/**
 * 可达鸭 agent 用例。
 *
 * 三条与"高可用"直接相关的设计：
 *   1. **失败不能没有回应**：请求失败时也要落一条 agent 消息（带重试按钮），
 *      否则用户只看到自己的问题孤零零挂在那里 —— 那就是死路；
 *   2. **历史只在内存里**：不落盘、不上传。校园场景里聊天记录可能包含
 *      "我卡里还有多少钱"，留在本地存储反而多一份泄漏面；
 *   3. **不做本地意图判断**：调哪个工具、要不要登录，全部由服务端决定
 *      （见 agent.domain 注释），客户端只是传话 + 展示。
 */

export interface AgentState {
  messages: AgentMessage[]
  /** 正在等待回答 */
  pending: boolean
  suggestions: string[]
  capabilities: AgentCapabilities | null
  /** 加载建议/能力失败的提示（不影响聊天） */
  error: string | null
}

export interface AgentUseCase {
  getSnapshot(): AgentState
  subscribe(listener: () => void): () => void
  ask(question: string, context?: { page?: string; module?: string }): Promise<AgentState>
  /** 重发某条失败的消息 */
  retry(messageId: string, context?: { page?: string; module?: string }): Promise<AgentState>
  loadSuggestions(page?: string, module?: string): Promise<AgentState>
  loadCapabilities(): Promise<AgentState>
  clear(): void
}

export interface AgentUseCasesDeps {
  repository: AgentRepository
  clock: ClockPort
}

const MAX_MESSAGES = 60

export function createAgentUseCase(deps: AgentUseCasesDeps): AgentUseCase {
  const { repository, clock } = deps

  let state: AgentState = {
    messages: [],
    pending: false,
    suggestions: [],
    capabilities: null,
    error: null,
  }
  const listeners = new Set<() => void>()
  let sequence = 0

  function patch(next: Partial<AgentState>): AgentState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function nextId(prefix: string): string {
    sequence += 1
    return `${prefix}-${sequence}`
  }

  function push(message: AgentMessage): void {
    // 只保留最近若干条：这是聊天框不是档案系统，无限增长只会拖慢页面
    patch({ messages: [...state.messages, message].slice(-MAX_MESSAGES) })
  }

  async function ask(
    question: string,
    context: { page?: string; module?: string } = {},
  ): Promise<AgentState> {
    const trimmed = question.trim()
    if (trimmed === '' || state.pending) return state

    const at = clock.now().toISOString()
    push({ id: nextId('user'), role: 'user', text: trimmed, reply: null, at })
    patch({ pending: true, error: null })

    const input: AgentChatInput = {
      question: trimmed,
      ...(context.page === undefined ? {} : { page: context.page }),
      ...(context.module === undefined ? {} : { module: context.module }),
    }

    const result = await repository.chat(input)

    if (!result.ok) {
      // 失败也要有一条 agent 消息 —— 带重试按钮，避免"发了没人应"的死路
      push({
        id: nextId('agent'),
        role: 'agent',
        text: isRetryable(result.error.code)
          ? `我没能连上服务（${result.error.message}）。可以点重试再问一次。`
          : `这个问题我暂时答不了：${result.error.message}`,
        reply: null,
        at: clock.now().toISOString(),
        failed: true,
      })
      return patch({ pending: false, error: result.error.message })
    }

    push({
      id: nextId('agent'),
      role: 'agent',
      text: result.value.answer,
      reply: result.value,
      at: clock.now().toISOString(),
    })
    return patch({ pending: false, error: null })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    ask,
    async retry(messageId: string, context?): Promise<AgentState> {
      const index = state.messages.findIndex((message) => message.id === messageId)
      if (index < 0) return state
      // 找到这条失败消息之前的那条用户提问
      const question = [...state.messages.slice(0, index)].reverse().find((message) => message.role === 'user')
      if (question === undefined) {
        patch({ messages: state.messages.filter((message) => message.id !== messageId) })
        return state
      }
      // 重试 = 把「提问 + 失败回答」整体撤掉再重新问一次，
      // 这样聊天记录里不会留下一串重复的同一句话
      patch({
        messages: state.messages.filter(
          (message) => message.id !== messageId && message.id !== question.id,
        ),
      })
      return ask(question.text, context)
    },
    async loadSuggestions(page?: string, module?: string): Promise<AgentState> {
      const result = await repository.suggestions(page, module)
      if (!result.ok) return patch({ error: result.error.message })
      return patch({ suggestions: result.value })
    },
    async loadCapabilities(): Promise<AgentState> {
      const result = await repository.capabilities()
      if (!result.ok) return patch({ error: result.error.message })
      return patch({ capabilities: result.value })
    },
    clear(): void {
      patch({ messages: [], error: null })
    },
  }
}
