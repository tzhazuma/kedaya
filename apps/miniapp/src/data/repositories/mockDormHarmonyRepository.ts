import { err, ok, type Result } from '@kedaya/shared'

import {
  DORM_HARMONY_BUILDING_MAX,
  DORM_HARMONY_CLOSED_CLOSE_ERROR,
  DORM_HARMONY_CLOSED_MESSAGE_ERROR,
  DORM_HARMONY_CLOSED_REPLY_ERROR,
  DORM_HARMONY_DETAIL_MAX,
  DORM_HARMONY_EXPECTATIONS,
  DORM_HARMONY_MESSAGE_MAX,
  DORM_HARMONY_NOT_FOUND_ERROR,
  DORM_HARMONY_STATUS,
  DORM_HARMONY_TOPIC_MAX,
  DORM_HARMONY_TRACK_CODE_ALPHABET,
  DORM_HARMONY_TRACK_CODE_ERROR,
  codePointLength,
  isDormHarmonyExpectation,
} from '../../domain/models/dormHarmony'
import type {
  DormHarmonyCase,
  DormHarmonyCaseDetail,
  DormHarmonyMessage,
  DormHarmonyMessageResult,
  DormHarmonyStatus,
  SubmitDormHarmonyCaseInput,
  SubmitDormHarmonyCaseResult,
} from '../../domain/models/dormHarmony'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  DormHarmonyRepository,
  TrackDormHarmonyCaseQuery,
} from '../../domain/ports/dormHarmonyRepository'
import { STORAGE_PREFIX } from '../storage/keys'

/**
 * Mock 宿舍矛盾仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 它**复刻后端的领域规则**，而不是假装可用：
 *
 *   · **只存哈希**：`trackCode` 明文在提交响应里返回一次，
 *     缓存里落的是 `sha256(trackCode)`（本文件自带纯 TS SHA-256，
 *     因为小程序运行时没有 `node:crypto`）；明文绝不进 CachePort。
 *   · **防枚举**：案子不存在 / 追踪码错误 / 追踪码缺失 → **同一句** FORBIDDEN 文案，
 *     与后端 `DormHarmonyService.authorize()` 完全一致。
 *   · **状态机**：submitted → in-progress → closed；学生留言会自动推进为 in-progress，
 *     已结案后留言 / 再次结案返回 CONFLICT。
 *   · **匿名**：`anonHandle` 由 `鸭友 + sha256(案子id:随机数)` 前 6 位派生，
 *     与后端同一个算法 —— 因此它看起来、行为上都和真后端一致，也不含任何实名信息。
 *   · **数据落 CachePort**：所以「提交 → 刷新 → 凭追踪码再看」在 mock 下也是真的，
 *     而不是一个只在内存里活几秒的演示。
 *
 * 与其它模块不同，它**没有 `viewerId`**：本模块没有「我的」概念，
 * 也没有任何需要判定归属的读操作 —— 凭据只有追踪码。
 */

export interface MockDormHarmonyRepositoryOptions {
  cache: CachePort
  latencyMs?: number
  now?: () => Date
}

export interface MockDormHarmonyRepository extends DormHarmonyRepository {
  readonly kind: 'mock'
  /** 清空全部 mock 案子（演示空态） */
  clearAll(): void
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
}

/**
 * mock 自己的存储 key。
 *
 * 不能复用 `StorageKeys.dormHarmonyTrackCodes`：那个 key 属于**客户端**的
 * 「追踪码清单」（由用例层维护），这里放的是 mock 的「服务端数据库」，
 * 两者形状完全不同，混在一起会同时毒化两份数据。
 * 也不能往 `data/storage/keys.ts` 里加：那是共享文件。
 */
const MOCK_STORE_KEY = `${STORAGE_PREFIX}dorm-harmony:mock-cases`

/** mock 落库的行：`trackCodeHash` 只在这里出现，对外视图一律剥掉 */
interface MockCaseRow {
  id: string
  anonHandle: string
  trackCodeHash: string
  building: string
  topic: string
  detail: string | null
  expectation: string | null
  status: DormHarmonyStatus
  mediatorId: string | null
  createdAt: string
  updatedAt: string
  messages: DormHarmonyMessage[]
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/* ------------------------------------------------------------------ *
 * 纯 TS SHA-256（与后端 `sha256Hex` 同值；导出便于单测比对标准向量）
 * ------------------------------------------------------------------ */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0
}

/** `noUncheckedIndexedAccess` 下 TypedArray 的下标是 `number | undefined`，这里收口一次 */
function wordAt(words: Uint32Array, index: number): number {
  return words[index] ?? 0
}

