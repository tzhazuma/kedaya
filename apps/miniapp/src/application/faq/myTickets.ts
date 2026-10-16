import { err, ok, type Result } from '@kedaya/shared'

import { summarizeTicket, validateTicketDraft } from '../../domain/models/faq'
import type { FaqTicket, FaqTicketSummary } from '../../domain/models/faq'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FaqRepository } from '../../domain/ports/faqRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 「我的工单」用例 —— 列表 + 提交。
 *
 * 契约 §8：同步 hydrate 缓存的工单列表 → 立即渲染 → 后台 `load()` 刷新。
 * 未登录时 `userId` 为 `null`：domain-model §2.8 明确「未登录也可提交」，
 * 但此时列表只能是**本次会话内提交的**（没有身份就没有归属）。
 */

export type MyTicketsStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface MyTicketsState {
  status: MyTicketsStatus
  tickets: FaqTicketSummary[]
  error: string | null
  fromCache: boolean
  updatedAt: string | null
}

export interface CachedFaqTicketList {
  tickets: FaqTicket[]
  updatedAt: string
}

export interface MyTicketsDeps {
  repository: FaqRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  session: SessionStorePort
}

export interface SubmitTicketDraft {
  contact: string
  question: string
  idempotencyKey?: string
}

export interface MyTicketsUseCase {
  getSnapshot(): MyTicketsState
  subscribe(listener: () => void): () => void
  hydrate(): MyTicketsState
  load(): Promise<MyTicketsState>
  submit(draft: SubmitTicketDraft): Promise<Result<FaqTicketSummary, RepositoryError>>
  reset(): void
}

const INITIAL_STATE: MyTicketsState = {
  status: 'idle',
  tickets: [],
  error: null,
  fromCache: false,
  updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedFaqTicketList(value: unknown): value is CachedFaqTicketList {
  if (!isRecord(value)) return false
  return Array.isArray(value.tickets) && typeof value.updatedAt === 'string'
}

export function createMyTicketsUseCase(deps: MyTicketsDeps): MyTicketsUseCase {
  const { repository, cache, clock, cacheKey, session } = deps

  let state: MyTicketsState = INITIAL_STATE
  let hydrated = false
  let rawTickets: FaqTicket[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<MyTicketsState>): MyTicketsState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function toSummaries(tickets: readonly FaqTicket[]): FaqTicketSummary[] {
    const now = clock.now()
    return tickets.map((ticket) => summarizeTicket(ticket, now))
  }

  function hydrate(): MyTicketsState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedFaqTicketList(cached)) return state

    rawTickets = cached.tickets
    const tickets = toSummaries(cached.tickets)
    return patch({
      status: tickets.length === 0 ? 'empty' : 'ready',
      tickets,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  function writeCache(tickets: readonly FaqTicket[]): string {
    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, { tickets: [...tickets], updatedAt } satisfies CachedFaqTicketList)
    return updatedAt
  }

  async function load(): Promise<MyTicketsState> {
    const userId = session.getSnapshot().profile?.id ?? null
    patch({ status: state.tickets.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.listMyTickets(userId)
    if (!result.ok) {
      // 契约 §8：失败静默降级
      return patch({
        status: state.tickets.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.tickets.length > 0,
      })
    }

    rawTickets = result.value
    const tickets = toSummaries(result.value)
    const updatedAt = writeCache(result.value)
    return patch({
      status: tickets.length === 0 ? 'empty' : 'ready',
      tickets,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    load,

    async submit(draft: SubmitTicketDraft): Promise<Result<FaqTicketSummary, RepositoryError>> {
      const validation = validateTicketDraft({ contact: draft.contact, question: draft.question })
      if (!validation.valid) {
        const [first] = validation.errors
        return err({
          code: 'VALIDATION_FAILED',
          message: first?.message ?? '工单内容校验未通过',
          details: { errors: validation.errors },
        })
      }

      const userId = session.getSnapshot().profile?.id ?? null
      const now = clock.now()
      const created = await repository.submitTicket({
        userId,
        contact: validation.value.contact,
        question: validation.value.question,
        idempotencyKey: draft.idempotencyKey ?? createIdempotencyKey(`faq:ticket:${userId ?? 'anon'}`, now),
      })
      if (!created.ok) return created

      rawTickets = [created.value, ...rawTickets]
      const updatedAt = writeCache(rawTickets)
      patch({
        status: 'ready',
        tickets: toSummaries(rawTickets),
        error: null,
        fromCache: false,
        updatedAt,
      })

      return ok(summarizeTicket(created.value, now))
    },

    reset(): void {
      hydrated = false
      rawTickets = []
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
