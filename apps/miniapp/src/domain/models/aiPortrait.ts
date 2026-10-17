import { formatRelativeTime } from '@kedaya/shared'

/**
 * AI 校园画像（`ai-portrait`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/ai-portrait/domain/ai-portrait.domain.ts`
 * 及 `ai-portrait.service.ts` 逐条对齐：
 *   · 归属只来自 JWT —— 客户端连用户 id 都不发，请求体 / 查询参数里没有归属字段；
 *   · 数据最小化 —— `wellbeing`（心理支持）与 `dorm-harmony`（宿舍矛盾）**整类排除**；
 *   · 可解释 —— 每条标签都必须能说明来源，说不清来源的标签**不展示**；
 *   · 可关闭 —— `enabled` 开关；关闭后不再刷新、不再展示。
 *
 * ## 这个模型的三条自我约束（不是可选的"文案规范"）
 *
 * 1. **不做评价、不做诊断**：画像 = 基于你自己在校内使用行为的**聚合统计**。
 *    这里没有任何"预测 / 诊断 / 心理评估"的措辞，也不允许将来加进来。
 * 2. **不编造**：后端还没有生成逻辑（`GET /me` 没有画像行时返回 `null`），
 *    此时页面必须给空态，绝不拿"看起来像画像"的假标签顶上。
 * 3. **不截断结论**：标签超长时**丢弃而不是截断** —— 截断会改写结论的意思
 *    （「你常在二食堂吃早餐」被截成「你常在二食堂吃」就不再是同一句话了），
 *    画像宁可少展示一条，也不展示一条被改写过的结论。
 */

export const AI_PORTRAIT_MODULE_ID = 'ai-portrait'

/* ------------------------------------------------------------------ *
 * 字段上限（客户端接受的后端画像载荷形状；超出即丢弃该条并计数）
 * ------------------------------------------------------------------ */

export const AI_PORTRAIT_TRAIT_LABEL_MAX = 40
export const AI_PORTRAIT_TRAIT_DETAIL_MAX = 120
/** 一次最多展示多少条标签（多出来的丢弃并计数，而不是无限刷屏） */
export const AI_PORTRAIT_MAX_TRAITS = 20
/** 单条标签最多引用几类来源 */
export const AI_PORTRAIT_MAX_SOURCES_PER_TRAIT = 6

/* ------------------------------------------------------------------ *
 * 文案常量（两个页面共用一份，避免各写一份后漂移）
 * ------------------------------------------------------------------ */

/** 一句话定位：必须先说清"这是统计，不是评价" */
export const AI_PORTRAIT_POSITIONING =
  '这是根据你在可达鸭里的使用记录汇总的统计画像，不是对你的评价或诊断。'

/** 空态：没有足够数据时如实说明（后端尚无生成逻辑时这也是常态） */
export const AI_PORTRAIT_EMPTY_TITLE = '目前还没有足够的数据生成画像'
export const AI_PORTRAIT_EMPTY_TIP = '多用一段时间再来看看。画像只从你自己的使用记录汇总，不会有别人的数据。'

/** 高敏感标注（页头用，与契约一致） */
export const AI_PORTRAIT_SENSITIVITY_LABEL = '高敏感'

/** 第三方非官方声明（与其它页面同源） */
export const AI_PORTRAIT_DISCLAIMER =
  '可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。画像只基于你自己在可达鸭里的使用记录，不代表任何校方评价。'

/** 「心理支持与宿舍矛盾不参与画像」—— 这条是信任基础，不是可选文案 */
export const AI_PORTRAIT_EXCLUSION_TEXT = '心理支持与宿舍矛盾的数据不参与画像。'

/** 二次同意的开场说明 */
export const AI_PORTRAIT_CONSENT_INTRO =
  '「AI 校园画像」把你在可达鸭里的使用记录汇总成一份统计画像，方便你回看自己的校园生活节奏。开启前请先读下面四点。'

