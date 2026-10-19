/**
 * 校园邮箱接入 · domain 层（**零框架依赖**）
 *
 * 本文件只放领域类型与端口，不 import Nest / Prisma / imapflow。
 * 依赖方向固定为 `domain ← data / application`，这样：
 *   · `extractEventFromMail` 可以在三端任意运行、用固定时间做确定性测试；
 *   · 业务逻辑测试可以注入假 IMAP / 假仓储，**不需要真的连邮箱**。
 *
 * ## 安全边界（写死在类型里，不是文档建议）
 *
 * 1. `passwordCipher` 是 AES-256-GCM **密文**，只允许在 data 层落库；
 *    它**永不出现在任何响应里**，也不得写日志。
 * 2. 明文 `password` 只存在于 `LinkMailAccountCommand` 这一个**入参**类型里，
 *    它没有、也不会有对应的 view 类型。
 * 3. 本模块**只读收信**：没有 SMTP / sendMail 端口，也没有任何发信方法。
 * 4. 落库的只有**归一后的活动**（`MailEvent`）与定位所需的 UID / 时间等元数据，
 *    **不存邮件正文**。
 */

/* ------------------------------------------------------------------ *
 * 账户
 * ------------------------------------------------------------------ */

/** 账户状态。`stale` = 上次同步失败，**保留上次结果**，绝不清空。 */
export type MailAccountStatus = 'active' | 'stale';

/**
 * 账户持久化记录（**data 层内部形状**）。
 *
 * ⚠️ `passwordCipher` 是密文，**永远不能**被投影进响应。
 * 需要下发给客户端时一律走 `toMailAccountView()`。
 */
export interface MailAccountRecord {
  id: string;
  userId: string;
  email: string;
  imapHost: string;
  imapPort: number;
  /** AES-256-GCM 密文；**永不出现在任何响应里** */
  passwordCipher: string;
  /** 密钥版本（轮换用）；**永不出现在任何响应里** */
  cipherKeyId: string;
  lastSyncAt: Date | null;
  status: MailAccountStatus;
}

/** 绑定成功后的**响应**形状：没有密码、没有密文、没有密钥版本。 */
export interface MailAccountView {
  email: string;
  imapHost: string;
  imapPort: number;
  status: MailAccountStatus;
  lastSyncAt: string | null;
}

/** 绑定入参。`password` 只在这里出现，加密后立即丢弃。 */
export interface LinkMailAccountCommand {
  email: string;
  imapHost: string;
  imapPort: number;
  password: string;
}

export interface UpsertMailAccountInput {
  userId: string;
  email: string;
  imapHost: string;
  imapPort: number;
  passwordCipher: string;
  cipherKeyId: string;
}

export interface MailSyncState {
  lastSyncAt: Date | null;
  status: MailAccountStatus;
}

/**
 * 账户端口（data 层实现）。
 *
 * 注意：这里**没有** `findPassword` / `getPlainPassword` 之类的方法。
 * 解密只发生在 `MailService.sync()` 的一小段作用域内，且明文只作为
 * `MailInboxPort` 的调用参数存在。
 */
export interface MailAccountPort {
  findByUserId(userId: string): Promise<MailAccountRecord | null>;
  /** 重新绑定即覆盖旧凭证；`lastSyncAt` 清空，事件由应用层决定是否清理。 */
  upsert(input: UpsertMailAccountInput): Promise<MailAccountRecord>;
  /** **硬删**账户行（密文随之消失），返回是否真的删到了行。 */
  deleteByUserId(userId: string): Promise<boolean>;
  markSyncResult(userId: string, state: MailSyncState): Promise<void>;
}

export const MAIL_ACCOUNT_PORT = Symbol('KEDAYA_MAIL_ACCOUNT_PORT');

/* ------------------------------------------------------------------ *
 * 归一后的活动
 * ------------------------------------------------------------------ */

/** 一条归一后的活动/截止事项（data 层内部形状）。 */
export interface MailEventRecord {
  id: string;
  userId: string;
  accountId: string;
  /** INBOX 内的 UID；同一账户内唯一，用于幂等去重 */
  uid: number;
  title: string;
  startsAt: Date;
  location: string | null;
  organizer: string | null;
  confidence: number;
  /** 命中的时间原文片段（可解释性）；**不是**邮件正文 */
  matchedText: string;
  receivedAt: Date;
  stale: boolean;
}

