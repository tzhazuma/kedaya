import { formatRelativeTime } from '@kedaya/shared'

/**
 * 心理支持（`wellbeing`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/wellbeing/domain/wellbeing.domain.ts`
 * 及 `wellbeing.service.ts` **逐条对齐**。这个模块是全仓最敏感的一个，
 * 所以这里除了数据形状，还承载三件"产品态度"：
 *
 *   1. **危机出口**（`CRISIS_FALLBACK` + `WellbeingCrisisLine`）：接口拿不到也必须能显示
 *      可执行的下一步。绝不允许"网络不好 → 危机信息一起消失"。
 *   2. **边界声明**（`WELLBEING_BOUNDARY_NOTICE`）：这里只是倾听与预约入口，
 *      **不做诊断、不做治疗**；严重情况走医疗与校方渠道。
 *   3. **文案纪律**：全模块写「心理支持」，不出现「心理医生」这类会让人误以为
 *      "来了就能被治好"的称呼；「治疗 / 诊断」只出现在**否定式**的边界声明里。
 *
 * 归属只来自后端 JWT：客户端连 `userId` 都发不出去（`CreateWellbeingAppointmentInput`
 * 里没有这个字段），列表也永远是"我的预约"（后端强制 `userId = 主体`）。
 */

export const WELLBEING_MODULE_ID = 'wellbeing'

/* ------------------------------------------------------------------ *
 * 状态白名单（与后端 WELLBEING_STATUSES 同值）
 * ------------------------------------------------------------------ */

export const WELLBEING_STATUS = {
  requested: 'requested',
  confirmed: 'confirmed',
  completed: 'completed',
  cancelled: 'cancelled',
} as const
export type WellbeingStatus = (typeof WELLBEING_STATUS)[keyof typeof WELLBEING_STATUS]

export const WELLBEING_STATUSES = [
  WELLBEING_STATUS.requested,
  WELLBEING_STATUS.confirmed,
  WELLBEING_STATUS.completed,
  WELLBEING_STATUS.cancelled,
] as const

/**
 * 状态中文标签。
 *
 * 用「待确认 / 已确认 / 已完成 / 已取消」而不是「受理中 / 处理中」这类工单话术：
 * 这一页是给人看的，不是给工单系统看的。
 */
export const WELLBEING_STATUS_LABELS: Readonly<Record<WellbeingStatus, string>> = {
  requested: '待确认',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
}

/** 可取消的状态（与后端 `WELLBEING_CANCELLABLE_STATUSES` 逐条对齐） */
export const WELLBEING_CANCELLABLE_STATUSES: readonly WellbeingStatus[] = [
  WELLBEING_STATUS.requested,
  WELLBEING_STATUS.confirmed,
]

/* ------------------------------------------------------------------ *
 * 方式 / 上限 / 时间偏差
 * ------------------------------------------------------------------ */

export const WELLBEING_MODE = {
  online: 'online',
  onsite: 'onsite',
} as const
export type WellbeingMode = (typeof WELLBEING_MODE)[keyof typeof WELLBEING_MODE]

export const WELLBEING_MODES = [WELLBEING_MODE.online, WELLBEING_MODE.onsite] as const

export const WELLBEING_MODE_LABELS: Readonly<Record<WellbeingMode, string>> = {
  online: '线上（电话 / 视频）',
  onsite: '线下（校园咨询室）',
}

/** 默认方式：线下（与后端 `WELLBEING_DEFAULT_MODE` 同值） */
export const WELLBEING_DEFAULT_MODE: WellbeingMode = WELLBEING_MODE.onsite

/* 文本上限（与后端同值；客户端只做即时提示，服务端才是最终裁决） */
export const WELLBEING_COUNSELOR_MAX = 120
export const WELLBEING_NOTE_MAX = 1000

/** 预约时间允许的时钟偏差：5 分钟（与后端 `WELLBEING_SLOT_TOLERANCE_MS` 同值） */
export const WELLBEING_SLOT_TOLERANCE_MS = 5 * 60 * 1000