/**
 * 二次同意的四条要点。
 *
 * 第 2 条（禁止来源）与第 3 条（可解释）是这个模块能被信任的前提，
 * 因此写在同意门里而不是藏在二级页：用户必须在**看到任何标签之前**知道这两件事。
 */
export const AI_PORTRAIT_CONSENT_POINTS: readonly string[] = [
  '1. 只做统计，不做评价：画像是你自己使用记录的聚合结果，不评价你这个人，也不做任何心理评估或预测。',
  '2. 心理支持与宿舍矛盾的数据不参与画像：这两类数据最敏感，一旦参与画像，会让人不敢使用它们，因此整类排除。',
  '3. 每条结论都能看到来源：标签旁有「来源」入口，可以看这条是怎么得出来的；说不清来源的标签不会展示。',
  '4. 随时可以关掉或撤回：关掉后不再刷新、不再展示；撤回同意后需要重新同意才能再看到。',
]

/**
 * 关闭画像前的一次性说明 —— 必须写清"关掉之后会发生什么"。
 *
 * 这里刻意区分**两层开关**（"以为关掉了其实没关"是不可接受的）：
 *   · 本页开关 = 要不要**看到**画像（本模块的 `enabled`）；
 *   · 「我的 → 隐私与数据」里的 AI 画像开关 = 是否**允许生成**画像（另一层设置）。
 * 只关本页不会改另一层，所以要说出来。
 */
export const AI_PORTRAIT_DISABLE_NOTICE =
  '关掉之后：不再刷新画像、也不再展示任何标签；已有画像数据不会被删除，重新开启就能再看到。'

export const AI_PORTRAIT_TWO_SWITCH_NOTE =
  '注意这是两层开关：这里管「要不要看到画像」；「我的 → 隐私与数据」里的 AI 画像开关管「是否允许生成画像」，两边互相独立，只关一边另一边不会跟着变。'

/** 撤回同意前的一次性说明 */
export const AI_PORTRAIT_REVOKE_NOTICE =
  '撤回之后：这个模块立刻停止读取你的记录，也不再刷新画像；已有画像数据不会被删除，重新同意即可再次查看。本地会删掉这条同意记录（同意历史在服务端留有「已撤回」的记录）。'

/** 未经同意时的拒绝说明（同意门里"暂时不用"那一态） */
export const AI_PORTRAIT_DECLINED_TEXT =
  '没有记录任何同意，也没有读取任何画像数据。你可以随时重新进入。'

/** 未登录引导 */
export const AI_PORTRAIT_LOGIN_TIP =
  '画像必须是「你自己的」，所以要先登录 —— 未登录时不会请求、也不会看到任何画像内容。'

/** 登录后在本页做动作的提示 */
export const AI_PORTRAIT_NOT_LOGGED_MESSAGE = '查看校园画像需要先登录'

/* ------------------------------------------------------------------ *
 * 「禁止来源」清单（与后端 FORBIDDEN_PORTRAIT_SOURCES 同源）
 * ------------------------------------------------------------------ */

/**
 * 被排除在画像之外的数据来源。
 *
 * 这里在客户端**再写一份**（而不是只依赖后端 `GET /sources`）是刻意的：
 * 排除声明必须在**离线、接口失败、同意门**三种情况下都能显示出来 ——
 * 让"哪些数据不参与"依赖一次网络请求，是最不该省的依赖。
 * 单测会断言这里的 id 与后端来源清单里的禁止项一致。
 */
export interface ForbiddenPortraitSource {
  id: string
  nameZh: string
  /** 为什么排除（页面上要说得出口，而不是只写"已排除"） */
  reason: string
}

