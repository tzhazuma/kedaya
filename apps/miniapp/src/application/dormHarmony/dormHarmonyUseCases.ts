import { err, type Result } from '@kedaya/shared'

import {
  DORM_HARMONY_MODULE_ID,
  DORM_HARMONY_NOT_LOCAL_MESSAGE,
  DORM_HARMONY_TRACK_CODE_MAX,
  isDormHarmonyStatus,
  normalizeTrackCode,
  summarizeCase,
  validateMessageBody,
  validateSubmitDraft,
  withCaseStatus,
} from '../../domain/models/dormHarmony'
import type {
  DormHarmonyCase,
  DormHarmonyCaseDetail,
  DormHarmonyCaseSummary,
  DormHarmonyMessageResult,
  SubmitDormHarmonyCaseInput,
  SubmitDormHarmonyCaseResult,
} from '../../domain/models/dormHarmony'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { DormHarmonyRepository } from '../../domain/ports/dormHarmonyRepository'

/**
 * 宿舍矛盾用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 除了转发案子读写，它承担两件**只有客户端能做**的事：
 *
 *   1. **追踪码保管**：后端只存 `sha256(trackCode)`，明文只在提交响应里出现一次，
 *      丢了就是真的丢了。所以提交成功后**立刻**把 `{ trackCode, summary, createdAt }`
 *      落本地；页面靠它才能在下一次打开时继续跟进。
 *      因为服务端刻意不提供「凭追踪码反查案件」，本地记录里连**案件编号**一起存
 *      （`summary.id`）—— 换设备时两样都要有。
 *   2. **二次同意**（契约 §9）：高敏感模块必须显式同意，同意记录落本地
 *      （`{ acceptedAt, version }`，按模块 id 存在共享的 consent key 下，
 *      不覆盖其它敏感模块的条目）。同意版本对不上就要重新同意。
 */

/**
 * 本地 key 字面量。
 *
 * 为什么在这里写死而不是 `import { StorageKeys } from '../../data/storage/keys'`：
 * `application/**` 禁止 import `data/**`（契约 §7，ESLint `no-restricted-imports`），
 * 而装配层给本用例的依赖只有 `repository / cache / clock`（没有注入 key）。
 * 因此这里与 `data/storage/keys.ts` 的 `StorageKeys.consent` /
 * `StorageKeys.dormHarmonyTrackCodes` 保持**同一字面量**；keys.ts 是权威来源。
 * 单测里有一致性断言，防止两边悄悄漂移。
 */
export const DORM_HARMONY_CONSENT_CACHE_KEY = 'kedaya:v1:consent'
export const DORM_HARMONY_TRACK_CODES_CACHE_KEY = 'kedaya:v1:dorm-harmony:track-codes'

/** 同意文案版本：改文案就改版本号，旧同意自动失效并重新征求（契约 §9） */
export const DORM_HARMONY_CONSENT_VERSION = 'v1'

/** 本地最多保留多少条追踪码记录，防止无限增长 */
export const DORM_HARMONY_MAX_SAVED_CASES = 50

/** 本地保存的一条「凭据」：追踪码 + 案件摘要（摘要里含案件编号） */
export interface DormHarmonyTrackRecord {
  trackCode: string
  summary: DormHarmonyCaseSummary
  createdAt: string
}

export interface DormHarmonyConsentRecord {
  acceptedAt: string
  version: string
}

export interface DormHarmonyUseCasesDeps {
  repository: DormHarmonyRepository
  cache: CachePort
  clock: ClockPort
}

export interface DormHarmonyUseCases {
  /* 契约 §9：二次同意 */
  hasConsented(): boolean
  acceptConsent(): DormHarmonyConsentRecord
  revokeConsent(): void

  /* 本地追踪码（凭据）管理 */
  savedCases(): DormHarmonyTrackRecord[]
  remember(trackCode: string, summary: DormHarmonyCaseSummary): DormHarmonyTrackRecord
  forget(trackCode: string): void

  /* 匿名案子（追踪码即能力，无需登录） */
  submit(
    input: SubmitDormHarmonyCaseInput,
  ): Promise<Result<SubmitDormHarmonyCaseResult, RepositoryError>>

  /**
   * 出示追踪码查看详情。
   *
   * `caseId` 省略时从本地记录里解出案件编号；都没有则明确失败，
   * 而不是发一个注定 403 的请求（那样只会看到「追踪码不正确」，把人误导到错误方向）。
   */
  track(
    trackCode: string,
    caseId?: string | null,
  ): Promise<Result<DormHarmonyCaseDetail, RepositoryError>>

  postMessage(
    caseId: string,
    trackCode: string,
    body: string,
  ): Promise<Result<DormHarmonyMessageResult, RepositoryError>>