/* ------------------------------------------------------------------ *
 * 文案常量（三个页面共用一句话，避免各写一份漂移）
 * ------------------------------------------------------------------ */

/**
 * 模块边界。**必须**出现在 create / detail / list 三页：
 * 用户合上手机之后要记住的是这句话，而不是某个按钮。
 */
export const WELLBEING_BOUNDARY_NOTICE =
  '这里提供的是倾听与预约入口，不做诊断、不做治疗；严重情况请走医疗与校方渠道。'

/** 危机出口的文案（与 `crisis-line` 接口的 message 同源） */
export const WELLBEING_CRISIS_NOTICE =
  '如有自伤或伤人的风险，请立即拨打 110（报警）/ 120（急救），或联系你的辅导员、学校保卫处。'

/** 摘要输入框的提示：最小化采集，不写身份信息，也不写别人的隐私 */
export const WELLBEING_NOTE_HINT = '不需要填写姓名、学号，也请不要写他人的隐私信息。'

export const WELLBEING_PLATFORM_DISCLAIMER =
  '第三方非官方平台 · 与上海科技大学官方系统无关。心理支持模块只提供倾听与预约入口。'

/**
 * 同意文案版本：改文案就改版本号，旧同意自动失效并重新征求（契约 §9）。
 *
 * 与 `dormHarmony` 的策略一致：版本号**本地**决定"这份同意还算不算数"；
 * 服务端的合规记录（`/wellbeing/consents`）是后端放行的依据，两者职责不同。
 */
export const WELLBEING_CONSENT_VERSION = 'v1'

export const WELLBEING_CONSENT_TITLE = '进入前请先阅读并同意'

/**
 * 同意门要讲清楚的四件事（顺序就是用户最想问的顺序）：
 * 谁会看到 → 数据怎么存 → 能不能反悔 → 边界在哪。
 */
export const WELLBEING_CONSENT_POINTS: readonly string[] = [
  '谁能看到：只有你和中心值班老师能看到你的预约与摘要；它不会出现在论坛、动态、失物招领等任何公开列表里，也不会进入 AI 画像。',
  '数据怎么存：只存你主动填写的预约时间、方式和一句话摘要；服务端与其它模块物理隔离，每次读写都会留下合规审计记录。',
  '可以随时撤回：撤回后本模块立刻不可用，你可以重新同意后再进入。已存在的数据不会因为撤回而消失 —— 删除数据是「我的 → 隐私与数据」里的另一条独立权利。',
  '这里能做什么：倾听、陪你梳理、按需帮你约中心老师。不做诊断、不做治疗，也不会替你做医疗判断。',
]

/* ------------------------------------------------------------------ *
 * 危机出口
 * ------------------------------------------------------------------ */

export interface WellbeingHotline {
  name: string
  /** 可直接拨打的号码（`isDialable` 为 true 时页面才给「拨打」按钮） */
  number: string
}

/** 打不了电话时的下一步（辅导员 / 保卫处）—— 绝不只写"请寻求专业帮助" */
export interface WellbeingCrisisChannel {
  name: string
  instruction: string
}

export interface WellbeingCrisisLine {
  module: string
  title: string
  message: string
  hotlines: WellbeingHotline[]
  channels: WellbeingCrisisChannel[]
  /** 后端要求首屏渲染的标记（客户端只做展示对照，不做业务分支） */
  prominence: string
  requiresLogin: boolean
  requiresConsent: boolean
}

/**
 * `GET /wellbeing/crisis-line` 拿不到时的**兜底**。
 *
 * 为什么这份数据要在前端也存一份（而不是"接口失败就显示空"）：
 * 危机出口的价值在于"最坏情况下依然可用" —— 断网、后端 503、域名没配好，
 * 恰恰是用户最需要它的时刻。号码与后端默认配置同值；学校换了合作机构后
 * 后端会返回新的号码，这里只兜底"拿不到后端数据"这一种情况。
 */