export const FORBIDDEN_PORTRAIT_SOURCES: readonly ForbiddenPortraitSource[] = [
  {
    id: 'wellbeing',
    nameZh: '心理支持',
    reason:
      '这类数据一旦参与画像，会让人不敢使用心理支持服务 —— 代价远大于任何"更懂你"的收益，因此整类排除。',
  },
  {
    id: 'dorm-harmony',
    nameZh: '宿舍矛盾',
    reason:
      '宿舍矛盾是匿名提交、只给调解员看的敏感内容；参与画像等于把它与本人重新关联起来，因此整类排除。',
  },
]

export const FORBIDDEN_PORTRAIT_SOURCE_IDS: readonly string[] = FORBIDDEN_PORTRAIT_SOURCES.map(
  (source) => source.id,
)

/* ------------------------------------------------------------------ *
 * 载荷 → 视图（纯函数：把后端 `unknown` 的 JSON 收敛成"每句话都说得清来源"的标签）
 * ------------------------------------------------------------------ */

/** 后端 `GET /sources` 返回的一条来源说明 */
export interface PortraitSourceDescriptor {
  id: string
  nameZh: string
  allowed: boolean
  usage: string
  exclusionReason?: string
  /** 现在是否真的在被读取（后端当前一律 false） */
  connected: boolean
}

/** 后端 `GET /sources` 的载荷 */
export interface AiPortraitSourcesPayload {
  module: string
  allowed: string[]
  forbidden: string[]
  rule: string
  catalog: PortraitSourceDescriptor[]
  generation: { implemented: boolean; connectedSources: number; note: string }
  explainability: string
}

/** 后端 `GET /me` 的载荷（`traits` / `explain` 是 JSON，因此类型上是 `unknown`） */
export interface AiPortraitProfilePayload {
  id: string
  traits: unknown
  explain: unknown
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 一条标签引用的来源（页面据此说明"这条是怎么来的"） */
export interface PortraitSourceRef {
  id: string
  nameZh: string
  usage: string
}

export interface PortraitTraitView {
  id: string
  label: string
  detail: string | null
  /** 非空 —— 没有来源的标签不会出现在视图里 */
  sources: PortraitSourceRef[]
}

export interface AiPortraitView {
  /** 开关状态：关闭时 `traits` 一定为空（不再展示） */
  enabled: boolean
  traits: PortraitTraitView[]
  /**
   * 因为"说不清来源 / 来源越界 / 超长 / 超量"被丢弃的标签条数。
   * 页面用它如实说明"有几条没有展示、为什么"。
   */
  droppedTraits: number
  /** 本次画像整体用到的数据来源（来自 `explain.sources`） */
  roundSources: PortraitSourceRef[]
  updatedAt: string | null
  updatedLabel: string | null
  /** 需要向用户解释时的一句话（例如"有 2 条标签因说不清来源未展示"） */
  note: string | null
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数：解析载荷时逐条判定，非法即丢弃该条）
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function labelProblem(label: string): string | null {
  const text = label.trim()
  if (text.length === 0) return '标签内容为空'
  if ([...text].length > AI_PORTRAIT_TRAIT_LABEL_MAX) {
    return `标签最多 ${AI_PORTRAIT_TRAIT_LABEL_MAX} 个字`
  }
  return null
}

export function detailProblem(detail: string): string | null {
  if ([...detail.trim()].length > AI_PORTRAIT_TRAIT_DETAIL_MAX) {
    return `标签说明最多 ${AI_PORTRAIT_TRAIT_DETAIL_MAX} 个字`
  }
  return null
}

/** 空串等价于「没写」（与后端 normalizeText 的语义一致） */
function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length === 0 ? null : text
}

/** 已知来源 → 中文名与用途；未知来源如实标出 id（不猜它在做什么） */
function toSourceRef(id: string, catalog: readonly PortraitSourceDescriptor[]): PortraitSourceRef {
  const found = catalog.find((item) => item.id === id)
  if (found === undefined) {
    return { id, nameZh: id, usage: '不在来源清单中（未登记的来源）' }
  }
  return { id, nameZh: found.nameZh, usage: found.usage }
}

function toSourceRefList(
  raw: unknown,
  catalog: readonly PortraitSourceDescriptor[],
): PortraitSourceRef[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id === '' || ids.includes(id)) continue
    ids.push(id)
  }
  return ids.map((id) => toSourceRef(id, catalog))
}

