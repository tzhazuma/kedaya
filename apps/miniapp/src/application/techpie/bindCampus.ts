import { err, ok, type Result } from '@kedaya/shared'

import type { CampusCardBindCredential } from '../../domain/models/campusCard'
import {
  PHASE1_BINDING_BLOCKED_REASON,
  isPhase0Bindable,
  type CampusBindingSummary,
  type CampusPlatform,
} from '../../domain/models/techpie'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LogPort } from '../../domain/ports/logPort'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import type { TechpieRepository } from '../../domain/ports/techpieRepository'
import { createIdempotencyKey } from '../idempotency'

/**
 * 绑定动作用例 —— 发起绑定 / 解绑 / 手动续期。
 *
 * ## 本文件是「日志脱敏」的第一现场（规格 §10.3）
 *
 * 绑定流程天然要接触凭证（校园卡的 `wx.login` code）。因此这里做了三件事：
 *
 * 1. **凭证从不作为日志字段传递** —— `log.info('techpie.binding.create.started', { provider, phase })`
 *    只带 `provider` / `phase`，`credential` 这个对象**根本没进过日志调用**；
 * 2. 事件登记表（`LOG_EVENT_FIELDS`）里 `techpie.binding.create.*` 允许的字段
 *    是 `provider` / `phase` / `status` / `bindingId` / `code` —— **没有**任何
 *    能装下凭证的字段名。即使后来有人手滑 `{ ...input }`，`credential` 也会被白名单剔除；
 * 3. 失败路径只记 `code`（如 `FORBIDDEN`），**不记**上游返回的 message
 *    —— message 里可能带回显的凭证片段。
 *
 * 测试 `application/techpie/__tests__/bindCampus.test.ts` 与
 * `src/__tests__/techpie-log-redaction.test.ts` 会对整条链路抓日志做正则扫描。
 *
 * ## Phase 0 只允许校园卡（契约 §11.18-D）
 *
 * `requestPhase1Binding()` **不发任何请求**：它直接返回一个诚实的拒绝。
 * 这不是"先做着等批准"，而是契约明确要求的「根本不做」。
 */

export type BindActionStatus = 'idle' | 'submitting' | 'ready' | 'error'

export interface BindCampusState {
  status: BindActionStatus
  /** 正在进行的动作名（页面用来禁用按钮） */
  pending: 'create' | 'unbind' | 'renew' | null
  /** 最近一次失败的文案；成功时为 null */
  error: string | null
  /** 最近一次成功动作的说明（页面 toast 用） */
  notice: string | null
}

export interface BindCampusDeps {
  repository: TechpieRepository
  session: SessionStorePort
  clock: ClockPort
  log?: LogPort
}

export interface BindCampusUseCase {
  getSnapshot(): BindCampusState
  subscribe(listener: () => void): () => void

  /**
   * 发起校园卡绑定（OPENID 通道）。
   *
   * `credential.wechatLoginCode` 是 `wx.login` 的一次性 code ——
   * 它会被**直接**交给仓储层发请求，**绝不进入日志**。
   */
  bindEcard(
    credential: CampusCardBindCredential,
  ): Promise<Result<CampusBindingSummary, RepositoryError>>

  unbind(id: string): Promise<Result<true, RepositoryError>>
  renew(id: string): Promise<Result<CampusBindingSummary, RepositoryError>>

  /**
   * Phase 1+ 平台的绑定请求 —— **不发请求**，直接诚实拒绝。
   *
   * 契约 §11.18-D：在信息办书面回复前，`cas` / `egate` / `cpdaily` / `techpie`
   * 的绑定流程**不实现**。UI 上也不该出现可点的入口；
   * 这个方法是「万一有入口」时的最后一道闸。
   */
  requestPhase1Binding(platform: CampusPlatform): Result<never, RepositoryError>

  reset(): void
}

const INITIAL_STATE: BindCampusState = {
  status: 'idle',
  pending: null,
  error: null,
  notice: null,
}

