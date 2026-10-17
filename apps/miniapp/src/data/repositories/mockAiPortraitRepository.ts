import { err, ok, type Result } from '@kedaya/shared'

import {
  AI_PORTRAIT_MODULE_ID,
  type AiPortraitProfilePayload,
  type AiPortraitServerConsent,
  type AiPortraitSourcesPayload,
} from '../../domain/models/aiPortrait'
import type { AiPortraitRepository } from '../../domain/ports/aiPortraitRepository'
import type { RepositoryError } from '../../domain/ports/errors'

/**
 * Mock AI 画像仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与"假数据"不同，它**复刻了后端 `AiPortraitService` 的领域规则**：
 *   · 未登录一律 UNAUTHENTICATED（画像没有"游客可读"的路径 —— 它必须是本人的）；
 *   · 未二次同意一律 CONSENT_REQUIRED（同意门在读画像**之前**）；
 *   · 归属只认 `viewerId()`：请求里根本无处可传"别人的"用户 id；
 *   · 没有画像行时 `me()` 返回 `null`（**不是**错误）—— 客户端据此走空态；
 *   · `setEnabled` 在没有画像行时 NOT_FOUND；关闭只改 `enabled`，不删数据；
 *   · 撤回同意是幂等的：没有有效记录时返回 `null`；
 *   · `sources()` 公开、不依赖登录与同意（"哪些数据不参与"必须永远显示得出来）。
 *
 * 数据集刻意放在**内存**里，不走 `CachePort`：画像是服务端对你的聚合结论，
 * 不是"我手机里的记录"。把它落盘才是真正的泄漏面 —— 换账号 / 换设备后，
 * 一份旧画像可能被重新读出来当成本人的数据。
 * （多账号之间的隔离由服务端 `userId` 唯一索引保证；Mock 只有一份演示画像，
 * 不假装实现了多账号隔离。真需要"刷新不丢"时，再替换成本模块自己的
 * `CachePort` 实现，页面与用例不用改。）
 *
 * 种子的画像是**克制且真实**的统计标签（吃饭时段、活跃时段、常去地点），
 * 每条都带来源；刻意**不**包含任何来自心理支持 / 宿舍矛盾的标签 ——
 * 那两类数据被排除这件事，在 `sources()` 的清单里就看得见。
 */

export interface MockAiPortraitRepositoryOptions {
  viewerId: () => string | null
  /** 仅供测试 / 演示：替换画像载荷（`null` = 尚无画像，用于演示空态） */
  seed?: AiPortraitProfilePayload | null
  latencyMs?: number
  now?: () => Date
}

