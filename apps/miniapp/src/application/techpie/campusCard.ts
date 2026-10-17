import { err, ok, type Result } from '@kedaya/shared'

import {
  EMPTY_CARD_ACCOUNT,
  deriveCardAccount,
  isPaymentCodeExpired,
  normalizeCampusCardPaymentCode,
  normalizeCampusCardTransactions,
  type CampusCardAccount,
  type CampusCardPaymentCode,
  type CampusCardTransaction,
} from '../../domain/models/campusCard'
import { hasForbiddenCredentialKeys } from '../../domain/models/credentials'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LogPort } from '../../domain/ports/logPort'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import type { TechpieRepository } from '../../domain/ports/techpieRepository'
import { createIdempotencyKey } from '../idempotency'

/**
 * 校园卡用例 —— 余额 / 流水 / 付款码（规格 §2.5 / §9.1 Phase 0）。
 *
 * ## 余额为什么不发请求
 *
 * 冻结契约里**没有**独立余额端点，但 `CampusCardTxn.balanceFen` 是
 * 「该笔交易发生后的余额」。因此最新一笔的 `balanceFen` **就是**当前余额，
 * 由 `deriveCardAccount` 推导 —— 而不是发明一个 `GET /campus-card/balance`。
 * 发明一个只有 mock 才存在的端点，等于给自己造一个假的接口。
 *
 * ## 付款码的诚实处理
 *
 * 付款码端点**尚未登记进冻结契约**（`CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false`）。
 * 本用例照常实现调用路径，但把「契约缺口」作为**状态**暴露给 UI
 * （`paymentCodeContractRegistered`），让页面如实告知用户，
 * 而不是让用户对着一个 404 猜发生了什么。
 */

export type CampusCardStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type PaymentCodeStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CampusCardState {
  status: CampusCardStatus
  transactions: CampusCardTransaction[]
  /** 由流水推导的余额（见 `deriveCardAccount`） */
  account: CampusCardAccount
  nextCursor: string | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean

  paymentCode: CampusCardPaymentCode | null
  paymentCodeStatus: PaymentCodeStatus
  paymentCodeError: string | null
  /** 付款码端点是否已登记进冻结契约（当前为 `false`，UI 必须如实展示） */
  paymentCodeContractRegistered: boolean
}

export interface CachedCardTransactions {
  items: CampusCardTransaction[]
  nextCursor: string | null
  updatedAt: string
}

export interface CampusCardDeps {
  repository: TechpieRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  log?: LogPort
  /** 当前是否已登录（未登录时不发请求，直接给 UNAUTHENTICATED） */
  session: SessionStorePort
  /** 付款码端点是否已登记进冻结契约 */
  paymentCodeRegistered: boolean
}

export interface CampusCardUseCase {
  getSnapshot(): CampusCardState
  subscribe(listener: () => void): () => void
  hydrate(): CampusCardState
  load(): Promise<CampusCardState>
  loadMore(): Promise<CampusCardState>
  requestPaymentCode(): Promise<Result<CampusCardPaymentCode, RepositoryError>>
  /** 付款码是否已过期（页面用它决定是否显示「已过期，点击刷新」） */
  isPaymentCodeExpired(): boolean
  reset(): void
}

function initialState(paymentCodeRegistered: boolean): CampusCardState {
  return {
    status: 'idle',
    transactions: [],
    account: EMPTY_CARD_ACCOUNT,
    nextCursor: null,
    error: null,
    fromCache: false,
    updatedAt: null,
    loadingMore: false,
    paymentCode: null,
    paymentCodeStatus: 'idle',
    paymentCodeError: null,
    paymentCodeContractRegistered: paymentCodeRegistered,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedCardTransactions(value: unknown): value is CachedCardTransactions {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.items)) return false
  if (typeof value.updatedAt !== 'string') return false
  return !hasForbiddenCredentialKeys(value)
}

