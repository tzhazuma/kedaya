import { clampEvidence, formatActivityInstant } from './activity'

/**
 * 校园邮箱的活动归一化（**复用现成 `/mail` 模块**）。
 *
 * 服务端已经做了三件事：只读 IMAP、AES-256-GCM 加密落库、只落归一后的活动。
 * 客户端这一层只负责「表单前置校验 + 响应去敏 + 展示形状」，
 * 不碰密码、不解密、不保存邮件正文。
 *
 * 端点（`services/api/src/modules/mail/mail.controller.ts`）：
 * ```
 * POST   /mail/account   { email, imapHost, imapPort, password }
 * DELETE /mail/account
 * POST   /mail/sync
 * GET    /mail/events    { items: MailEventItem[], stale }
 * ```
 */

/** 邮件时间展示（显式 Asia/Shanghai；null 时明确写「尚未同步」） */
export function formatMailTime(iso: string | null, now: Date = new Date()): string {
  return iso === null ? '尚未同步' : formatActivityInstant(iso, now)
}

export const CAMPUS_MAIL_DOMAINS = ['shanghaitech.edu.cn', 'stu.shanghaitech.edu.cn'] as const
export const CAMPUS_IMAP_HOST = 'imap.shanghaitech.edu.cn'
export const CAMPUS_IMAP_PORT = 993

export interface MailEventItem {
  id: string
  title: string
  startsAt: string
  location: string | null
  organizer: string | null
  confidence: number
  /** ≤200 字证据片段，不是邮件正文 */
  matchedText: string
  receivedAt: string | null
  stale: boolean
}

export interface MailEventsSnapshot {
  items: MailEventItem[]
  stale: boolean
}

export interface MailAccountSummary {
  email: string
  imapHost: string
  imapPort: number
  status: string
  lastSyncAt: string | null
}

export interface MailSyncSummary {
  scanned: number
  matched: number
  stored: number
  lastSyncAt: string | null
  stale: boolean
}

export interface MailAccountFormInput {
  email: string
  imapHost: string
  imapPort: number
  password: string
}

const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

function parseIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!INSTANT_PATTERN.test(trimmed)) return null
  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : Array.from(trimmed).slice(0, maxLength).join('')
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function normalizeMailEvent(raw: unknown): MailEventItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  const id = text(value.id, 128)
  const title = text(value.title, 200)
  const startsAt = parseIso(value.startsAt)
  if (id === null || title === null || startsAt === null) return null

  return {
    id,
    title,
    startsAt,
    location: text(value.location, 200),
    organizer: text(value.organizer, 200),
    confidence: clampConfidence(value.confidence),
    matchedText: clampEvidence(typeof value.matchedText === 'string' ? value.matchedText : ''),
    receivedAt: parseIso(value.receivedAt),
    stale: value.stale === true,
  }
}

export function normalizeMailEvents(raw: unknown): MailEventItem[] {
  if (!Array.isArray(raw)) return []
  const items: MailEventItem[] = []
  for (const entry of raw) {
    const normalized = normalizeMailEvent(entry)
    if (normalized !== null) items.push(normalized)
  }
  return items
}

export function normalizeMailAccount(raw: unknown): MailAccountSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>

  const email = text(value.email, 320)
  const imapHost = text(value.imapHost, 255)
  const imapPort = value.imapPort
  const status = text(value.status, 40)
  if (email === null || imapHost === null || status === null) return null
  if (typeof imapPort !== 'number' || !Number.isInteger(imapPort) || imapPort <= 0 || imapPort > 65535) {
    return null
  }

  return {
    email,
    imapHost,
    imapPort,
    status,
    lastSyncAt: parseIso(value.lastSyncAt),
  }
}

export function normalizeMailSyncResult(raw: unknown): MailSyncSummary {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    scanned: count(value.scanned),
    matched: count(value.matched),
    stored: count(value.stored),
    lastSyncAt: parseIso(value.lastSyncAt),
    stale: value.stale === true,
  }
}

export interface MailAccountFieldErrors {
  email?: string
  imapHost?: string
  imapPort?: string
  password?: string
}

/**
 * 校园邮箱表单的前置校验（与后端同规则，文案提前说清楚）。
 *
 * 按字段返回，页面直接喂给 `KdyField error` —— 一条全局错误挂在四个输入框
 * 下面时，用户不知道要改哪一个。后端仍会再验一次。
 */
export function mailAccountFieldErrors(
  input: MailAccountFormInput,
): MailAccountFieldErrors {
  const errors: MailAccountFieldErrors = {}

  const email = input.email.trim().toLowerCase()
  if (email.length > 320) {
    errors.email = '邮箱过长'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = '邮箱格式不正确'
  } else {
    const domain = email.slice(email.lastIndexOf('@') + 1)
    if (!CAMPUS_MAIL_DOMAINS.includes(domain as (typeof CAMPUS_MAIL_DOMAINS)[number])) {
      errors.email =
        '请使用上海科技大学校园邮箱（@shanghaitech.edu.cn 或 @stu.shanghaitech.edu.cn）'
    }
  }

  const host = input.imapHost.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0 || host.length > 255) {
    errors.imapHost = 'IMAP 服务器不能为空'
  } else if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) {
    errors.imapHost = 'IMAP 主机名格式不正确'
  } else if (host !== 'shanghaitech.edu.cn' && !host.endsWith('.shanghaitech.edu.cn')) {
    errors.imapHost = 'IMAP 服务器必须是 shanghaitech.edu.cn 域内的主机'
  }

  if (
    !Number.isInteger(input.imapPort) ||
    input.imapPort < 1 ||
    input.imapPort > 65535
  ) {
    errors.imapPort = 'IMAP 端口必须在 1–65535 之间'
  }

  if (input.password.trim() === '') {
    errors.password = '请填写邮箱客户端专用密码'
  } else if (input.password.length > 1024) {
    errors.password = '密码过长'
  }

  return errors
}

export function mailAccountFormProblem(input: MailAccountFormInput): string | null {
  const errors = mailAccountFieldErrors(input)
  return errors.email ?? errors.imapHost ?? errors.imapPort ?? errors.password ?? null
}
