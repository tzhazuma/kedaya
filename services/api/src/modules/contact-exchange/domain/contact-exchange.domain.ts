/**
 * 联系方式交换（U8）· domain 层（契约 §7：**零框架依赖**）
 *
 * 本文件只包含：
 *   · 领域类型 / 仓储端口 / 注入 token；
 *   · 纯函数策略（状态机、限流判定、值校验、联系方式内容检测、游标编解码）；
 *   · 防止内部字段泄漏的**允许清单投影**。
 *
 * 禁止在这里 import `@nestjs/*` / `@prisma/*`。加密与 IO 都在 data 层实现，
 * 这样状态机与隐私判定可以被单测直接钉死，而不需要起 Nest 或数据库。
 */

import {
  CONTACT_EXCHANGE_CONTEXT_MODULES,
  type ApiErrorCode,
  type ContactAccessAuditWire,
  type ContactEntryWire,
  type ContactExchangeContextModule,
  type ContactExchangeRequestWire,
  type ContactExchangeStatus,
  type ContactKind,
  type ExchangedContactWire,
} from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 领域记录（仓储 → 用例层）
 * ------------------------------------------------------------------ */

export interface ContactEntryRecord {
  id: string;
  userId: string;
  kind: ContactKind;
  label: string | null;
  /** AES-256-GCM 密文。**不得**出现在任何响应 / 日志 / 审计里。 */
  valueCipher: string;
  /** HMAC-SHA256 指纹，仅用于同一用户去重；不可逆。 */
  valueFingerprint: string;
  /** 是否授权给交换对象。默认 false（最小暴露）。 */
  shared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactExchangeRequestRecord {
  id: string;
  requesterId: string;
  /** 排序后的 `min:max`，只用于同对用户活跃申请的部分唯一索引。 */
  pairKey: string;
  addresseeId: string;
  status: ContactExchangeStatus;
  contextModule: ContactExchangeContextModule;
  contextId: string | null;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

export interface ContactAccessAuditRecord {
  id: string;
  actorId: string;
  subjectId: string;
  requestId: string;
  action: 'view_contacts';
  /** 被查看的条目 id。**不含 value / 密文**。 */
  entryIds: string[];
  /** 条目类型，用于审计检索。**不含 value / 密文**。 */
  entryKinds: ContactKind[];
  at: Date;
}

/* ------------------------------------------------------------------ *
 * 仓储查询 / 写入输入
 * ------------------------------------------------------------------ */

export interface TimeCursor {
  at: Date;
  id: string;
}

export interface PageQuery {
  cursor?: TimeCursor;
  limit: number;
}

export interface ContactEntryPage {
  items: ContactEntryRecord[];
  nextCursor: string | null;
}

export interface ContactExchangeRequestPage {
  items: ContactExchangeRequestRecord[];
  nextCursor: string | null;
}

export interface ContactAccessAuditPage {
  items: ContactAccessAuditRecord[];
  nextCursor: string | null;
}

export interface CreateContactEntryInput {
  userId: string;
  kind: ContactKind;
  label: string | null;
  valueCipher: string;
  valueFingerprint: string;
  shared: boolean;
}

export interface UpdateContactEntryInput {
  label?: string | null;
  valueCipher?: string;
  valueFingerprint?: string;
  shared?: boolean;
}

export interface CreateContactExchangeRequestInput {
  requesterId: string;
  addresseeId: string;
  pairKey: string;
  contextModule: ContactExchangeContextModule;
  contextId: string | null;
  message: string | null;
  expiresAt: Date;
}

export interface UpdateContactExchangeRequestInput {
  status: ContactExchangeStatus;
  respondedAt?: Date | null;
  revokedAt?: Date | null;
  revokedBy?: string | null;
}

export interface ContactExchangeRequestQuery extends PageQuery {
  direction: 'incoming' | 'outgoing' | 'all';
  status?: ContactExchangeStatus;
}

export interface ContactAccessAuditQuery extends PageQuery {
  direction: 'inbound' | 'outbound';
}

export interface AppendContactAuditInput {
  actorId: string;
  subjectId: string;
  requestId: string;
  entryIds: string[];
  entryKinds: ContactKind[];
}

/**
 * 仓储端口。实现见 `data/contact-exchange.repository.ts`。
 *
 * `createRequest` 命中原生部分唯一索引时**必须**抛
 * `ContactExchangeRepositoryError('DUPLICATE_ACTIVE_REQUEST')`，
 * 由用例层翻译成 `CONFLICT` —— 领域层不 import Prisma。
 */
export interface ContactExchangeRepository {
  userExists(userId: string): Promise<boolean>;

  createEntry(input: CreateContactEntryInput): Promise<ContactEntryRecord>;
  findEntryById(id: string): Promise<ContactEntryRecord | null>;
  findDuplicateEntry(userId: string, kind: ContactKind, fingerprint: string): Promise<ContactEntryRecord | null>;
  listEntries(userId: string, query: PageQuery): Promise<ContactEntryPage>;
  updateEntry(id: string, patch: UpdateContactEntryInput): Promise<ContactEntryRecord>;
  deleteEntry(id: string): Promise<void>;
  /** 只返回 `shared = true` 的条目（对方可读取的集合）。 */
  listSharedEntries(userId: string): Promise<ContactEntryRecord[]>;

  /** 把已过期但仍为 `PENDING` 的申请惰性置为 `EXPIRED`，返回更新行数。 */
  expireStaleRequests(now: Date): Promise<number>;
  createRequest(input: CreateContactExchangeRequestInput): Promise<ContactExchangeRequestRecord>;
  findRequestById(id: string): Promise<ContactExchangeRequestRecord | null>;
  findActiveRequestByPair(pairKey: string): Promise<ContactExchangeRequestRecord | null>;
  countRecentRequestsByPair(pairKey: string, since: Date): Promise<number>;
  updateRequestStatus(id: string, patch: UpdateContactExchangeRequestInput): Promise<ContactExchangeRequestRecord>;
  listRequests(userId: string, query: ContactExchangeRequestQuery): Promise<ContactExchangeRequestPage>;

  appendAudit(input: AppendContactAuditInput): Promise<ContactAccessAuditRecord>;
  listAudit(userId: string, query: ContactAccessAuditQuery): Promise<ContactAccessAuditPage>;
}

/** 加密端口：实现见 `data/aes-gcm-contact.crypto.ts`。 */
export interface ContactCryptoPort {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
  /** 带密钥的指纹（HMAC），不是裸 SHA-256 —— 手机号是低熵输入。 */
  fingerprint(kind: ContactKind, value: string): string;
}

export const CONTACT_EXCHANGE_REPOSITORY = 'CONTACT_EXCHANGE_REPOSITORY';
export const CONTACT_EXCHANGE_CIPHER = 'CONTACT_EXCHANGE_CIPHER';

/* ------------------------------------------------------------------ *
 * 仓储层错误（领域类型，不依赖 Prisma）
 * ------------------------------------------------------------------ */

export type ContactRepositoryErrorReason = 'DUPLICATE_ACTIVE_REQUEST' | 'DUPLICATE_CONTACT';

export class ContactExchangeRepositoryError extends Error {
  constructor(
    readonly reason: ContactRepositoryErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'ContactExchangeRepositoryError';
  }
}

/** 游标解析失败（由用例层翻译成 VALIDATION_FAILED） */
export class InvalidCursorError extends Error {
  constructor(message = 'cursor 不是合法的分页游标') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

/* ------------------------------------------------------------------ *
 * 状态机
 * ------------------------------------------------------------------ */

export interface RequestDecisionAllowed {
  allowed: true;
  nextStatus: ContactExchangeStatus;
  respondedAt?: Date;
  revokedAt?: Date;
  revokedBy?: string;
}

export interface RequestDecisionDenied {
  allowed: false;
  code: ApiErrorCode;
  message: string;
}

export type RequestDecision = RequestDecisionAllowed | RequestDecisionDenied;

function deny(code: ApiErrorCode, message: string): RequestDecisionDenied {
  return { allowed: false, code, message };
}

/** 判断用户是不是某条申请的一方（不存在 / 非当事人在 HTTP 层统一 404，避免泄漏存在性） */
export function isRequestParty(
  request: Pick<ContactExchangeRequestRecord, 'requesterId' | 'addresseeId'>,
  userId: string,
): boolean {
  return request.requesterId === userId || request.addresseeId === userId;
}

export function counterpartyOf(
  request: Pick<ContactExchangeRequestRecord, 'requesterId' | 'addresseeId'>,
  userId: string,
): string {
  return request.requesterId === userId ? request.addresseeId : request.requesterId;
}

/** `PENDING` 超过 `expiresAt` 即视为 `EXPIRED`（惰性） */
export function effectiveStatus(
  status: ContactExchangeStatus,
  expiresAt: Date,
  now: Date,
): ContactExchangeStatus {
  if (status === 'PENDING' && expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return status;
}

/**
 * 同意申请。只有**被申请人**能同意，且申请必须是**尚未过期的 PENDING**。
 */
export function decideApprove(
  request: Pick<ContactExchangeRequestRecord, 'addresseeId' | 'status' | 'expiresAt'>,
  actorId: string,
  now: Date,
): RequestDecision {
  if (request.addresseeId !== actorId) {
    return deny('FORBIDDEN', '只有被申请人可以同意该申请');
  }
  const status = effectiveStatus(request.status, request.expiresAt, now);
  if (status === 'EXPIRED') {
    return deny('CONFLICT', '该申请已过期，请重新发起');
  }
  if (status !== 'PENDING') {
    return deny('CONFLICT', `申请当前状态为 ${status}，不能同意`);
  }
  return { allowed: true, nextStatus: 'ACCEPTED', respondedAt: now };
}

/** 拒绝申请。只有**被申请人**能拒绝，且必须是未过期的 PENDING。 */
export function decideReject(
  request: Pick<ContactExchangeRequestRecord, 'addresseeId' | 'status' | 'expiresAt'>,
  actorId: string,
  now: Date,
): RequestDecision {
  if (request.addresseeId !== actorId) {
    return deny('FORBIDDEN', '只有被申请人可以拒绝该申请');
  }
  const status = effectiveStatus(request.status, request.expiresAt, now);
  if (status === 'EXPIRED') {
    return deny('CONFLICT', '该申请已过期');
  }
  if (status !== 'PENDING') {
    return deny('CONFLICT', `申请当前状态为 ${status}，不能拒绝`);
  }
  return { allowed: true, nextStatus: 'REJECTED', respondedAt: now };
}

/**
 * 撤销 / 取消。**双方都可以**：
 *   · `PENDING` 时 = 发起人取消 / 被申请人撤回；
 *   · `ACCEPTED` 时 = 任一方解除交换授权。
 * 撤销后状态立刻变成 `REVOKED`，对方**立即**读不到联系方式（因为服务端不存副本）。
 */
export function decideRevoke(
  request: Pick<ContactExchangeRequestRecord, 'status' | 'expiresAt'>,
  actorId: string,
  now: Date,
): RequestDecision {
  const status = effectiveStatus(request.status, request.expiresAt, now);
  if (status === 'REVOKED') return deny('CONFLICT', '该申请已撤销');
  if (status === 'EXPIRED') return deny('CONFLICT', '该申请已过期，无需撤销');
  if (status !== 'PENDING' && status !== 'ACCEPTED') {
    return deny('CONFLICT', `申请当前状态为 ${status}，不能撤销`);
  }
  return { allowed: true, nextStatus: 'REVOKED', revokedAt: now, revokedBy: actorId };
}

/**
 * 读取对方联系方式的前置条件：只有 `ACCEPTED`。
 *
 * 未同意 / 已拒绝 / 已撤销 / 已过期一律 `CONSENT_REQUIRED` —— 客户端据此
 * 引导用户先完成同意，而不是把"无权"误判成登录问题（401）。
 */
export function decideView(
  request: Pick<ContactExchangeRequestRecord, 'status' | 'expiresAt'>,
  now: Date,
): RequestDecision {
  const status = effectiveStatus(request.status, request.expiresAt, now);
  if (status === 'ACCEPTED') return { allowed: true, nextStatus: 'ACCEPTED' };
  return deny('CONSENT_REQUIRED', '双方尚未达成有效的联系方式交换同意');
}

/* ------------------------------------------------------------------ *
 * 限流
 * ------------------------------------------------------------------ */

/** 同一对用户 24h 内的申请次数是否已达上限（`>=`，计数包含已拒绝/已撤销的尝试） */
export function isRateLimited(recentCount: number, limit: number): boolean {
  return recentCount >= Math.max(1, limit);
}

/** 无序用户对 → 稳定键（只含用户 id，不含任何联系方式） */
export function pairKeyOf(left: string, right: string): string {
  return left <= right ? `${left}:${right}` : `${right}:${left}`;
}

/* ------------------------------------------------------------------ *
 * 联系方式值校验
 * ------------------------------------------------------------------ */

export interface ContactValueValidation {
  ok: boolean;
  value: string;
  message: string;
}

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const CHINA_MOBILE_PATTERN = /^1[3-9]\d{9}$/;
const WECHAT_PATTERN = /^[A-Za-z][-_A-Za-z0-9]{4,31}$/;
const QQ_PATTERN = /^[1-9]\d{4,11}$/;

/**
 * 规范化并校验联系方式值。
 *
 * 规范化在**校验前**做：手机号去掉空格/连字符与 `+86` 前缀，
 * 邮箱转小写。这样同一号码的不同写法会被同一个指纹识别为重复。
 */
export function validateContactValue(kind: ContactKind, raw: string): ContactValueValidation {
  const trimmed = raw.trim();

  if (kind === 'phone') {
    const normalized = trimmed.replace(/[\s-]/g, '').replace(/^\+?86/, '');
    if (!CHINA_MOBILE_PATTERN.test(normalized)) {
      return { ok: false, value: '', message: '手机号格式不正确（需要中国大陆 11 位手机号）' };
    }
    return { ok: true, value: normalized, message: '' };
  }

  if (kind === 'email') {
    const normalized = trimmed.toLowerCase();
    if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
      return { ok: false, value: '', message: '邮箱格式不正确' };
    }
    return { ok: true, value: normalized, message: '' };
  }

  if (kind === 'qq') {
    if (!QQ_PATTERN.test(trimmed)) {
      return { ok: false, value: '', message: 'QQ 号格式不正确（5–12 位数字，且不以 0 开头）' };
    }
    return { ok: true, value: trimmed, message: '' };
  }

  // wechat
  if (!WECHAT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      value: '',
      message: '微信号格式不正确（字母开头，5–32 位字母/数字/下划线/连字符）',
    };
  }
  return { ok: true, value: trimmed, message: '' };
}

/** 标签只允许短文本；`null` 表示不设标签 */
export function normalizeLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/* ------------------------------------------------------------------ *
 * 防"绕过交换"：申请附言不得夹带联系方式
 * ------------------------------------------------------------------ */

const CONTACT_INFO_PATTERNS: readonly RegExp[] = [
  // 中国大陆手机号（允许 +86 与空格/连字符）
  /(?:\+?86[\s-]?)?1[3-9]\d{9}/,
  // 邮箱
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  // "微信/WeChat/VX/威信: xxx"
  /(?:微信|wechat|weixin|vx|v信|威信)\s*[:：]?\s*[A-Za-z][-_A-Za-z0-9]{4,31}/i,
  // "QQ: 123456"
  /(?:qq|q\s*q)\s*[:：]?\s*[1-9]\d{4,11}/i,
];

/**
 * 是否在自由文本里检测到联系方式。
 *
 * 用于申请附言 —— 否则用户可以绕过整个同意流程，直接把微信号写进附言。
 * 这是**保守**检测：宁可误伤（提示用户删掉），也不放行一条绕过路径。
 */
export function containsContactInfo(text: string): boolean {
  return CONTACT_INFO_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAllowedContextModule(value: string): value is ContactExchangeContextModule {
  return (CONTACT_EXCHANGE_CONTEXT_MODULES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 游标（复合：at + id）
 * ------------------------------------------------------------------ */

/**
 * 游标 = base64url(`${ISO-8601}|${id}`)。
 *
 * 为什么用复合游标而不是单键 id：列表按 `createdAt desc, id desc` 排序，
 * 只用 id 会在同一毫秒的多条记录上跳条（契约 §11.10-E 明确允许复合游标）。
 * 对客户端仍然**不透明** —— 解码后重新编码必须与原文一致，否则拒绝。
 */
export function encodeTimeCursor(cursor: TimeCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeTimeCursor(raw: string | undefined | null): TimeCursor | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  const separator = decoded.lastIndexOf('|');
  if (separator <= 0 || separator === decoded.length - 1) throw new InvalidCursorError();

  const at = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(at.getTime()) || id.length === 0) throw new InvalidCursorError();

  const cursor: TimeCursor = { at, id };
  // 严格性：必须能被原样重编码回去（base64url 解码对垃圾输入很宽容）
  if (encodeTimeCursor(cursor) !== raw) throw new InvalidCursorError();
  return cursor;
}

/* ------------------------------------------------------------------ *
 * 允许清单投影（防泄漏）
 * ------------------------------------------------------------------ *
 *
 * 这里的函数**逐字段挑选**，不是"展开后删掉敏感字段"。
 * 后者的问题是：以后新增一个 `valueCipherV2` 列时，没人会记得回来补删除。
 * 允许清单则天然忽略所有未列出的字段。
 */

export function toContactEntryWire(record: ContactEntryRecord, value: string): ContactEntryWire {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    value,
    shared: record.shared,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toExchangedContactWire(record: ContactEntryRecord, value: string): ExchangedContactWire {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    value,
  };
}

export function toContactExchangeRequestWire(
  record: ContactExchangeRequestRecord,
): ContactExchangeRequestWire {
  return {
    id: record.id,
    requesterId: record.requesterId,
    addresseeId: record.addresseeId,
    status: record.status,
    contextModule: record.contextModule,
    contextId: record.contextId,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    respondedAt: record.respondedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    revokedBy: record.revokedBy ?? null,
  };
}

export function toContactAccessAuditWire(record: ContactAccessAuditRecord): ContactAccessAuditWire {
  return {
    id: record.id,
    requestId: record.requestId,
    actorId: record.actorId,
    subjectId: record.subjectId,
    action: record.action,
    entryIds: [...record.entryIds],
    entryKinds: [...record.entryKinds],
    entryCount: record.entryIds.length,
    at: record.at.toISOString(),
  };
}

/**
 * 日志载荷：**结构性**保证日志里不会出现联系方式。
 *
 * 入参类型只暴露 id / 类型 / 数量 / 时间，没有任何 `value` 字段；
 * 即使调用方传入一个带 `value` 的扩展对象，本函数也只挑白名单字段。
 * 由 `contact-exchange.domain.spec.ts` 用"故意带 value 的对象"反证。
 */
export function toAuditLogPayload(record: ContactAccessAuditRecord): Record<string, unknown> {
  return {
    event: 'contact-exchange.view',
    auditId: record.id,
    requestId: record.requestId,
    actorId: record.actorId,
    subjectId: record.subjectId,
    entryKinds: [...record.entryKinds],
    entryCount: record.entryIds.length,
    at: record.at.toISOString(),
  };
}