export function createCampusCardUseCase(deps: CampusCardDeps): CampusCardUseCase {
  const { repository, cache, clock, cacheKey, log, session, paymentCodeRegistered } = deps

  let state: CampusCardState = initialState(paymentCodeRegistered)
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<CampusCardState>): CampusCardState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function authenticated(): boolean {
    const snapshot = session.getSnapshot()
    return snapshot.tokens !== null && snapshot.profile !== null
  }

  function applyTransactions(
    items: CampusCardTransaction[],
    nextCursor: string | null,
  ): Partial<CampusCardState> {
    return {
      transactions: items,
      account: deriveCardAccount(items),
      nextCursor,
      loadingMore: false,
    }
  }

  function hydrate(): CampusCardState {
    if (hydrated) return state
    hydrated = true

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedCardTransactions(cached)) return state

    const items = normalizeCampusCardTransactions(cached.items)
    log?.info('campus-card.transactions.hydrated', { count: items.length })
    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      ...applyTransactions(items, cached.nextCursor),
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  async function load(): Promise<CampusCardState> {
    if (!authenticated()) {
      return patch({
        status: 'error',
        error: '请先登录后再查看校园卡',
        paymentCodeStatus: 'idle',
      })
    }

    log?.info('campus-card.transactions.load.started')
    const startedAt = clock.now().getTime()
    patch({ status: state.transactions.length > 0 ? 'ready' : 'loading', error: null })

    const result = await repository.cardTransactions()
    const durationMs = clock.now().getTime() - startedAt

    if (!result.ok) {
      log?.warn('campus-card.transactions.load.failed', {
        code: result.error.code,
        durationMs,
      })
      return patch({
        status: state.transactions.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.transactions.length > 0,
      })
    }

    const items = result.value.items
    const updatedAt = clock.now().toISOString()
    if (!hasForbiddenCredentialKeys(items)) {
      cache.write(cacheKey, {
        items,
        nextCursor: result.value.nextCursor,
        updatedAt,
      } satisfies CachedCardTransactions)
    } else {
      log?.warn('techpie.contract.violation', {
        where: 'campus-card.items.cache',
        droppedCount: 1,
        reason: 'FORBIDDEN_KEYS_IN_CACHE_WRITE',
      })
    }

    log?.info('campus-card.transactions.load.succeeded', { count: items.length, durationMs })

    return patch({
      status: items.length === 0 ? 'empty' : 'ready',
      ...applyTransactions(items, result.value.nextCursor),
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  async function loadMore(): Promise<CampusCardState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.cardTransactions({ cursor: state.nextCursor })

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    const appended = [...state.transactions, ...result.value.items]
    return patch({
      status: appended.length === 0 ? 'empty' : 'ready',
      ...applyTransactions(appended, result.value.nextCursor),
      error: null,
      fromCache: false,
    })
  }

  async function requestPaymentCode(): Promise<Result<CampusCardPaymentCode, RepositoryError>> {
    if (!authenticated()) {
      return err({ code: 'UNAUTHENTICATED', message: '请先登录后再使用校园卡付款码' })
    }

    // ⚠️ 这里**不**打日志：请求还没成功，先写一条 "issued" 会让日志说谎。
    patch({ paymentCodeStatus: 'loading', paymentCodeError: null })

    const result = await repository.paymentCode(createIdempotencyKey('campus-card-pay', clock.now()))

    if (!result.ok) {
      log?.warn('campus-card.payment-code.failed', { code: result.error.code })
      patch({
        paymentCodeStatus: 'error',
        paymentCodeError: result.error.message,
      })
      return result
    }

    // ⚠️ 付款码本身**不进日志**：它是一次性的支付凭证。
    // 只记它的到期时间（`expiresAt`），足以诊断"为什么码过期了"。
    const normalized = normalizeCampusCardPaymentCode(result.value)
    if (normalized === null) {
      patch({
        paymentCodeStatus: 'error',
        paymentCodeError: '付款码形状不合法，已拒绝使用',
      })
      return err({ code: 'INTERNAL', message: '付款码形状不合法，已拒绝使用' })
    }

    log?.info('campus-card.payment-code.issued', { expiresAt: normalized.expiresAt })
    patch({
      paymentCodeStatus: 'ready',
      paymentCode: normalized,
      paymentCodeError: null,
    })
    return ok(normalized)
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
    loadMore,
    requestPaymentCode,
    isPaymentCodeExpired(): boolean {
      return state.paymentCode !== null && isPaymentCodeExpired(state.paymentCode, clock.now())
    },
    reset(): void {
      hydrated = false
      state = initialState(paymentCodeRegistered)
      for (const listener of listeners) listener()
    },
  }
}
