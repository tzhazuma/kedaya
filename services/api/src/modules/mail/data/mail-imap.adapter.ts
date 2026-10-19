/**
 * 校园邮箱 · IMAP 适配器（data 层）
 *
 * ## 只读
 *
 * 唯一打开邮箱的调用是 `mailboxOpen('INBOX', { readOnly: true })`。
 * 本文件**没有** `send` / `append` / `messageDelete` / `messageFlagsAdd` 之类的方法 ——
 * 不是没写，而是从代码路径上就不给发信与改写的机会。
 *
 * ## 去重与失败
 *
 * · 按 UID 去重：调用方传入 `skipUids`，已处理过的邮件不再下载正文；
 *   最终幂等由 `MailEvent(accountId, uid)` 唯一约束再兜一层。
 * · 单封邮件正文损坏**不**让整次同步失败：只跳过该封正文，抽取器自然返回 `null`。
 * · 连接/登录/搜索失败会抛 `MailInboxError`；由应用层标记 `stale` 并**保留上次结果**。
 *
 * ## 安全
 *
 * · `logger: false`：imapflow 不打印协议日志，密码不可能进日志；
 * · 错误信息一律脱敏，原始错误只放在 `cause` 里，不参与序列化；
 * · 正文只以 `RawMailMessage` 的瞬时形式存在，**不会整体落库**。
 */

import { Inject, Injectable } from '@nestjs/common';
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import {
  MailInboxError,
  type FetchRecentMailOptions,
  type MailCredentials,
  type MailInboxPort,
  type RawMailMessage,
} from '../domain/ports/mail-inbox.port';

/** 单封邮件正文的最大读取量：防止超大附件把内存打满。 */
const MAX_BODY_BYTES = 512 * 1024;

/** 连接超时（ms） */
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 60_000;

@Injectable()
export class MailImapAdapter implements MailInboxPort {
  /** 建立一次真实连接来验证凭证；连不上就拒绝绑定。 */
  async verify(credentials: MailCredentials): Promise<void> {
    const client = this.createClient(credentials);
    try {
      await client.connect();
    } catch (error) {
      throw new MailInboxError('VERIFY_FAILED', '无法登录校园邮箱 IMAP（凭证或服务器不可用）', {
        cause: error,
      });
    } finally {
      await this.close(client);
    }
  }

  /** 拉取最近邮件（只读）。 */
  async fetchRecent(
    credentials: MailCredentials,
    options: FetchRecentMailOptions,
  ): Promise<RawMailMessage[]> {
    const client = this.createClient(credentials);
    try {
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });

      const found = await client.search({ since: options.since }, { uid: true });
      if (!Array.isArray(found) || found.length === 0) return [];

      const limit = Math.max(1, Math.floor(options.limit));
      const selected = found
        .filter((uid) => Number.isInteger(uid) && uid > 0 && !options.skipUids.has(uid))
        .sort((left, right) => left - right)
        .slice(-limit);
      if (selected.length === 0) return [];

      // ⚠️ 不能一边 `for await (client.fetch())` 一边下载正文 ——
      // imapflow 的注释明确说那会死循环。先 `fetchAll` 拿信封，再逐封 download。
      const messages = await client.fetchAll(
        selected.join(','),
        { uid: true, envelope: true, internalDate: true, bodyStructure: true },
        { uid: true },
      );

      const result: RawMailMessage[] = [];
      for (const message of messages) {
        if (!Number.isInteger(message.uid) || message.uid <= 0) continue;

        const subject = message.envelope?.subject ?? '';
        const body = await this.readTextBody(client, message);
        const receivedAt =
          toDate(message.internalDate) ?? toDate(message.envelope?.date) ?? new Date();

        result.push({ uid: message.uid, subject, body, receivedAt });
      }
      return result;
    } catch (error) {
      if (error instanceof MailInboxError) throw error;
      throw new MailInboxError('FETCH_FAILED', '读取校园邮箱失败（详情已省略，避免泄漏凭证）', {
        cause: error,
      });
    } finally {
      await this.close(client);
    }
  }

  private createClient(credentials: MailCredentials): ImapFlow {
    return new ImapFlow({
      host: credentials.imapHost,
      port: credentials.imapPort,
      // 993 = 隐式 TLS；143 = 明文连接后 STARTTLS（由服务端能力决定）
      secure: credentials.imapPort === 993,
      auth: { user: credentials.email, pass: credentials.password },
      // 关闭协议日志：密码与正文都不进日志
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  private async close(client: ImapFlow): Promise<void> {
    try {
      await client.logout();
    } catch {
      // 连接可能已经断开；这里不再抛，避免掩盖原始错误
    }
  }

  /**
   * 读取正文：优先 `text/plain`，没有就取 `text/html` 并粗略转文本。
   *
   * `download()` 会按 BODYSTRUCTURE 自动解码 Content-Transfer-Encoding，
   * 文本内容自动转成 UTF-8 —— 因此不需要再引一个 MIME 解析依赖。
   */
  private async readTextBody(client: ImapFlow, message: FetchMessageObject): Promise<string> {
    const plain = findBodyPart(message.bodyStructure, 'text/plain');
    const html = plain === undefined ? findBodyPart(message.bodyStructure, 'text/html') : undefined;
    const part = plain ?? html;
    if (part === undefined) return '';

    try {
      const download = await client.download(String(message.uid), part.part ?? '1', {
        uid: true,
        maxBytes: MAX_BODY_BYTES,
      });
      if (download.content === undefined) return '';

      const chunks: Buffer[] = [];
      for await (const chunk of download.content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const text = Buffer.concat(chunks).toString('utf8');
      return part.type === 'text/html' ? htmlToText(text) : text;
    } catch {
      // 单封正文损坏不应拖垮整次同步：返回空串，抽取器会返回 null。
      return '';
    }
  }
}

/**
 * 在 BODYSTRUCTURE 里找第一个指定类型的正文节点。
 *
 * 跳过 `Content-Disposition: attachment`：附件里的文字不是邮件正文。
 * 导出为纯函数以便不连 IMAP 也能测试。
 */
export function findBodyPart(
  structure: MessageStructureObject | undefined,
  type: 'text/plain' | 'text/html',
): MessageStructureObject | undefined {
  if (structure === undefined) return undefined;
  if (structure.disposition === 'attachment') return undefined;
  if (structure.type === type) return structure;

  for (const child of structure.childNodes ?? []) {
    const found = findBodyPart(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 粗略 HTML → 文本；只追求"能认出时间与关键词"，不追求排版。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#(\d+);/g, (_all, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toDate(value: Date | string | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** 编译期防漂移：适配器必须结构上满足端口。 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type MailImapAdapterSatisfiesPort = AssertAssignable<MailInboxPort, MailImapAdapter>;