/** `explain` 里按标签 id 存的说明（`explain` 的形状是 JSON，逐层判类型） */
function explainFor(explain: unknown, traitId: string): Record<string, unknown> | null {
  if (!isRecord(explain)) return null
  const entry = explain[traitId]
  return isRecord(entry) ? entry : null
}

/** 全局 `explain.sources`（本次画像整体用到的数据来源） */
function roundSourceIds(explain: unknown): unknown {
  return isRecord(explain) ? explain.sources : undefined
}

/**
 * 把 `traits` 收敛成"待判定"的条目列表。
 *
 * 接受两种形状（后端目前还没有生成逻辑，这是**目标形状**，因此解析要宽容、
 * 判定要严格）：
 *   · 数组：`[{ id | key, label | title, detail | reason, sources }]`（推荐）
 *   · 字典：`{ [traitId]: string | { label, detail, sources } }`
 * 其余形状一律不解析（返回空数组 → 页面走空态，而不是崩掉或显示半截数据）。
 */
interface RawTrait {
  id: string
  label: unknown
  detail: unknown
  sources: unknown
}

function collectTraits(traits: unknown): RawTrait[] {
  const collected: RawTrait[] = []

  if (Array.isArray(traits)) {
    traits.forEach((entry, index) => {
      if (typeof entry === 'string') {
        collected.push({ id: `trait-${String(index)}`, label: entry, detail: null, sources: undefined })
        return
      }
      if (!isRecord(entry)) return
      const id =
        normalizeOptionalText(entry.id) ?? normalizeOptionalText(entry.key) ?? `trait-${String(index)}`
      collected.push({
        id,
        label: entry.label ?? entry.title,
        detail: entry.detail ?? entry.reason,
        sources: entry.sources,
      })
    })
    return collected
  }

  if (isRecord(traits)) {
    for (const [key, value] of Object.entries(traits)) {
      if (typeof value === 'string') {
        collected.push({ id: key, label: value, detail: null, sources: undefined })
        continue
      }
      if (!isRecord(value)) continue
      collected.push({
        id: key,
        label: value.label ?? value.title ?? key,
        detail: value.detail ?? value.reason,
        sources: value.sources,
      })
    }
  }

  return collected
}

/**
 * 载荷 → 视图。
 *
 * 判定顺序即优先级（**先合规，再完整**）：
 *   1. 未开启（`enabled === false`）→ 不解析标签，直接给空（"关掉之后不再展示"）；
 *   2. 标签必须有**自己的**来源（`trait.sources` 或 `explain[traitId].sources`）；
 *      `explain.sources` 是整体来源，只做总览 —— 不能拿它冒充某条标签的来源；
 *   3. 来源里出现禁止来源（`wellbeing` / `dorm-harmony`）或不在白名单里的 id → 丢弃该条；
 *   4. 标签 / 说明超长或为空 → 丢弃该条（见文件头的"不截断结论"）；
 *   5. 超过 `AI_PORTRAIT_MAX_TRAITS` → 丢弃多余条目并计数。
 *
 * `catalog` 传入后端来源清单（可为空数组：离线时仍能给出源 id 与排除理由）。
 */
