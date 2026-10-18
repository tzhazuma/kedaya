import { formatRelativeTime } from '@kedaya/shared'

/**
 * 宿舍矛盾（`dorm-harmony`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/dorm-harmony/domain/dorm-harmony.domain.ts`
 * 以及 `dorm-harmony.service.ts` 对齐。三条必须记住的设计事实：
 *
 *   1. **案子与实名身份解耦**：本文件的类型里根本没有「用户」字段。匿名不是运行时过滤，
 *      而是数据模型层面的解耦 —— 所以客户端也拿不到、也不该臆造任何身份信息。
 *   2. **追踪码即能力**：后端只存 `sha256(trackCode)`，明文只在提交响应里出现一次。
 *      「案子不存在」与「追踪码错误」在后端是**同一句文案**（防枚举），客户端
 *      不得把两者拆成两种提示，否则就成了存在性预言机。
 *   3. **匿名不等于绝对不可追溯**：追踪码丢失后平台无法找回（服务端没有明文），
 *      因此客户端一定要把追踪码连同**案件编号**存在本地（见 `StorageKeys.dormHarmonyTrackCodes`）。
 */

export const DORM_HARMONY_MODULE_ID = 'dorm-harmony'

/** 状态机：submitted → in-progress → closed */
export const DORM_HARMONY_STATUS = {
  submitted: 'submitted',
  inProgress: 'in-progress',
  closed: 'closed',
} as const
export type DormHarmonyStatus = (typeof DORM_HARMONY_STATUS)[keyof typeof DORM_HARMONY_STATUS]

/** 期望的解决方式白名单（与后端同一份，客户端与服务端不得漂移） */
export const DORM_HARMONY_EXPECTATIONS = ['talk', 'mediation', 'rule', 'other'] as const
export type DormHarmonyExpectation = (typeof DORM_HARMONY_EXPECTATIONS)[number]

/** 留言角色：学生本人 / 调解员 */
export const DORM_HARMONY_FROM_ROLES = {
  student: 'student',
  mediator: 'mediator',
} as const
export type DormHarmonyFromRole =
  (typeof DORM_HARMONY_FROM_ROLES)[keyof typeof DORM_HARMONY_FROM_ROLES]

/**
 * 追踪码字母表 —— 与后端 `generateTrackCode()` 完全一致（去掉 I/O/0/1 等易混字符）。
 * `XXXX-XXXX-XXXX`，共 12 位有效字符。
 */
export const DORM_HARMONY_TRACK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 追踪码形状（只用于**软提示**，最终判定权在服务端） */
export const DORM_HARMONY_TRACK_CODE_PATTERN = new RegExp(
  `^[${DORM_HARMONY_TRACK_CODE_ALPHABET}]{4}-[${DORM_HARMONY_TRACK_CODE_ALPHABET}]{4}-[${DORM_HARMONY_TRACK_CODE_ALPHABET}]{4}$`,
)

export const DORM_HARMONY_BUILDING_MAX = 20
export const DORM_HARMONY_TOPIC_MAX = 40
export const DORM_HARMONY_DETAIL_MAX = 2000
export const DORM_HARMONY_MESSAGE_MAX = 2000
/** 后端 zod 对 trackCode 的限制是 trim 后 1–64 字符 */
export const DORM_HARMONY_TRACK_CODE_MAX = 64

export const DORM_HARMONY_STATUS_LABELS: Readonly<Record<DormHarmonyStatus, string>> = {
  submitted: '已提交',
  'in-progress': '调解中',
  closed: '已结案',
}

export const DORM_HARMONY_EXPECTATION_LABELS: Readonly<Record<DormHarmonyExpectation, string>> = {
  talk: '先私下沟通',
  mediation: '希望有人调解',
  rule: '明确宿舍规则',
  other: '其他方式',
}

export const DORM_HARMONY_FROM_ROLE_LABELS: Readonly<Record<DormHarmonyFromRole, string>> = {
  student: '我（匿名）',
  mediator: '调解员',
}

/** 后端 ForbiddenError 的原文：**案子不存在**与**追踪码错误**共用这一句（防枚举） */
export const DORM_HARMONY_TRACK_CODE_ERROR = '追踪码不正确，无法访问该调解申请'
export const DORM_HARMONY_CLOSED_MESSAGE_ERROR = '该调解申请已经结案，无法继续留言'
export const DORM_HARMONY_CLOSED_CLOSE_ERROR = '该调解申请已经结案'
export const DORM_HARMONY_CLOSED_REPLY_ERROR = '该调解申请已经结案，无法继续回复'
export const DORM_HARMONY_NOT_FOUND_ERROR = '调解申请不存在或已被删除'

/**
 * 本地缺少「追踪码 → 案件」映射时的提示。
 *
 * 为什么会有这种情况：后端**刻意不提供**「凭追踪码反查案件」的接口
 * （那会变成枚举窗口）。地址是 `GET /dorm-harmony/cases/:id?trackCode=…`，
 * 所以换设备后必须同时保留追踪码与案件编号。
 */