/** 待写入的新活动（还没有 id / createdAt）。 */
export interface NewMailEvent {
  userId: string;
  accountId: string;
  uid: number;
  title: string;
  startsAt: Date;
  location: string | null;
  organizer: string | null;
  confidence: number;
  matchedText: string;
  receivedAt: Date;
  stale: boolean;
}

/** 活动的**响应**形状。 */
export interface MailEventView {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  organizer: string | null;
  confidence: number;
  matchedText: string;
  receivedAt: string;
  stale: boolean;
}

export interface MailEventsView {
  items: MailEventView[];
  stale: boolean;
}

export interface MailSyncResult {
  /** 本次实际拉取并尝试解析的邮件数 */
  scanned: number;
  /** 从邮件中认出活动的数量 */
  matched: number;
  /** 真正新落库的数量（UID 已存在会被跳过） */
  stored: number;
  lastSyncAt: string;
  stale: boolean;
}

export interface MailUnlinkResult {
  unlinked: true;
}

/**
 * 活动仓储端口。名字沿用任务给定的 `MailMessageRepository`，
 * 但它**只存归一后的活动**，不存原始邮件 —— 这是安全边界的一部分。
 */
export interface MailMessageRepository {
  /** 已处理过的 UID 集合（按 uid 去重，避免重复下载正文） */
  knownUids(accountId: string): Promise<Set<number>>;
  /** 幂等写入：`(accountId, uid)` 唯一，重复的跳过 */
  saveEvents(events: readonly NewMailEvent[]): Promise<number>;
  listEvents(userId: string): Promise<MailEventRecord[]>;
  /** 同步失败：把该账户的旧结果标记为 stale，**不删除** */
  markStale(accountId: string): Promise<number>;
  /** 同步成功：清除 stale 标记 */
  clearStale(accountId: string): Promise<number>;
  /** 解绑/换邮箱时清理派生数据 */
  purgeForAccount(accountId: string): Promise<number>;
}

export const MAIL_MESSAGE_REPOSITORY = Symbol('KEDAYA_MAIL_MESSAGE_REPOSITORY');

/* ------------------------------------------------------------------ *
 * 时钟
 * ------------------------------------------------------------------ */

export interface MailClock {
  now(): Date;
}

export const MAIL_CLOCK = Symbol('KEDAYA_MAIL_CLOCK');

/* ------------------------------------------------------------------ *
 * 投影（逐字段显式挑选，避免 Prisma 加字段时悄悄进响应）
 * ------------------------------------------------------------------ */

export function toMailAccountView(account: MailAccountRecord): MailAccountView {
  return {
    email: account.email,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    status: account.status,
    lastSyncAt: account.lastSyncAt === null ? null : account.lastSyncAt.toISOString(),
  };
}

export function toMailEventView(event: MailEventRecord, stale = event.stale): MailEventView {
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    location: event.location,
    organizer: event.organizer,
    confidence: event.confidence,
    matchedText: event.matchedText,
    receivedAt: event.receivedAt.toISOString(),
    stale,
  };
}

/**
 * 这些键名**绝不允许**出现在绑定/同步/活动响应里。
 *
 * 由 `mail.service.spec.ts` 对**真实返回对象**做递归扫描，
 * 而不是只靠"类型上没写"—— 一次 `...row` 就能绕过类型。
 */
export const FORBIDDEN_MAIL_RESPONSE_KEYS: readonly string[] = [
  'password',
  'passwordcipher',
  'passwordhash',
  'cipherkeyid',
  'cookie',
  'cookies',
  'session',
  'sessiontoken',
  'token',
  'authcode',
  'imappassword',
];

/** 递归扫描禁用键名（大小写不敏感、忽略 `_` / `-`）。 */
export function assertNoMailCredentialKeys(value: unknown, where = 'MailResponse'): void {
  const normalize = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');
  const forbidden = new Set(FORBIDDEN_MAIL_RESPONSE_KEYS.map(normalize));

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.has(normalize(key))) {
        // 错误信息不回显键名之外的内容，也绝不回显值
        throw new Error(`${where} 违反了邮件模块安全边界：出现了凭据类键名（已脱敏）`);
      }
      walk(child, depth + 1);
    }
  };

  walk(value, 0);
}