export function toPortraitView(
  payload: AiPortraitProfilePayload,
  catalog: readonly PortraitSourceDescriptor[],
  allowedIds: readonly string[],
  now: Date,
): AiPortraitView {
  const roundSources = toSourceRefList(roundSourceIds(payload.explain), catalog)
  const updatedAt = normalizeOptionalText(payload.updatedAt)

  if (payload.enabled !== true) {
    return {
      enabled: false,
      traits: [],
      droppedTraits: 0,
      roundSources,
      updatedAt,
      updatedLabel: updatedAt === null ? null : formatRelativeTime(updatedAt, now),
      note: null,
    }
  }

  const forbiddenIds = new Set(FORBIDDEN_PORTRAIT_SOURCE_IDS)
  const allowed = new Set(allowedIds)
  const candidates = collectTraits(payload.traits)

  const traits: PortraitTraitView[] = []
  let dropped = 0

  for (const candidate of candidates) {
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    if (labelProblem(label) !== null) {
      dropped += 1
      continue
    }

    const detail = normalizeOptionalText(candidate.detail)
    if (detail !== null && detailProblem(detail) !== null) {
      dropped += 1
      continue
    }

    const ownRaw =
      Array.isArray(candidate.sources) && candidate.sources.length > 0
        ? candidate.sources
        : explainFor(payload.explain, candidate.id)?.sources
    const own = toSourceRefList(ownRaw, catalog)
    // 可解释性优先：没有自己的来源，就不展示（不用整体来源冒充）
    if (own.length === 0) {
      dropped += 1
      continue
    }
    // 来源越界（禁止来源 / 未登记的来源 id）→ 丢弃，并且**绝不展示**该条
    if (
      own.some(
        (source) => forbiddenIds.has(source.id) || (allowed.size > 0 && !allowed.has(source.id)),
      )
    ) {
      dropped += 1
      continue
    }

    traits.push({
      id: candidate.id,
      label,
      detail,
      sources: own.slice(0, AI_PORTRAIT_MAX_SOURCES_PER_TRAIT),
    })
  }

  const visible = traits.slice(0, AI_PORTRAIT_MAX_TRAITS)
  const overflow = traits.length - visible.length
  dropped += overflow

  return {
    enabled: true,
    traits: visible,
    droppedTraits: dropped,
    roundSources,
    updatedAt,
    updatedLabel: updatedAt === null ? null : formatRelativeTime(updatedAt, now),
    note: dropped === 0 ? null : `有 ${String(dropped)} 条内容因为没有可核对的来源（或超出长度上限）没有展示。`,
  }
}

/** 视图是否"什么都没有"（页面据此走空态，而不是画一张空卡片） */
export function isPortraitEmpty(view: AiPortraitView): boolean {
  return view.enabled && view.traits.length === 0
}

/* ------------------------------------------------------------------ *
 * 本地同意记录
 * ------------------------------------------------------------------ */

/** 同意文案版本：改文案就改版本号，旧同意自动失效并重新征求意见（契约 §9） */
export const AI_PORTRAIT_CONSENT_VERSION = 'v1'

export interface AiPortraitConsentRecord {
  acceptedAt: string
  version: string
}

export function isAiPortraitConsentRecord(value: unknown): value is AiPortraitConsentRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.acceptedAt === 'string' &&
    value.acceptedAt !== '' &&
    typeof value.version === 'string' &&
    value.version !== ''
  )
}

/** 服务端同意记录（`GET /consents` 的条目；时间以 ISO 字符串传输） */
export interface AiPortraitServerConsent {
  id: string
  module: string
  version: string
  grantedAt: string
  revokedAt: string | null
}

/** 当前有效的服务端同意（没有则为 null） */
export function activeServerConsent(
  consents: readonly AiPortraitServerConsent[],
): AiPortraitServerConsent | null {
  const mine = consents.filter((item) => item.module === AI_PORTRAIT_MODULE_ID && item.revokedAt === null)
  return mine.length === 0 ? null : (mine[0] ?? null)
}

/** 服务端同意记录的形状守卫（旧接口返回坏数据时宁可当作"没有记录"） */
export function isAiPortraitServerConsent(value: unknown): value is AiPortraitServerConsent {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.module === 'string' &&
    typeof value.version === 'string' &&
    typeof value.grantedAt === 'string' &&
    (value.revokedAt === null || typeof value.revokedAt === 'string')
  )
}
