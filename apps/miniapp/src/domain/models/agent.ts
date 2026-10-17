/**
 * 可达鸭 agent 领域模型。
 *
 * 客户端这边的职责很轻 —— **不做任何决策**：
 *   · 调哪个工具、数据从哪来、时间怎么算，全部由服务端完成（facts-first）；
 *   · 客户端只负责展示 `answer` / `facts` / `sources`，并把 `actions`
 *     变成可点击的跳转。
 *
 * 这样"换模型"或"模型挂掉"都不会影响客户端逻辑 —— 页面永远只认这一个结构，
 * 服务端降级（`degraded: true`）时字段依然齐全。
 */

export interface AgentSource {
  id: string
  title: string
  kind: 'module' | 'guide' | 'faq' | 'live'
  updatedAt: string | null
}

export interface AgentAction {
  type: 'navigate'
  label: string
  /** 小程序页面路径（与 `@kedaya/contracts` 的 `MINIAPP_PAGES` 一致） */
  path: string
}

export interface AgentFact {
  tool: string
  label: string
  value: string
  simulated?: boolean
}

export interface AgentStep {
  tool: string
  ok: boolean
  error?: string
}

export interface AgentReply {
  answer: string
  sources: AgentSource[]
  actions: AgentAction[]
  facts: AgentFact[]
  steps: AgentStep[]
  /** 实际使用的模型；null = 规则引擎 */
  usedModel: string | null
  /** 已降级（无模型 / 模型或上游失败），回答仍可用 */
  degraded: boolean
  simulated: boolean
  latencyMs: number
}

export interface AgentChatInput {
  question: string
  /** 当前页面路径，服务端据此加权与给出建议 */
  page?: string
  module?: string
}

export interface AgentCapabilities {
  persona: string
  model: string | null
  mode: 'rules' | 'model'
  tools: { name: string; description: string; requiresAuth: boolean }[]
  knowledgeSources: string[]
  notIndexed: string[]
}

/** 会话里的一条消息（历史只留在本地内存，不上传、不落盘） */
export interface AgentMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  reply: AgentReply | null
  at: string
  /** 发送失败时的原文（用于"重发"按钮） */
  failed?: boolean
}

/** 演示数据提示文案（`simulated: true` 时显著展示） */
export const SIMULATED_HINT = '当前包含演示数据（来自本地模拟数据源），不代表真实校园数据'
