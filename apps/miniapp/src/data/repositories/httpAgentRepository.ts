import { modulePath } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { AgentCapabilities, AgentChatInput, AgentReply } from '../../domain/models/agent'
import type { RepositoryError } from '../../domain/ports/errors'
import type { AgentRepository } from '../../domain/ports/agentRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/** 真后端 agent 仓储 */
export function createHttpAgentRepository(client: ApiClient): AgentRepository {
  const base = modulePath('agent')

  return {
    async chat(input: AgentChatInput): Promise<Result<AgentReply, RepositoryError>> {
      const result = await client.post<AgentReply, AgentChatInput>(`${base}/chat`, input)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async suggestions(page?: string, module?: string): Promise<Result<string[], RepositoryError>> {
      const result = await client.get<{ items: string[] }>(`${base}/suggestions`, { page, module })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value.items)
    },

    async capabilities(): Promise<Result<AgentCapabilities, RepositoryError>> {
      const result = await client.get<AgentCapabilities>(`${base}/capabilities`)
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },
  }
}
