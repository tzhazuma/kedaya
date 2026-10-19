/**
 * 校园邮箱 · IMAP 只读端口（domain 层）
 *
 * ## 为什么端口在 domain、imapflow 在 data
 *
 * 业务层测试需要注入**假的 IMAP 实现**，而不是真的连学校邮箱：
 *   · 没有测试账号；
 *   · 真实连接会让 CI 变慢且不稳定；
 *   · 更不能把测试用的凭证写进仓库。
 *
 * 所以 domain 只描述"取最近 N 天的邮件"这件事，`imapflow` 的具体调用
 * 全部关在 `data/mail-imap.adapter.ts` 里。
 *
 * ## 只读约束
 *
 * 适配器只会调用 `mailboxOpen('INBOX', { readOnly: true })`。
 * 端口上**没有** `send` / `append` / `delete` / `markSeen` 之类的方法 ——
 * 不是"忘了写"，而是从类型上就不给发信与改写的路径。
 */

/** 连接邮箱所需的**明文**凭证。只在内存中短暂存在，绝不落库。 */
export interface MailCredentials {
  email: string;
  imapHost: string;
  imapPort: number;
  /** 明文密码：只作为 IMAP 连接参数，加密后立即丢弃 */
  password: string;
}

export interface FetchRecentMailOptions {
  /** 起始日期（IMAP SINCE 只精确到天） */
  since: Date;
  /** 本次最多拉多少封（防止大邮箱拖垮内存） */
  limit: number;
  /** 已处理过的 UID，跳过正文下载 */
  skipUids: ReadonlySet<number>;
}

/** 从 IMAP 取回的一封邮件的**瞬时**形状；不会整体落库。 */
export interface RawMailMessage {
  uid: number;
  subject: string;
  /** 已解码为 UTF-8 的正文纯文本（HTML 已尽量转成文本） */
  body: string;
  receivedAt: Date;
}

export type MailInboxFailureReason = 'VERIFY_FAILED' | 'FETCH_FAILED' | 'CONNECTION_FAILED';

/**
 * IMAP 适配器抛出的错误。
 *
 * ⚠️ `message` 必须是**脱敏**的：不得包含邮箱密码、完整连接串或原始响应。
 * 原始错误只会放进 `cause`，供服务端排查，不参与序列化。
 */
export class MailInboxError extends Error {
  constructor(
    readonly reason: MailInboxFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MailInboxError';
  }
}

export interface MailInboxPort {
  /** 用给定凭证建立一次真实连接，验证账号可用；失败即拒绝绑定。 */
  verify(credentials: MailCredentials): Promise<void>;
  /** 拉取最近邮件（只读），按 uid 去重后返回。 */
  fetchRecent(credentials: MailCredentials, options: FetchRecentMailOptions): Promise<RawMailMessage[]>;
}

export const MAIL_INBOX_PORT = Symbol('KEDAYA_MAIL_INBOX_PORT');