function utf8Bytes(input: string): Uint8Array {
  const out: number[] = []
  for (const char of input) {
    const point = char.codePointAt(0) ?? 0
    if (point < 0x80) out.push(point)
    else if (point < 0x800) out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f))
    else if (point < 0x1_0000) {
      out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
    } else {
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      )
    }
  }
  return Uint8Array.from(out)
}

/** `sha256(value)` 的小写十六进制 —— 与后端 `sha256Hex()` 逐位相同 */
export function mockSha256Hex(value: string): string {
  const message = utf8Bytes(value)
  const buffer = new Uint8Array((Math.floor((message.length + 8) / 64) + 1) * 64)
  buffer.set(message)
  buffer[message.length] = 0x80
  const bitLength = message.length * 8
  const view = new DataView(buffer.buffer)
  view.setUint32(buffer.length - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(buffer.length - 4, bitLength >>> 0, false)

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const schedule = new Uint32Array(64)

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) schedule[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const x = wordAt(schedule, i - 15)
      const y = wordAt(schedule, i - 2)
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      schedule[i] = (wordAt(schedule, i - 16) + s0 + wordAt(schedule, i - 7) + s1) >>> 0
    }

    let a = wordAt(state, 0)
    let b = wordAt(state, 1)
    let c = wordAt(state, 2)
    let d = wordAt(state, 3)
    let e = wordAt(state, 4)
    let f = wordAt(state, 5)
    let g = wordAt(state, 6)
    let h = wordAt(state, 7)

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + wordAt(SHA256_K, i) + wordAt(schedule, i)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    state[0] = (wordAt(state, 0) + a) >>> 0
    state[1] = (wordAt(state, 1) + b) >>> 0
    state[2] = (wordAt(state, 2) + c) >>> 0
    state[3] = (wordAt(state, 3) + d) >>> 0
    state[4] = (wordAt(state, 4) + e) >>> 0
    state[5] = (wordAt(state, 5) + f) >>> 0
    state[6] = (wordAt(state, 6) + g) >>> 0
    state[7] = (wordAt(state, 7) + h) >>> 0
  }

  let hex = ''
  for (let i = 0; i < 8; i += 1) hex += wordAt(state, i).toString(16).padStart(8, '0')
  return hex
}

/* ------------------------------------------------------------------ *
 * 生成器（与后端 `verification-code.ts` 同算法）
 * ------------------------------------------------------------------ */

/** `鸭友` + sha256(seed) 前 6 位大写十六进制 —— 不含任何实名信息 */
export function mockAnonymousHandle(seed: string): string {
  return `鸭友${mockSha256Hex(seed).slice(0, 6).toUpperCase()}`
}

/** 一次性追踪码 `XXXX-XXXX-XXXX`（字母表与后端相同） */
export function mockGenerateTrackCode(): string {
  let out = ''
  for (let i = 0; i < 12; i += 1) {
    if (i === 4 || i === 8) out += '-'
    const index = Math.floor(Math.random() * DORM_HARMONY_TRACK_CODE_ALPHABET.length)
    out += DORM_HARMONY_TRACK_CODE_ALPHABET.charAt(index)
  }
  return out
}

/** v4 形状的 id —— 后端用 `randomUUID()`，mock 用同形状的值，避免暴露「这是假的」 */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    const nibble = char === 'x' ? value : (value & 0x3) | 0x8
    return nibble.toString(16)
  })
}

/* ------------------------------------------------------------------ *
 * 校验（逐条复刻 `dorm-harmony.service.ts` 的 normalize* 顺序与文案）
 * ------------------------------------------------------------------ */

interface NormalizedSubmit {
  building: string
  topic: string
  detail: string | null
  expectation: string | null
}

function validationError(message: string, field: string): Result<never, RepositoryError> {
  return err({ code: 'VALIDATION_FAILED', message, details: { field } })
}