export const CRISIS_FALLBACK: WellbeingCrisisLine = {
  module: WELLBEING_MODULE_ID,
  title: '紧急情况 · 立刻找人',
  message: WELLBEING_CRISIS_NOTICE,
  hotlines: [
    { name: '紧急报警（有自伤 / 伤人风险）', number: '110' },
    { name: '急救', number: '120' },
    { name: '全国 24 小时心理援助热线', number: '021-12320-5' },
  ],
  channels: [
    {
      name: '辅导员',
      instruction: '直接给辅导员发消息或打电话，说清楚「我现在需要有人陪着」；不必先解释背景。',
    },
    {
      name: '学校保卫处',
      instruction: '拨打保卫处值班电话，或到最近的门卫室 / 值班室当面求助（校内最快能到人）。',
    },
  ],
  prominence: 'primary',
  requiresLogin: false,
  requiresConsent: false,
}

/** 接不到接口时额外提示一句，避免用户以为这就是服务端最新的号码 */
export const CRISIS_FALLBACK_NOTICE =
  '热线暂时没能刷新，下面是本地保存的号码；如果打不通，请直接拨 110 / 120 或找辅导员。'

/** 号码是否可以直接拨打：微信 `makePhoneCall` 只接受纯号码（不能带「/」和中文） */
export function isDialable(number: string): boolean {
  return /^[\d-]{3,20}$/.test(number.trim())
}

/* ------------------------------------------------------------------ *
 * 领域模型
 * ------------------------------------------------------------------ */

/** 字段与后端 `WellbeingAppointmentModel` 一一对应，时间以 ISO 字符串传输 */
export interface WellbeingAppointment {
  id: string
  /** 归属；服务端从 JWT 取主体，客户端不参与（也不会用它在页面里做判断之外的事） */
  userId: string
  counselor: string
  /** 预约时间（ISO-8601） */
  slotAt: string
  /** online | onsite */
  mode: string
  status: string
  /** 最小化采集：仅存用户主动填写的诉求摘要 */
  note: string | null
  /** 危机干预标记（与 status 正交：被打过标记 ≠ 预约被取消） */
  crisisFlag: boolean
  createdAt: string
  updatedAt: string
}

/** 创建输入：**没有** userId / status / crisisFlag（服务端从 JWT 取归属，状态一律 requested） */
export interface CreateWellbeingAppointmentInput {
  counselor: string
  /** ISO-8601 */
  slotAt: string
  mode?: WellbeingMode
  note?: string | null
}

/** 修改输入（后端只允许改时间 / 方式 / 摘要，状态与归属不可改） */
export interface UpdateWellbeingAppointmentInput {
  slotAt?: string
  mode?: WellbeingMode
  note?: string | null
}

/** 列表筛选：只有 `status` 一个维度（后端强制只看自己，不存在 mine 开关） */
export interface WellbeingAppointmentFilters extends Record<string, unknown> {
  status?: WellbeingStatus
}

/** 卡片直接可读的派生视图 —— UI 不再自己算标签与相对时间 */
export interface WellbeingAppointmentSummary {
  id: string
  counselor: string
  status: WellbeingStatus
  statusLabel: string
  modeLabel: string
  /** 预约时间绝对文案 `2026-11-05 10:00` */
  slotLabel: string
  /** 相对时间 `3 天后` / `2 小时前` */
  slotRelative: string
  notePreview: string
  crisisFlag: boolean
  cancelled: boolean
  completed: boolean
}

export function isWellbeingStatus(value: unknown): value is WellbeingStatus {
  return typeof value === 'string' && (WELLBEING_STATUSES as readonly string[]).includes(value)
}

/** 未知状态降级为可读文案而不是抛错：一条遗留数据不该让整页打不开 */
export function statusLabel(status: string): string {
  return isWellbeingStatus(status) ? WELLBEING_STATUS_LABELS[status] : '未知状态'
}

