import { err, ok, type Result } from '@kedaya/shared'

import {
  CAMPUS_CARD_PAYMENT_CODE_REGISTERED,
  type CampusCardPaymentCode,
  type CampusCardTransaction,
} from '../../domain/models/campusCard'
import {
  PHASE0_BINDABLE_PLATFORMS,
  PHASE1_BINDING_BLOCKED_REASON,
  isBindingUsable,
  type CampusBindingSummary,
  type CampusCapability,
} from '../../domain/models/techpie'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CampusBindingPage,
  CampusCardTransactionPage,
  CreateCampusBindingInput,
  ListBindingsQuery,
} from '../../domain/ports/techpieRepository'
import {
  MOCK_BINDINGS,
  MOCK_CAPABILITIES,
  MOCK_CARD_TRANSACTIONS,
  MOCK_ECARD_BINDING,
  MOCK_EXPIRED_EGATE_BINDING,
  MOCK_PAYMENT_CODE_TTL_SEC,
} from './techpieFixtures'

/**
 * TechPie / 校园能力的内存数据库 —— mock repository 的存储内核。
 *
 * 它不只是「返回假数据」，而是把**契约语义**实现了一遍：
 *
 * | 契约条款 | 本文件里的落点 |
 * | --- | --- |
 * | §11.18-D：Phase 0 只允许 `ecard` 绑定 | `createBinding` 拒绝其余平台（`FORBIDDEN`） |
 * | §8.5：`POST /links` 必须带 `Idempotency-Key` | 重复 key 返回**首次**结果，不重复建 |
 * | §8.6 / R4：续期能力不可得 | CASTGC 平台的 `renew` 返回 `RENEW_NOT_SUPPORTED` |
 * | §11.10-E：游标不透明 | 客户端只回传，服务端（此处）自行编码 |
 * | §2.5：校园卡走 OPENID 通道 | 绑定输入是 `wx.login` code，**不是**密码 |
 *
 * ⚠️ 本文件里**没有任何** cookie / CASTGC / 密码字段 —— 不是"暂时没写"，
 * 而是 Phase 0 根本不存在这条路径（契约 §11.18-D）。
 */

/** 游标前缀 —— 客户端**不得**解析它（契约 §11.10-E） */
const CURSOR_PREFIX = 'mock-cursor-'

function encodeCursor(offset: number): string {
  return `${CURSOR_PREFIX}${offset}`
}

function decodeCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined || cursor === '') return 0
  if (!cursor.startsWith(CURSOR_PREFIX)) return 0
  const parsed = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function paginate<T>(
  items: readonly T[],
  query: ListBindingsQuery = {},
): { items: T[]; nextCursor: string | null; total: number } {
  const offset = decodeCursor(query.cursor)
  const limit = query.limit === undefined || query.limit <= 0 ? 20 : Math.min(query.limit, 100)
  const slice = items.slice(offset, offset + limit)
  const nextOffset = offset + slice.length
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    total: items.length,
  }
}

export interface TechpieMemoryDatabase {
  listBindings(query?: ListBindingsQuery): CampusBindingPage
  findBinding(id: string): CampusBindingSummary | null
  createBinding(
    input: CreateCampusBindingInput,
    idempotencyKey?: string,
  ): Result<CampusBindingSummary, RepositoryError>
  unbind(id: string): Result<true, RepositoryError>
  renew(id: string): Result<CampusBindingSummary, RepositoryError>
  capabilities(): CampusCapability[]
  cardTransactions(query?: ListBindingsQuery): CampusCardTransactionPage
  issuePaymentCode(): CampusCardPaymentCode
  /** 只读快照（测试断言用） */
  readonly snapshot: {
    bindings: readonly CampusBindingSummary[]
    idempotencyKeys: readonly string[]
  }
  /* ---------------- 演示控制 ---------------- */
  seedEcardBinding(): void
  seedExpiredEgateBinding(): void
  expireAll(): void
  clearAll(): void
  reset(): void
}

export interface TechpieMemoryDatabaseOptions {
  now?: () => Date
  bindings?: readonly CampusBindingSummary[]
  transactions?: readonly CampusCardTransaction[]
  capabilities?: readonly CampusCapability[]
}