export const DORM_HARMONY_NOT_LOCAL_MESSAGE =
  '本机没有这个追踪码对应的案件记录。平台不提供凭追踪码反查案件的接口（防止枚举），换设备时请同时保留追踪码与案件编号。'

/** 高敏感模块的固定提示（契约 §9：不提供实时救助） */
export const DORM_HARMONY_EMERGENCY_NOTICE =
  '紧急或涉及人身安全请直接联系辅导员或校园安保，本平台不提供实时救助。'

/** 契约 §9：全站保留第三方非官方声明 */
export const DORM_HARMONY_PLATFORM_DISCLAIMER =
  '第三方非官方平台 · 与上海科技大学官方系统无关。'

/* ------------------------------------------------------------------ *
 * 实体（字段与后端视图一一对应；**绝不包含 trackCodeHash**）
 * ------------------------------------------------------------------ */

export interface DormHarmonyCase {
  id: string
  /** 与实名身份解耦的匿名 handle（如 `鸭友0A1B2C`） */
  anonHandle: string
  building: string
  topic: string
  detail: string | null
  status: string
  /** 调解员（宿管 / 辅导员），未介入时为 null */
  mediatorId: string | null
  expectation: string | null
  createdAt: string
  updatedAt: string
}

export interface DormHarmonyMessage {
  id: string
  caseId: string
  fromRole: string
  /** 学生留言带匿名 handle；调解员留言不带（身份记在案子上的 mediatorId） */
  anonHandle: string | null
  body: string
  createdAt: string
}

export interface DormHarmonyCaseDetail extends DormHarmonyCase {
  messages: DormHarmonyMessage[]
}

export interface SubmitDormHarmonyCaseInput {
  building: string
  topic: string
  detail?: string | null
  expectation?: string | null
}

/** 提交响应：`trackCode` **只返回一次**，客户端必须立刻落本地 */
export interface SubmitDormHarmonyCaseResult {
  case: DormHarmonyCase
  trackCode: string
}

export interface DormHarmonyMessageResult {
  message: DormHarmonyMessage
  caseStatus: string
}

/* ------------------------------------------------------------------ *
 * 派生视图（UI 直接可读，页面不再自己算标签）
 * ------------------------------------------------------------------ */

export interface DormHarmonyCaseSummary {
  id: string
  anonHandle: string
  building: string
  topic: string
  status: DormHarmonyStatus
  statusLabel: string
  expectationLabel: string | null
  mediatorLabel: string
  timeLabel: string
  createdAt: string
}

export interface DormHarmonyMessageView {
  id: string
  fromRole: DormHarmonyFromRole
  authorLabel: string
  body: string
  /** 学生本人（= 当前持有追踪码的人）发的留言 */
  mine: boolean
  timeLabel: string
  createdAt: string
}

export interface DormHarmonyCaseDetailView {
  case: DormHarmonyCaseSummary
  messages: DormHarmonyMessageView[]
  canMessage: boolean
  canClose: boolean
}

/* ------------------------------------------------------------------ *
 * 判定与纯函数
 * ------------------------------------------------------------------ */

export function isDormHarmonyStatus(value: unknown): value is DormHarmonyStatus {
  return value === 'submitted' || value === 'in-progress' || value === 'closed'
}

export function isDormHarmonyExpectation(value: unknown): value is DormHarmonyExpectation {
  return typeof value === 'string' && (DORM_HARMONY_EXPECTATIONS as readonly string[]).includes(value)
}

export function isDormHarmonyFromRole(value: unknown): value is DormHarmonyFromRole {
  return value === 'student' || value === 'mediator'
}

/** 未知状态降级为可读文案，而不是抛错（服务端新增状态时页面不至于崩） */
export function statusLabel(status: string): string {
  return isDormHarmonyStatus(status) ? DORM_HARMONY_STATUS_LABELS[status] : '状态未知'
}

export function expectationLabel(expectation: string | null): string | null {
  if (expectation === null) return null
  return isDormHarmonyExpectation(expectation) ? DORM_HARMONY_EXPECTATION_LABELS[expectation] : null
}

export function fromRoleLabel(role: string): string {
  return isDormHarmonyFromRole(role) ? DORM_HARMONY_FROM_ROLE_LABELS[role] : '未知来源'
}

/**
 * 按**码点**计数（`[...value].length`），与后端 `[...text].length` 的校验口径一致，
 * 避免 emoji / 生僻字被 UTF-16 长度算成两个字。
 */
export function codePointLength(value: string): number {
  return [...value].length
}