export interface MockAiPortraitRepository extends AiPortraitRepository {
  readonly kind: 'mock'
  /** 恢复确定性种子并清空失败注入（同时清掉同意记录与画像，回到"第一次进来"） */
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空画像（演示「目前还没有足够的数据」空态），同意记录不动 */
  clearPortrait(): void
  /** 仅供测试 / 演示：直接替换画像载荷 */
  seedProfile(payload: AiPortraitProfilePayload | null): void
  /** 仅供测试 / 演示：直接给某个主体写入一条有效同意 */
  seedConsent(userId: string): void
  /** 当前主体是否已有有效同意（断言 / 演示用） */
  hasConsent(): boolean
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * 确定性种子：4 条"像统计结果"的标签，每条都能说清来源。
 *
 * 措辞刻意停留在**行为统计**层面（「常在……」「……点后活跃」），
 * 不出现任何评价、诊断或预测 —— 这是本模块文案的硬边界，不是风格偏好。
 */
function defaultSeed(now: Date): AiPortraitProfilePayload {
  const updatedAt = new Date(now.getTime() - 6 * HOUR).toISOString()
  return {
    id: 'ai-portrait-demo',
    enabled: true,
    traits: [
      {
        id: 'breakfast-canteen-2',
        label: '常在第二食堂吃早餐',
        detail: '近 30 天里有 18 个工作日的第一笔食堂消费在二食堂。',
        sources: ['canteen', 'schedule'],
      },
      {
        id: 'active-after-21',
        label: '晚上 9 点后仍较活跃',
        detail: '跑腿与论坛的使用集中在 21:00–24:00 之间。',
        sources: ['errand', 'forum'],
      },
      {
        id: 'study-buddy-library',
        label: '常找图书馆自习搭子',
        detail: '找搭子发布的活动中，自习类占了大多数，地点多在图书馆四楼。',
        sources: ['buddy', 'lost-found'],
      },
      {
        id: 'secondhand-digital',
        label: '常逛数码类二手',
        detail: '跳蚤市场的浏览与收藏以数码配件为主。',
        sources: ['flea-market'],
      },
    ],
    explain: {
      // 整体来源总览：与上面每条自己的来源一致（不是"整体来源冒充单条来源"）
      sources: ['canteen', 'schedule', 'errand', 'forum', 'buddy', 'lost-found', 'flea-market'],
    },
    createdAt: new Date(now.getTime() - 30 * DAY).toISOString(),
    updatedAt,
  }
}

/** 公开的来源清单 —— 与后端 `GET /sources` 同源（含禁读域与排除原因） */
function sourcesPayload(): AiPortraitSourcesPayload {
  return {
    module: AI_PORTRAIT_MODULE_ID,
    allowed: [
      'groupbuy',
      'errand',
      'flea-market',
      'canteen',
      'forum',
      'schedule',
      'lost-found',
      'buddy',
      'wildlife',
      'faq',
    ],
    forbidden: ['wellbeing', 'dorm-harmony'],
    rule: '契约 §9 数据最小化：心理支持（wellbeing）与宿舍矛盾（dorm-harmony）的数据不参与画像',
    catalog: [
      { id: 'groupbuy', nameZh: '拼单', allowed: true, usage: '常拼的品类与时段', connected: false },
      { id: 'errand', nameZh: '跑腿', allowed: true, usage: '常见的代取 / 代送类型与活跃时段', connected: false },
      { id: 'flea-market', nameZh: '跳蚤市场', allowed: true, usage: '常浏览或交易的商品类别', connected: false },
      { id: 'canteen', nameZh: '食堂营养', allowed: true, usage: '常去的食堂与用餐时段', connected: false },
      { id: 'forum', nameZh: '论坛', allowed: true, usage: '常参与的版块', connected: false },
      { id: 'schedule', nameZh: '课表', allowed: true, usage: '有课 / 空闲的时间分布', connected: false },
      { id: 'lost-found', nameZh: '失物招领', allowed: true, usage: '常出现的活动区域', connected: false },
      { id: 'buddy', nameZh: '找搭子', allowed: true, usage: '常找的活动类型', connected: false },
      { id: 'wildlife', nameZh: '猫鸟黑天鹅', allowed: true, usage: '常去观察的校园点位', connected: false },
      { id: 'faq', nameZh: '常见问题', allowed: true, usage: '常查询的主题', connected: false },
      {
        id: 'wellbeing',
        nameZh: '心理支持',
        allowed: false,
        usage: '不参与画像。',
        exclusionReason:
          '这类数据一旦参与画像，会让人不敢使用心理支持服务 —— 代价远大于任何"更懂你"的收益，因此整类排除。',
        connected: false,
      },
      {
        id: 'dorm-harmony',
        nameZh: '宿舍矛盾',
        allowed: false,
        usage: '不参与画像。',
        exclusionReason:
          '宿舍矛盾是匿名提交、只给调解员看的敏感内容；参与画像等于把它与本人重新关联起来，因此整类排除。',
        connected: false,
      },
    ],
    generation: {
      implemented: false,
      connectedSources: 0,
      note: '后端尚未接入任何一类行为数据，也还没有画像生成逻辑：没有画像行时 GET /me 返回 null，小程序据此显示「尚无画像数据」空态，不会在客户端编造标签。',
    },
    explainability:
      '每条标签都必须能说明来源：服务层会把本次用到的数据来源写进 explain.sources；说不清来源的标签既不会写入，也不会展示。',
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockAiPortraitRepository(
  options: MockAiPortraitRepositoryOptions,
): MockAiPortraitRepository {
  const { viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180

  const seedSource = (): AiPortraitProfilePayload | null =>
    options.seed === undefined ? defaultSeed(now()) : options.seed

  let profile: AiPortraitProfilePayload | null = seedSource()
  /** 归属 → 该主体的同意历史（含已撤回条目，与后端 `listByUser` 语义一致） */
  let consentHistory: Array<{ userId: string; record: AiPortraitServerConsent }> = []
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({
        code: 'UPSTREAM_UNAVAILABLE',
        message: '（演示）模拟服务端不可用，请稍后重试',
      })
    }
    return work()
  }

  /** 主体只从登录态取 —— 请求里没有任何"我是谁"的字段可传 */
  function requireViewer(): RepositoryError | string {
    const viewer = viewerId()
    if (viewer === null) return { code: 'UNAUTHENTICATED', message: '查看校园画像需要先登录' }
    return viewer
  }

  function activeConsent(userId: string): AiPortraitServerConsent | null {
    const found = consentHistory.find(
      (entry) => entry.userId === userId && entry.record.revokedAt === null,
    )
    return found?.record ?? null
  }

  /** 同意门：必须在**读画像之前**判定（与后端 `requireConsent` 同一顺序） */
  function requireConsent(userId: string): RepositoryError | null {
    if (activeConsent(userId) !== null) return null
    return { code: 'CONSENT_REQUIRED', message: '请先阅读并同意画像说明' }
  }

  return {
    kind: 'mock',

    async me(): Promise<Result<AiPortraitProfilePayload | null, RepositoryError>> {
      return guard(() => {
        const viewer = requireViewer()
        if (typeof viewer !== 'string') return err(viewer)

        const consentProblem = requireConsent(viewer)
        if (consentProblem !== null) return err(consentProblem)

        // 没有画像行时返回 null：这不是错误，客户端据此走空态
        return ok(profile)
      })
    },

    async sources(): Promise<Result<AiPortraitSourcesPayload, RepositoryError>> {
      // 公开端点：不要求登录，也不要求同意 —— 排除声明必须永远显示得出来
      return guard(() => ok(sourcesPayload()))
    },

    async consents(): Promise<Result<AiPortraitServerConsent[], RepositoryError>> {
      return guard(() => {
        const viewer = requireViewer()
        if (typeof viewer !== 'string') return err(viewer)
        return ok(consentHistory.filter((entry) => entry.userId === viewer).map((entry) => entry.record))
      })
    },

    async grantConsent(): Promise<Result<AiPortraitServerConsent, RepositoryError>> {
      return guard(() => {
        const viewer = requireViewer()
        if (typeof viewer !== 'string') return err(viewer)

        const record: AiPortraitServerConsent = {
          id: `consent-${String(now().getTime())}`,
          module: AI_PORTRAIT_MODULE_ID,
          version: 'v1',
          grantedAt: now().toISOString(),
          revokedAt: null,
        }
        // 幂等：已有效则刷新时间而不是堆一条新的
        consentHistory = [
          ...consentHistory.filter(
            (entry) => !(entry.userId === viewer && entry.record.revokedAt === null),
          ),
          { userId: viewer, record },
        ]
        return ok(record)
      })
    },

    async revokeConsent(): Promise<Result<AiPortraitServerConsent | null, RepositoryError>> {
      return guard(() => {
        const viewer = requireViewer()
        if (typeof viewer !== 'string') return err(viewer)

        const active = activeConsent(viewer)
        // 幂等：没有有效记录时返回 null（与后端 `revoke` 一致），不是失败
        if (active === null) return ok(null)

        const revoked: AiPortraitServerConsent = { ...active, revokedAt: now().toISOString() }
        consentHistory = consentHistory.map((entry) =>
          entry.userId === viewer && entry.record.id === active.id
            ? { userId: viewer, record: revoked }
            : entry,
        )
        return ok(revoked)
      })
    },

    async setEnabled(enabled: boolean): Promise<Result<AiPortraitProfilePayload, RepositoryError>> {
      return guard(() => {
        const viewer = requireViewer()
        if (typeof viewer !== 'string') return err(viewer)

        const consentProblem = requireConsent(viewer)
        if (consentProblem !== null) return err(consentProblem)

        // 没有画像行时不能"凭空建一行"：那是客户端状态错乱，应当报错
        if (profile === null) {
          return err({ code: 'NOT_FOUND', message: '尚未生成画像，无法切换开关' })
        }

        // 关闭只改开关、保留 traits —— 重新开启时画像还在（与后端同一语义）
        profile = { ...profile, enabled, updatedAt: now().toISOString() }
        return ok(profile)
      })
    },

    reset(): void {
      profile = seedSource()
      consentHistory = []
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearPortrait(): void {
      profile = null
    },

    seedProfile(payload: AiPortraitProfilePayload | null): void {
      profile = payload
    },

    seedConsent(userId: string): void {
      consentHistory = [
        ...consentHistory.filter((entry) => !(entry.userId === userId && entry.record.revokedAt === null)),
        {
          userId,
          record: {
            id: `consent-${userId}`,
            module: AI_PORTRAIT_MODULE_ID,
            version: 'v1',
            grantedAt: now().toISOString(),
            revokedAt: null,
          },
        },
      ]
    },

    hasConsent(): boolean {
      const viewer = viewerId()
      return viewer !== null && activeConsent(viewer) !== null
    },
  }
}