export function createTechpieMemoryDatabase(
  options: TechpieMemoryDatabaseOptions = {},
): TechpieMemoryDatabase {
  const now = options.now ?? (() => new Date())
  const seedBindings = options.bindings ?? MOCK_BINDINGS
  const seedTransactions = options.transactions ?? MOCK_CARD_TRANSACTIONS
  const capabilitiesData = options.capabilities ?? MOCK_CAPABILITIES

  let bindings: CampusBindingSummary[] = [...seedBindings]
  let transactions: CampusCardTransaction[] = [...seedTransactions]
  const idempotency = new Map<string, CampusBindingSummary>()

  function upsert(binding: CampusBindingSummary): CampusBindingSummary {
    bindings = [...bindings.filter((item) => item.id !== binding.id), binding]
    return binding
  }

  function nextId(prefix: string): string {
    return `${prefix}-${String(bindings.length + 1).padStart(4, '0')}-${now().getTime()}`
  }

  return {
    listBindings(query = {}): CampusBindingPage {
      const page = paginate(bindings, query)
      return { items: page.items, nextCursor: page.nextCursor, total: page.total }
    },

    findBinding(id: string): CampusBindingSummary | null {
      return bindings.find((item) => item.id === id) ?? null
    },

    createBinding(
      input: CreateCampusBindingInput,
      idempotencyKey?: string,
    ): Result<CampusBindingSummary, RepositoryError> {
      // 幂等（契约 §11.3）：同一个 key 永远返回**首次**的结果
      if (idempotencyKey !== undefined && idempotency.has(idempotencyKey)) {
        return ok(idempotency.get(idempotencyKey) as CampusBindingSummary)
      }

      // 契约 §11.18-D：Phase 0 只允许校园卡（OPENID 通道）
      if (!PHASE0_BINDABLE_PLATFORMS.includes(input.provider)) {
        return err({
          code: 'FORBIDDEN',
          message: PHASE1_BINDING_BLOCKED_REASON,
          details: { reason: 'PHASE_NOT_AVAILABLE', provider: input.provider },
        })
      }

      // 校园卡走 OPENID 通道：凭证是 `wx.login` 的一次性 code，**不是密码**
      const code = input.credential?.wechatLoginCode ?? ''
      if (code === '') {
        return err({
          code: 'VALIDATION_FAILED',
          message: '缺少微信登录凭证（OPENID 通道需要一次性的 wx.login code）',
          details: { reason: 'OPENID_CODE_REQUIRED' },
        })
      }

      const existing = bindings.find((item) => item.provider === input.provider)
      if (existing !== undefined && isBindingUsable(existing.status)) {
        return err({
          code: 'CONFLICT',
          message: '该校园系统已经绑定过了',
          details: { reason: 'ALREADY_LINKED', provider: input.provider },
        })
      }

      const at = now().toISOString()
      const binding: CampusBindingSummary = {
        id: existing?.id ?? nextId('tpl-ecard'),
        provider: input.provider,
        status: 'ACTIVE',
        displayName: null,
        boundAt: at,
        expiresAt: null,
        lastSyncAt: at,
        phase: 'phase0',
      }
      upsert(binding)
      if (idempotencyKey !== undefined) idempotency.set(idempotencyKey, binding)
      return ok(binding)
    },

    unbind(id: string): Result<true, RepositoryError> {
      const existing = bindings.find((item) => item.id === id)
      if (existing === undefined) {
        return err({ code: 'NOT_FOUND', message: '绑定不存在或不属于你' })
      }
      // 解绑是**硬删**（规格 §5.3：解绑即硬删 sessionCipher）——
      // mock 里没有凭证可删，但语义上必须让条目**消失**，而不是标记失效
      bindings = bindings.filter((item) => item.id !== id)
      return ok(true)
    },

    renew(id: string): Result<CampusBindingSummary, RepositoryError> {
      const existing = bindings.find((item) => item.id === id)
      if (existing === undefined) {
        return err({ code: 'NOT_FOUND', message: '绑定不存在或不属于你' })
      }

      // 规格 §8.6 / R4：CASTGC 平台的续期依赖 TechPie 的自建后端，**不可得**。
      // 这里必须诚实地返回 `RENEW_NOT_SUPPORTED` ——
      // 绝不能假装"已续期"（规格 §10.1 的 F3：不谎称）。
      if (existing.provider !== 'ecard') {
        return err({
          code: 'CONFLICT',
          message:
            '该平台的续期能力尚未确认（依赖上游自建后端，规格 U8 / R4）。可达鸭不会假装已经续期。',
          details: { reason: 'RENEW_NOT_SUPPORTED', provider: existing.provider },
        })
      }

      const at = now().toISOString()
      const renewed: CampusBindingSummary = {
        ...existing,
        status: 'ACTIVE',
        expiresAt: null,
        lastSyncAt: at,
      }
      return ok(upsert(renewed))
    },

    capabilities(): CampusCapability[] {
      return [...capabilitiesData]
    },

    cardTransactions(query = {}): CampusCardTransactionPage {
      const sorted = [...transactions].sort((a, b) =>
        a.occurredAt === b.occurredAt ? b.id.localeCompare(a.id) : b.occurredAt.localeCompare(a.occurredAt),
      )
      const page = paginate(sorted, query)
      return { items: page.items, nextCursor: page.nextCursor, total: page.total }
    },

    issuePaymentCode(): CampusCardPaymentCode {
      const issuedAt = now()
      const expiresAt = new Date(issuedAt.getTime() + MOCK_PAYMENT_CODE_TTL_SEC * 1000)
      return {
        code: `MOCK${String(issuedAt.getTime()).slice(-10)}`,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }
    },

    get snapshot() {
      return { bindings: [...bindings], idempotencyKeys: [...idempotency.keys()] }
    },

    /* ---------------- 演示控制 ---------------- */

    seedEcardBinding(): void {
      upsert({ ...MOCK_ECARD_BINDING, boundAt: now().toISOString() })
    },

    seedExpiredEgateBinding(): void {
      upsert({ ...MOCK_EXPIRED_EGATE_BINDING })
    },

    expireAll(): void {
      bindings = bindings.map((item) => ({ ...item, status: 'EXPIRED' as const }))
    },

    clearAll(): void {
      bindings = []
      transactions = []
    },

    reset(): void {
      bindings = [...seedBindings]
      transactions = [...seedTransactions]
      idempotency.clear()
    },
  }
}

/** 付款码端点是否已登记进冻结契约（透出给 UI，避免 UI 各处硬编码 false） */
export const PAYMENT_CODE_CONTRACT_REGISTERED = CAMPUS_CARD_PAYMENT_CODE_REGISTERED