/**
 * 追踪码归一化：去首尾空白、把中间的分隔符（空格 / 全半角横线 / 下划线 / 连字符）
 * 统一成半角 `-`、转大写。
 *
 * 这是**客户端便利**，不是放宽校验：追踪码字母表本来就只有大写，抄写时常把
 * `-` 写成空格或全角横线，没必要让他自己修。归一化只影响「分组分隔符」，
 * 字符本身不合法（缺位、字母表外字符）仍原样送服务端裁决。
 */
export function normalizeTrackCode(value: string): string {
  return value
    .trim()
    .replace(/[\s—–－_-]+/g, '-')
    .toUpperCase()
}

export function isTrackCodeShaped(value: string): boolean {
  return DORM_HARMONY_TRACK_CODE_PATTERN.test(normalizeTrackCode(value))
}

export function canMessageStatus(status: string): boolean {
  return status !== DORM_HARMONY_STATUS.closed
}

export function canCloseStatus(status: string): boolean {
  return status !== DORM_HARMONY_STATUS.closed
}

/* ------------------------------------------------------------------ *
 * 表单校验（与服务端同一套规则，只做即时提示；服务端仍是最终裁决）
 * ------------------------------------------------------------------ */

export interface DormHarmonyDraft {
  building: string
  topic: string
  detail: string
  /** `''` 表示「不指定」 */
  expectation: string
}

export function validateSubmitDraft(draft: DormHarmonyDraft): string[] {
  const problems: string[] = []

  const building = draft.building.trim()
  if (building.length === 0) problems.push('请填写宿舍楼')
  else if (codePointLength(building) > DORM_HARMONY_BUILDING_MAX) {
    problems.push(`宿舍楼最多 ${DORM_HARMONY_BUILDING_MAX} 个字`)
  }

  const topic = draft.topic.trim()
  if (topic.length === 0) problems.push('请简要描述问题')
  else if (codePointLength(topic) > DORM_HARMONY_TOPIC_MAX) {
    problems.push(`问题描述最多 ${DORM_HARMONY_TOPIC_MAX} 个字`)
  }

  if (codePointLength(draft.detail.trim()) > DORM_HARMONY_DETAIL_MAX) {
    problems.push(`补充说明最多 ${DORM_HARMONY_DETAIL_MAX} 个字`)
  }

  if (draft.expectation !== '' && !isDormHarmonyExpectation(draft.expectation)) {
    problems.push('期望的解决方式不在支持范围内')
  }

  return problems
}

export function validateMessageBody(body: string): string[] {
  const problems: string[] = []
  if (body.trim().length === 0) problems.push('请填写留言内容')
  else if (codePointLength(body.trim()) > DORM_HARMONY_MESSAGE_MAX) {
    problems.push(`留言最多 ${DORM_HARMONY_MESSAGE_MAX} 个字`)
  }
  return problems
}

/* ------------------------------------------------------------------ *
 * 映射
 * ------------------------------------------------------------------ */

export function summarizeCase(item: DormHarmonyCase, now: Date): DormHarmonyCaseSummary {
  return {
    id: item.id,
    anonHandle: item.anonHandle,
    building: item.building,
    topic: item.topic,
    status: isDormHarmonyStatus(item.status) ? item.status : 'submitted',
    statusLabel: statusLabel(item.status),
    expectationLabel: expectationLabel(item.expectation),
    mediatorLabel: item.mediatorId === null ? '尚未有调解员介入' : '已有调解员介入',
    timeLabel: formatRelativeTime(item.createdAt, now),
    createdAt: item.createdAt,
  }
}

export function summarizeMessage(message: DormHarmonyMessage, now: Date): DormHarmonyMessageView {
  const role: DormHarmonyFromRole = isDormHarmonyFromRole(message.fromRole)
    ? message.fromRole
    : 'mediator'
  return {
    id: message.id,
    fromRole: role,
    authorLabel: fromRoleLabel(message.fromRole),
    body: message.body,
    mine: role === 'student',
    timeLabel: formatRelativeTime(message.createdAt, now),
    createdAt: message.createdAt,
  }
}

export function summarizeDetail(detail: DormHarmonyCaseDetail, now: Date): DormHarmonyCaseDetailView {
  return {
    case: summarizeCase(detail, now),
    messages: detail.messages.map((message) => summarizeMessage(message, now)),
    canMessage: canMessageStatus(detail.status),
    canClose: canCloseStatus(detail.status),
  }
}

/**
 * 用服务端返回的新状态刷新本地摘要 —— 本地列表里的状态标签不能停在旧值。
 * `timeLabel` 保留原值（重新计算会让「3 分钟前」在每次动作后跳变，没有必要）。
 */
export function withCaseStatus(
  summary: DormHarmonyCaseSummary,
  status: string,
  now: Date,
): DormHarmonyCaseSummary {
  const next = isDormHarmonyStatus(status) ? status : summary.status
  return {
    ...summary,
    status: next,
    statusLabel: statusLabel(next),
    timeLabel: formatRelativeTime(summary.createdAt, now),
  }
}