export function modeLabel(mode: string): string {
  if (mode === WELLBEING_MODE.online) return WELLBEING_MODE_LABELS.online
  if (mode === WELLBEING_MODE.onsite) return WELLBEING_MODE_LABELS.onsite
  return '方式待确认'
}

/** `Date` → 表单可编辑的本地时间文本 `YYYY-MM-DD HH:mm` */
export function formatSlotAtInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 表单文本 → `Date`（本地时区）。
 *
 * 与 `takeoutGuard.ts` / `lostFound.ts` 里的同名函数是**同一套规则**
 * （各模块持有一份副本，避免领域模型之间互相 import）。
 * 不用 `new Date(text)`：它把 `2026-10-16 20:30` 当实现相关的宽松格式，
 * 在部分小程序运行时（iOS JSCore）直接得到 Invalid Date。
 */
export function parseSlotAtInput(text: string): Date | null {
  const matched = /^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/.exec(text)
  if (matched === null) return null

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = matched
  if (year === undefined || month === undefined || day === undefined) return null

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  )
  // `new Date(2026, 12, 40)` 会静默进位到下一月，因此回读一次做校验
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null
  }
  return date
}

/**
 * 状态 → 时间线（详情页按它渲染，页面不自己拼状态判断）。
 *
 * `cancelled` 是一条**分支**而不是第三个节点：取消之后时间线停在原地，
 * 由页面另外给一句「本次预约已取消」。所以四个状态都返回三节点数组。
 */
export type WellbeingTimelineState = 'done' | 'current' | 'todo'

export interface WellbeingTimelineStep {
  id: 'requested' | 'confirmed' | 'completed'
  label: string
  description: string
  state: WellbeingTimelineState
}

export function statusTimeline(status: string): WellbeingTimelineStep[] {
  const normalized: WellbeingStatus = isWellbeingStatus(status)
    ? status
    : WELLBEING_STATUS.requested

  const order: readonly WellbeingStatus[] = [
    WELLBEING_STATUS.requested,
    WELLBEING_STATUS.confirmed,
    WELLBEING_STATUS.completed,
  ]
  const currentIndex = order.indexOf(normalized)

  const steps: ReadonlyArray<{ id: WellbeingTimelineStep['id']; label: string; description: string }> = [
    { id: 'requested', label: '已提交', description: '申请已送出，等中心确认时间与方式' },
    { id: 'confirmed', label: '已确认', description: '中心已确认，按约定时间见面或通话' },
    { id: 'completed', label: '已完成', description: '这次支持结束；需要时可以再约' },
  ]

  return steps.map((step, index) => ({
    ...step,
    // cancelled 时 currentIndex 为 -1：三个节点全是 todo，页面另给"已取消"说明
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }))
}

export function summarize(
  appointment: WellbeingAppointment,
  now: Date,
): WellbeingAppointmentSummary {
  const status: WellbeingStatus = isWellbeingStatus(appointment.status)
    ? appointment.status
    : WELLBEING_STATUS.requested
  const slot = new Date(appointment.slotAt)
  const slotValid = !Number.isNaN(slot.getTime())

  return {
    id: appointment.id,
    counselor: appointment.counselor,
    status,
    statusLabel: statusLabel(appointment.status),
    modeLabel: modeLabel(appointment.mode),
    slotLabel: slotValid ? formatSlotAtInput(slot) : '时间待确认',
    slotRelative: formatRelativeTime(appointment.slotAt, now),
    notePreview: (appointment.note ?? '').slice(0, 60),
    crisisFlag: appointment.crisisFlag,
    cancelled: status === WELLBEING_STATUS.cancelled,
    completed: status === WELLBEING_STATUS.completed,
  }
}

/* ------------------------------------------------------------------ *
 * 校验（纯函数：用例、mock 仓储与页面共用同一份文案）
 * ------------------------------------------------------------------ */