function normalizeSubmit(input: SubmitDormHarmonyCaseInput): Result<NormalizedSubmit, RepositoryError> {
  const building = typeof input.building === 'string' ? input.building.trim() : ''
  if (building.length === 0) return validationError('请填写宿舍楼', 'building')
  if (codePointLength(building) > DORM_HARMONY_BUILDING_MAX) {
    return validationError(`宿舍楼最多 ${DORM_HARMONY_BUILDING_MAX} 个字`, 'building')
  }

  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  if (topic.length === 0) return validationError('请简要描述问题', 'topic')
  if (codePointLength(topic) > DORM_HARMONY_TOPIC_MAX) {
    return validationError(`问题描述最多 ${DORM_HARMONY_TOPIC_MAX} 个字`, 'topic')
  }

  const rawDetail = input.detail
  let detail: string | null = null
  if (rawDetail !== undefined && rawDetail !== null) {
    if (typeof rawDetail !== 'string') return validationError('补充说明格式不正确', 'detail')
    const trimmed = rawDetail.trim()
    if (trimmed.length > 0) {
      if (codePointLength(trimmed) > DORM_HARMONY_DETAIL_MAX) {
        return validationError(`补充说明最多 ${DORM_HARMONY_DETAIL_MAX} 个字`, 'detail')
      }
      detail = trimmed
    }
  }

  const rawExpectation = input.expectation
  let expectation: string | null = null
  if (rawExpectation !== undefined && rawExpectation !== null && rawExpectation !== '') {
    if (!isDormHarmonyExpectation(rawExpectation)) {
      return err({
        code: 'VALIDATION_FAILED',
        message: '期望的解决方式不在支持范围内',
        details: { field: 'expectation', allowed: DORM_HARMONY_EXPECTATIONS },
      })
    }
    expectation = rawExpectation
  }

  return ok({ building, topic, detail, expectation })
}

function normalizeBody(body: string): Result<string, RepositoryError> {
  const trimmed = typeof body === 'string' ? body.trim() : ''
  if (trimmed.length === 0) return validationError('请填写留言内容', 'body')
  if (codePointLength(trimmed) > DORM_HARMONY_MESSAGE_MAX) {
    return validationError(`留言最多 ${DORM_HARMONY_MESSAGE_MAX} 个字`, 'body')
  }
  return ok(trimmed)
}

/* ------------------------------------------------------------------ *
 * 视图（**一定**剥掉 trackCodeHash）
 * ------------------------------------------------------------------ */