export function createBindCampusUseCase(deps: BindCampusDeps): BindCampusUseCase {
  const { repository, session, clock, log } = deps

  let state: BindCampusState = INITIAL_STATE
  const listeners = new Set<() => void>()

  function patch(next: Partial<BindCampusState>): BindCampusState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function authenticated(): boolean {
    const snapshot = session.getSnapshot()
    return snapshot.tokens !== null && snapshot.profile !== null
  }

  function unauthenticated(): Result<never, RepositoryError> {
    return err({ code: 'UNAUTHENTICATED', message: '请先登录后再管理校园系统绑定' })
  }

  async function bindEcard(
    credential: CampusCardBindCredential,
  ): Promise<Result<CampusBindingSummary, RepositoryError>> {
    if (!authenticated()) {
      // ⚠️ 未登录与未绑定是**两件事**（契约 I4）：这里必须报 UNAUTHENTICATED
      return unauthenticated()
    }

    // ⚠️ 只记 provider / phase —— credential 不进日志调用
    log?.info('techpie.binding.create.started', { provider: 'ecard', phase: 'phase0' })
    patch({ status: 'submitting', pending: 'create', error: null, notice: null })

    const result = await repository.createBinding(
      { provider: 'ecard', credential },
      createIdempotencyKey('techpie-bind', clock.now()),
    )

    if (!result.ok) {
      // 只记 code：上游 message 可能回显凭证片段，**不进日志**
      log?.warn('techpie.binding.create.failed', { provider: 'ecard', code: result.error.code })
      patch({ status: 'error', pending: null, error: result.error.message })
      return result
    }

    log?.info('techpie.binding.create.succeeded', {
      provider: result.value.provider,
      status: result.value.status,
      bindingId: result.value.id,
    })
    patch({
      status: 'ready',
      pending: null,
      error: null,
      notice: '校园卡绑定成功',
    })
    return ok(result.value)
  }

  async function unbind(id: string): Promise<Result<true, RepositoryError>> {
    if (!authenticated()) return unauthenticated()

    log?.info('techpie.binding.unbind.started', { bindingId: id })
    patch({ status: 'submitting', pending: 'unbind', error: null, notice: null })

    const result = await repository.unbind(
      id,
      createIdempotencyKey('techpie-unbind', clock.now()),
    )

    if (!result.ok) {
      log?.warn('techpie.binding.unbind.failed', { bindingId: id, code: result.error.code })
      patch({ status: 'error', pending: null, error: result.error.message })
      return result
    }

    log?.info('techpie.binding.unbind.succeeded', { bindingId: id })
    patch({ status: 'ready', pending: null, error: null, notice: '已解绑' })
    return ok(true)
  }

  async function renew(id: string): Promise<Result<CampusBindingSummary, RepositoryError>> {
    if (!authenticated()) return unauthenticated()

    log?.info('techpie.binding.renew.started', { bindingId: id })
    patch({ status: 'submitting', pending: 'renew', error: null, notice: null })

    const result = await repository.renew(
      id,
      createIdempotencyKey('techpie-renew', clock.now()),
    )

    if (!result.ok) {
      log?.warn('techpie.binding.renew.failed', { bindingId: id, code: result.error.code })
      patch({ status: 'error', pending: null, error: result.error.message })
      return result
    }

    log?.info('techpie.binding.renew.succeeded', {
      bindingId: id,
      status: result.value.status,
    })
    patch({ status: 'ready', pending: null, error: null, notice: '续期成功' })
    return ok(result.value)
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    bindEcard,

    unbind,

    renew,

    requestPhase1Binding(platform: CampusPlatform): Result<never, RepositoryError> {
      log?.warn('techpie.binding.create.rejected', {
        provider: platform,
        reason: 'PHASE_NOT_AVAILABLE',
      })
      return err({
        code: 'FORBIDDEN',
        message: PHASE1_BINDING_BLOCKED_REASON,
        details: { reason: 'PHASE_NOT_AVAILABLE', provider: platform },
      })
    },

    reset(): void {
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}

/** 供页面在渲染前判断「这个平台能不能发起绑定」——避免画出可点但必然失败的按钮 */
export function canInitiateBinding(platform: CampusPlatform): boolean {
  return isPhase0Bindable(platform)
}