export function counselorProblem(counselor: string): string | null {
  const text = counselor.trim()
  if (text.length === 0) return '请填写想约的老师 / 咨询师'
  if ([...text].length > WELLBEING_COUNSELOR_MAX) {
    return `最多 ${WELLBEING_COUNSELOR_MAX} 个字`
  }
  return null
}

/** 摘要选填：不填是有意的（最小化采集），但填了就要限长 */
export function noteProblem(note: string): string | null {
  if ([...note.trim()].length > WELLBEING_NOTE_MAX) {
    return `摘要最多 ${WELLBEING_NOTE_MAX} 个字`
  }
  return null
}

/** 预约时间必须晚于现在（允许 5 分钟时钟偏差，与后端同一套判定） */
export function slotAtProblem(slotAt: Date, now: Date): string | null {
  if (Number.isNaN(slotAt.getTime())) return '请按「YYYY-MM-DD HH:mm」填写预约时间'
  if (slotAt.getTime() < now.getTime() - WELLBEING_SLOT_TOLERANCE_MS) {
    return '预约时间需要晚于现在'
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 动作闸门（服务端仍是最终裁决，这里只是提前把不该出现的按钮藏掉）
 * ------------------------------------------------------------------ */

export interface WellbeingEligibility {
  allowed: boolean
  message: string
}

/**
 * 「取消预约」是否可点 —— 与后端 `WellbeingService.cancel` 同一套判定：
 * requested / confirmed → cancelled；已取消 / 已完成 / 未知状态都是 CONFLICT。
 */
export function cancellable(
  appointment: WellbeingAppointment,
  viewerId: string | null,
): WellbeingEligibility {
  if (viewerId === null) return { allowed: false, message: '登录后才能取消预约' }
  if (appointment.userId !== viewerId) return { allowed: false, message: '只能取消自己的预约' }
  if (appointment.status === WELLBEING_STATUS.cancelled) {
    return { allowed: false, message: '这条预约已经取消，无需重复操作' }
  }
  if (appointment.status === WELLBEING_STATUS.completed) {
    return { allowed: false, message: '已完成的预约不能取消' }
  }
  if (!(WELLBEING_CANCELLABLE_STATUSES as readonly string[]).includes(appointment.status)) {
    return { allowed: false, message: '当前状态不能取消' }
  }
  return { allowed: true, message: '' }
}

/* ------------------------------------------------------------------ *
 * 服务端返回值的防御性解析
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 校验 `crisis-line` 的响应形状。
 *
 * 危机出口是"错了也要能用"的路径：形状不合规时**返回 null 让页面用兜底数据**，
 * 而不是抛错（抛错 = 危机信息消失）。
 */
export function normalizeCrisisLine(value: unknown): WellbeingCrisisLine | null {
  if (!isRecord(value)) return null

  const hotlines = Array.isArray(value.hotlines)
    ? value.hotlines
        .filter(
          (item): item is { name: string; number: string } =>
            isRecord(item) && typeof item.name === 'string' && typeof item.number === 'string',
        )
        .map((item) => ({ name: item.name, number: item.number }))
    : []
  if (hotlines.length === 0) return null

  const channels = Array.isArray(value.channels)
    ? value.channels
        .filter(
          (item): item is { name: string; instruction: string } =>
            isRecord(item) &&
            typeof item.name === 'string' &&
            typeof item.instruction === 'string',
        )
        .map((item) => ({ name: item.name, instruction: item.instruction }))
    : []

  return {
    module: typeof value.module === 'string' ? value.module : WELLBEING_MODULE_ID,
    title: typeof value.title === 'string' && value.title !== '' ? value.title : CRISIS_FALLBACK.title,
    message:
      typeof value.message === 'string' && value.message !== '' ? value.message : CRISIS_FALLBACK.message,
    hotlines,
    channels,
    prominence: typeof value.prominence === 'string' ? value.prominence : 'primary',
    requiresLogin: value.requiresLogin === true,
    requiresConsent: value.requiresConsent === true,
  }
}