function toCaseView(row: MockCaseRow): DormHarmonyCase {
  return {
    id: row.id,
    anonHandle: row.anonHandle,
    building: row.building,
    topic: row.topic,
    detail: row.detail,
    status: row.status,
    mediatorId: row.mediatorId,
    expectation: row.expectation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDetailView(row: MockCaseRow): DormHarmonyCaseDetail {
  return { ...toCaseView(row), messages: [...row.messages] }
}

export function createMockDormHarmonyRepository(
  options: MockDormHarmonyRepositoryOptions,
): MockDormHarmonyRepository {
  const { cache } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): MockCaseRow[] {
    const stored = cache.read<unknown>(MOCK_STORE_KEY)
    if (Array.isArray(stored)) return stored as MockCaseRow[]
    return []
  }

  function save(rows: MockCaseRow[]): void {
    cache.write(MOCK_STORE_KEY, rows)
  }

  async function guard<T>(
    work: () => Result<T, RepositoryError>,
  ): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /**
   * 追踪码校验 —— 与后端 `authorize()` 逐条对齐：
   * 「案子不存在」「追踪码缺失」「追踪码错误」合并成同一个 FORBIDDEN，
   * 否则错误追踪码就成了探测案子是否存在的探针。
   *
   * 后端用 `timingSafeEqual` 防时序侧信道；mock 侧比较的是**哈希**，
   * 输入先经过 sha256，字符串比较不会泄漏明文信息，因此无需额外处理。
   */
  function authorize(rows: MockCaseRow[], caseId: string, trackCode: string): MockCaseRow | null {
    const found = rows.find((row) => row.id === caseId) ?? null
    if (found === null) return null
    if (found.trackCodeHash.length === 0) return null
    if (typeof trackCode !== 'string' || trackCode.trim() === '') return null
    // 后端 zod 会先 trim；这里同样先 trim 再哈希
    if (mockSha256Hex(trackCode.trim()) !== found.trackCodeHash) return null
    return found
  }

  return {
    kind: 'mock',

    submit(
      input: SubmitDormHarmonyCaseInput,
    ): Promise<Result<SubmitDormHarmonyCaseResult, RepositoryError>> {
      return guard(() => {
        const normalized = normalizeSubmit(input)
        if (!normalized.ok) return normalized

        const trackCode = mockGenerateTrackCode()
        // 先生成 id：anonHandle 的种子是「案子 id + 随机数」，
        // 保证不同案子即便种子碰撞也拿不到相同 handle（与后端同一设计）。
        const id = randomId()
        const timestamp = now().toISOString()
        const row: MockCaseRow = {
          id,
          anonHandle: mockAnonymousHandle(`${id}:${randomId()}`),
          trackCodeHash: mockSha256Hex(trackCode),
          building: normalized.value.building,
          topic: normalized.value.topic,
          detail: normalized.value.detail,
          expectation: normalized.value.expectation,
          status: DORM_HARMONY_STATUS.submitted,
          mediatorId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          messages: [],
        }
        save([row, ...load()])
        return ok({ case: toCaseView(row), trackCode })
      })
    },

    track(
      query: TrackDormHarmonyCaseQuery,
    ): Promise<Result<DormHarmonyCaseDetail, RepositoryError>> {
      return guard(() => {
        const found = authorize(load(), query.caseId, query.trackCode)
        if (found === null) {
          return err({ code: 'FORBIDDEN', message: DORM_HARMONY_TRACK_CODE_ERROR })
        }
        return ok(toDetailView(found))
      })
    },

    postMessage(
      query: TrackDormHarmonyCaseQuery & { body: string },
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      return guard(() => {
        const rows = load()
        const found = authorize(rows, query.caseId, query.trackCode)
        if (found === null) {
          return err({ code: 'FORBIDDEN', message: DORM_HARMONY_TRACK_CODE_ERROR })
        }
        if (found.status === DORM_HARMONY_STATUS.closed) {
          return err({ code: 'CONFLICT', message: DORM_HARMONY_CLOSED_MESSAGE_ERROR })
        }

        const body = normalizeBody(query.body)
        if (!body.ok) return body

        const message: DormHarmonyMessage = {
          id: randomId(),
          caseId: found.id,
          fromRole: 'student',
          anonHandle: found.anonHandle,
          body: body.value,
          createdAt: now().toISOString(),
        }
        // 留言等价于「双方已开始沟通」：submitted → in-progress（与后端一致）
        const status: DormHarmonyStatus =
          found.status === DORM_HARMONY_STATUS.submitted
            ? DORM_HARMONY_STATUS.inProgress
            : found.status
        const next: MockCaseRow = {
          ...found,
          status,
          messages: [...found.messages, message],
          updatedAt: message.createdAt,
        }
        save(rows.map((row) => (row.id === found.id ? next : row)))
        return ok({ message, caseStatus: status })
      })
    },

    close(query: TrackDormHarmonyCaseQuery): Promise<Result<DormHarmonyCase, RepositoryError>> {
      return guard(() => {
        const rows = load()
        const found = authorize(rows, query.caseId, query.trackCode)
        if (found === null) {
          return err({ code: 'FORBIDDEN', message: DORM_HARMONY_TRACK_CODE_ERROR })
        }
        if (found.status === DORM_HARMONY_STATUS.closed) {
          return err({ code: 'CONFLICT', message: DORM_HARMONY_CLOSED_CLOSE_ERROR })
        }
        const next: MockCaseRow = {
          ...found,
          status: DORM_HARMONY_STATUS.closed,
          updatedAt: now().toISOString(),
        }
        save(rows.map((row) => (row.id === found.id ? next : row)))
        return ok(toCaseView(next))
      })
    },

    mediatorReply(
      caseId: string,
      body: string,
    ): Promise<Result<DormHarmonyMessageResult, RepositoryError>> {
      return guard(() => {
        const rows = load()
        const found = rows.find((row) => row.id === caseId) ?? null
        if (found === null) return err({ code: 'NOT_FOUND', message: DORM_HARMONY_NOT_FOUND_ERROR })
        if (found.status === DORM_HARMONY_STATUS.closed) {
          return err({ code: 'CONFLICT', message: DORM_HARMONY_CLOSED_REPLY_ERROR })
        }

        const normalized = normalizeBody(body)
        if (!normalized.ok) return normalized

        const message: DormHarmonyMessage = {
          id: randomId(),
          caseId: found.id,
          fromRole: 'mediator',
          // 调解员身份记在案子的 mediatorId 上，留言本身不带任何 handle（与后端一致）
          anonHandle: null,
          body: normalized.value,
          createdAt: now().toISOString(),
        }
        const next: MockCaseRow = {
          ...found,
          // 后端从 JWT 取调解员 id；mock 没有登录态，用占位值表达「已介入」
          mediatorId: 'mock-mediator',
          status: DORM_HARMONY_STATUS.inProgress,
          messages: [...found.messages, message],
          updatedAt: message.createdAt,
        }
        save(rows.map((row) => (row.id === found.id ? next : row)))
        return ok({ message, caseStatus: next.status })
      })
    },

    clearAll(): void {
      save([])
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(MOCK_STORE_KEY)
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },
  }
}