  close(caseId: string, trackCode: string): Promise<Result<DormHarmonyCase, RepositoryError>>

  /** 调解员入口（需要登录）—— 学生页面不暴露，保留以便与后端逐条对齐 */
  mediatorReply(
    caseId: string,
    body: string,
  ): Promise<Result<DormHarmonyMessageResult, RepositoryError>>
}

/* ------------------------------------------------------------------ *
 * 缓存形状守卫（坏缓存绝不允许喂给 UI）
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isDormHarmonyCaseSummary(value: unknown): value is DormHarmonyCaseSummary {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.anonHandle === 'string' &&
    typeof value.building === 'string' &&
    typeof value.topic === 'string' &&
    isDormHarmonyStatus(value.status) &&
    typeof value.statusLabel === 'string' &&
    (value.expectationLabel === null || typeof value.expectationLabel === 'string') &&
    typeof value.mediatorLabel === 'string' &&
    typeof value.timeLabel === 'string' &&
    typeof value.createdAt === 'string'
  )
}

export function isDormHarmonyTrackRecord(value: unknown): value is DormHarmonyTrackRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.trackCode === 'string' &&
    value.trackCode !== '' &&
    typeof value.createdAt === 'string' &&
    isDormHarmonyCaseSummary(value.summary)
  )
}

export function createDormHarmonyUseCases(deps: DormHarmonyUseCasesDeps): DormHarmonyUseCases {
  const { repository, cache, clock } = deps

  /* ------------------------------ 同意 ------------------------------ */

  function readConsentMap(): Record<string, unknown> {
    const raw = cache.read<unknown>(DORM_HARMONY_CONSENT_CACHE_KEY)
    return isRecord(raw) ? { ...raw } : {}
  }

  function readConsent(): DormHarmonyConsentRecord | null {
    const entry = readConsentMap()[DORM_HARMONY_MODULE_ID]
    if (!isRecord(entry)) return null
    if (typeof entry.acceptedAt !== 'string' || entry.acceptedAt === '') return null
    if (typeof entry.version !== 'string' || entry.version === '') return null
    return { acceptedAt: entry.acceptedAt, version: entry.version }
  }

  /* --------------------------- 本地追踪码 --------------------------- */

  function readTrackRecords(): DormHarmonyTrackRecord[] {
    const raw = cache.read<unknown>(DORM_HARMONY_TRACK_CODES_CACHE_KEY)
    if (!Array.isArray(raw)) return []

    const seen = new Set<string>()
    const records: DormHarmonyTrackRecord[] = []
    for (const entry of raw) {
      // 逐条校验并**丢弃**坏条目：一份旧格式缓存不该让整页白屏
      if (!isDormHarmonyTrackRecord(entry)) continue
      if (seen.has(entry.trackCode)) continue
      seen.add(entry.trackCode)
      records.push(entry)
    }
    return records
  }

  function writeTrackRecords(records: readonly DormHarmonyTrackRecord[]): void {
    if (records.length === 0) {
      cache.remove(DORM_HARMONY_TRACK_CODES_CACHE_KEY)
      return
    }
    cache.write(DORM_HARMONY_TRACK_CODES_CACHE_KEY, records.slice(0, DORM_HARMONY_MAX_SAVED_CASES))
  }

  function findRecord(trackCode: string): DormHarmonyTrackRecord | null {
    return readTrackRecords().find((record) => record.trackCode === trackCode) ?? null
  }

  /** 本地的状态标签要跟着服务端走，否则列表会一直显示「已提交」 */
  function touchLocalStatus(trackCode: string, status: string): void {
    const code = normalizeTrackCode(trackCode)
    const records = readTrackRecords()
    if (!records.some((record) => record.trackCode === code)) return
    writeTrackRecords(
      records.map((record) =>
        record.trackCode === code
          ? { ...record, summary: withCaseStatus(record.summary, status, clock.now()) }
          : record,
      ),
    )
  }

  function remember(
    trackCode: string,
    summary: DormHarmonyCaseSummary,
  ): DormHarmonyTrackRecord {
    const code = normalizeTrackCode(trackCode)
    const existing = readTrackRecords()
    const previous = existing.find((record) => record.trackCode === code)
    const record: DormHarmonyTrackRecord = {
      trackCode: code,
      summary,
      // 保留首次保存时间：排序稳定，用户不会觉得「记录刚被重置」
      createdAt: previous?.createdAt ?? clock.now().toISOString(),
    }
    if (code !== '') {
      writeTrackRecords([record, ...existing.filter((item) => item.trackCode !== code)])
    }
    return record
  }

  /* ------------------------------ 用例 ------------------------------ */

  function trackCodeProblem(trackCode: string): RepositoryError | null {
    if (trackCode.length === 0) {
      return { code: 'VALIDATION_FAILED', message: '请填写追踪码' }
    }
    if (trackCode.length > DORM_HARMONY_TRACK_CODE_MAX) {
      return {
        code: 'VALIDATION_FAILED',
        message: `追踪码最多 ${DORM_HARMONY_TRACK_CODE_MAX} 个字符`,
      }
    }
    return null
  }

  /** mediatorReply 只有 caseId，本地记录是按追踪码存的，所以按 summary.id 反查 */
  function touchLocalStatusByCaseId(caseId: string, status: string): void {
    const records = readTrackRecords()
    const found = records.find((record) => record.summary.id === caseId)
    if (found === undefined) return
    touchLocalStatus(found.trackCode, status)
  }

  return {
    hasConsented(): boolean {
      const record = readConsent()
      return record !== null && record.version === DORM_HARMONY_CONSENT_VERSION
    },

    acceptConsent(): DormHarmonyConsentRecord {
      const record: DormHarmonyConsentRecord = {
        acceptedAt: clock.now().toISOString(),
        version: DORM_HARMONY_CONSENT_VERSION,
      }
      // 合并写回：consent key 是多个敏感模块共用的，不能整块覆盖
      cache.write(DORM_HARMONY_CONSENT_CACHE_KEY, {
        ...readConsentMap(),
        [DORM_HARMONY_MODULE_ID]: record,
      })
      return record
    },

    revokeConsent(): void {
      const map = readConsentMap()
      delete map[DORM_HARMONY_MODULE_ID]
      if (Object.keys(map).length === 0) cache.remove(DORM_HARMONY_CONSENT_CACHE_KEY)
      else cache.write(DORM_HARMONY_CONSENT_CACHE_KEY, map)
    },

    savedCases: () => readTrackRecords(),
    remember,
    forget(trackCode: string): void {
      const code = normalizeTrackCode(trackCode)
      writeTrackRecords(readTrackRecords().filter((record) => record.trackCode !== code))
    },

    async submit(
      input: SubmitDormHarmonyCaseInput,
    ): Promise<Result<SubmitDormHarmonyCaseResult, RepositoryError>> {
      const problems = validateSubmitDraft({
        building: input.building,
        topic: input.topic,
        detail: input.detail ?? '',
        expectation: input.expectation ?? '',
      })
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const detail = (input.detail ?? '').trim()
      const result = await repository.submit({
        building: input.building.trim(),
        topic: input.topic.trim(),
        detail: detail === '' ? null : detail,
        expectation: input.expectation === '' ? null : (input.expectation ?? null),
      })
      if (!result.ok) return result

      // 追踪码明文只在这一次响应里出现 —— 就地落本地，页面随后展示给用户
      remember(result.value.trackCode, summarizeCase(result.value.case, clock.now()))
      return result
    },

    async track(
      trackCode: string,
      caseId?: string | null,
    ): Promise<Result<DormHarmonyCaseDetail, RepositoryError>> {
      const code = normalizeTrackCode(trackCode)
      const problem = trackCodeProblem(code)
      if (problem !== null) return err(problem)

      const explicit = caseId ?? ''
      const resolved =
        explicit !== '' ? explicit : (findRecord(code)?.summary.id ?? null)
      if (resolved === null) {
        return err({ code: 'NOT_FOUND', message: DORM_HARMONY_NOT_LOCAL_MESSAGE })
      }

      const result = await repository.track({ caseId: resolved, trackCode: code })
      if (!result.ok) return result

      // 状态 / 调解员可能已经变化：顺手刷新本地摘要
      remember(code, summarizeCase(result.value, clock.now()))
      return result
    },

    async postMessage(
      caseId: string,
      trackCode: string,
      body: string,
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      const problems = validateMessageBody(body)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查留言内容' })
      }

      const result = await repository.postMessage({
        caseId,
        trackCode: normalizeTrackCode(trackCode),
        body: body.trim(),
      })
      if (result.ok) touchLocalStatus(trackCode, result.value.caseStatus)
      return result
    },

    async close(
      caseId: string,
      trackCode: string,
    ): Promise<Result<DormHarmonyCase, RepositoryError>> {
      const result = await repository.close({
        caseId,
        trackCode: normalizeTrackCode(trackCode),
      })
      if (result.ok) touchLocalStatus(trackCode, result.value.status)
      return result
    },

    async mediatorReply(
      caseId: string,
      body: string,
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      const problems = validateMessageBody(body)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查留言内容' })
      }
      const result = await repository.mediatorReply(caseId, body.trim())
      if (result.ok) touchLocalStatusByCaseId(caseId, result.value.caseStatus)
      return result
    },
  }
}
