import type { Result } from '@kedaya/shared'

import type { AgentCapabilities, AgentChatInput, AgentReply } from '../models/agent'
import type { RepositoryError } from './errors'

/**
 * 可达鸭 agent 仓储端口。
 *
 * 端点（后端 `AgentController`）：
 * ```
 * POST /agent/chat           {"question", "page", "module"} → 事实 + 回答 + 动作
 * GET  /agent/suggestions    当前页面的建议问题（"打开就知道能问什么"）
 * GET  /agent/capabilities   能力清单 + "哪些内容没有进检索索引"
 * ```
 *
 * 匿名可用：涉及个人数据的问题由服务端工具层拒答并引导登录，
 * 客户端**不需要**判断"这问题要不要登录"。
 */
export interface AgentRepository {
  chat(input: AgentChatInput): Promise<Result<AgentReply, RepositoryError>>
  suggestions(page?: string, module?: string): Promise<Result<string[], RepositoryError>>
  capabilities(): Promise<Result<AgentCapabilities, RepositoryError>>
}
