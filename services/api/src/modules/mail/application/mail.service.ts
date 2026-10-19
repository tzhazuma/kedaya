/**
 * 校园邮箱 · 用例层（application）
 *
 * 只编排：验证凭证 → 加密落库 → 拉信 → 抽取 → 存活动 → 解绑硬删。
 * IMAP、数据库、加密算法都在 data / common 层，本文件不直接 import imapflow。
 *
 * ## 四条硬规则
 *
 * 1. **绑定前先真连一次 IMAP**。连不上就拒绝，不存坏凭证 ——
 *    否则用户会看到"绑定成功"，但每次同步都失败，且数据库里多了一份没用的密文。
 * 2. **明文密码只在 `link()` 的局部变量里存在**：验证完立即 `encryptSecret`，
 *    之后只碰 `passwordCipher`。本文件没有任何日志语句，所以密码不可能进日志。
 * 3. **同步失败不清空**：把账户与已有活动标 `stale`，上次结果原样保留。
 * 4. **解绑 = 硬删**。账户行（含密文）删除；派生活动也一并清理。
 *    外部行为是幂等的：没绑过也返回成功。
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret, encryptSecret } from '../../../common/crypto/secret-box';
import {
  AppError,
  ConflictError,
  InternalError,
  UpstreamUnavailableError,
  ValidationError,
} from '../../../common/errors/app-error';
import { isCampusEmail } from '../../auth/domain/verification-code';
import { extractEventFromMail } from '../domain/mail-event.domain';
import {
  MAIL_ACCOUNT_PORT,
  MAIL_CLOCK,
  MAIL_MESSAGE_REPOSITORY,
  toMailAccountView,
  toMailEventView,
  type LinkMailAccountCommand,
  type MailAccountPort,
  type MailAccountRecord,
  type MailAccountView,
  type MailClock,
  type MailEventRecord,
  type MailEventsView,
  type MailMessageRepository,
  type MailSyncResult,
  type MailUnlinkResult,
  type NewMailEvent,
} from '../domain/mail.domain';
import {
  MAIL_INBOX_PORT,
  MailInboxError,
  type MailInboxPort,
} from '../domain/ports/mail-inbox.port';

/** 首次同步回看天数；可用 `MAIL_SYNC_LOOKBACK_DAYS` 覆盖（1..90） */
const DEFAULT_LOOKBACK_DAYS = 14;
/** 单次最多拉取邮件数；可用 `MAIL_SYNC_MAX_MESSAGES` 覆盖（1..500） */
const DEFAULT_MAX_MESSAGES = 100;
/** 学校时区；可用 `MAIL_TIME_ZONE` 覆盖。必须显式，避免在 UTC CI 上差 8 小时。 */
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
/** 密钥版本；轮换密钥时改这里 */
const CIPHER_KEY_ID = 'v1';
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_ACCOUNT_PORT) private readonly accounts: MailAccountPort,
    @Inject(MAIL_MESSAGE_REPOSITORY) private readonly messages: MailMessageRepository,
    @Inject(MAIL_INBOX_PORT) private readonly inbox: MailInboxPort,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MAIL_CLOCK) private readonly clock: MailClock,
  ) {}

  /* ---------------- 绑定 ---------------- */

  /**
   * 绑定校园邮箱。
   *
   * 1. 解析加密密钥（缺配置直接失败，绝不退化成明文存储）；
   * 2. 用**真实 IMAP 连接**验证凭证；
   * 3. 验证通过后才加密落库；失败则数据库里什么都不会留下。
   */
  async link(userId: string, command: LinkMailAccountCommand): Promise<MailAccountView> {
    const email = command.email.trim().toLowerCase();
    const imapHost = command.imapHost.trim();
    const imapPort = command.imapPort;
    const plainPassword = command.password;

    // 只接校园邮箱：这不是"产品限制"，而是身份前提 —— 开放任意邮箱会让
    // "校内邮件"变成任意来源。同时把 IMAP 主机限制在学校域内，避免 SSRF
    // （用户填一个内网地址就能让服务端替他连内网）。
    if (!isCampusEmail(email)) {
      throw new ValidationError('请使用上海科技大学校园邮箱（@shanghaitech.edu.cn 或 @stu.shanghaitech.edu.cn）');
    }
    if (!isCampusImapHost(imapHost)) {
      throw new ValidationError('IMAP 服务器必须是 shanghaitech.edu.cn 域内的主机', {
        reason: 'IMAP_HOST_NOT_ALLOWED',
      });
    }

    const encryptionKey = this.encryptionKey();

    try {
      await this.inbox.verify({
        email,
        imapHost,
        imapPort,
        password: plainPassword,
      });
    } catch (error) {
      const reason = error instanceof MailInboxError ? error.reason : 'VERIFY_FAILED';
      // 不把底层错误消息直接给客户端：里面可能带服务器地址/协议细节。
      throw new ValidationError(
        '无法用这组凭证登录校园邮箱 IMAP，请检查邮箱地址、服务器与密码',
        { reason },
      );
    }

    let passwordCipher: string;
    try {
      passwordCipher = encryptSecret(plainPassword, encryptionKey);
    } catch {
      throw new InternalError('邮箱凭证加密失败：加密密钥配置不合法');
    }

    const previous = await this.accounts.findByUserId(userId);
    const account = await this.accounts.upsert({
      userId,
      email,
      imapHost,
      imapPort,
      passwordCipher,
      cipherKeyId: CIPHER_KEY_ID,
    });

    // 换了邮箱：旧邮箱归一出的活动不再可信，硬删。
    // 同一个邮箱重新绑定：保留活动（UID 去重仍然有效），只清掉 stale 标记。
    if (previous !== null && previous.email !== email) {
      await this.messages.purgeForAccount(previous.id);
    }
    await this.messages.clearStale(account.id);

    return toMailAccountView(account);
  }

  /* ---------------- 同步 ---------------- */

  /**
   * 拉取最近邮件 → `extractEventFromMail` → 只存归一后的活动。
   *
   * 失败时：账户与已有活动标 `stale`，**不删除任何上次结果**，然后向上抛
   * `UPSTREAM_UNAVAILABLE`（让客户端知道"这次没拉到"，而不是"活动没了"）。
   */
  async sync(userId: string): Promise<MailSyncResult> {
    const account = await this.requireAccount(userId);
    const now = this.clock.now();
    const timeZone = this.timeZone();

    let plainPassword: string;
    try {
      plainPassword = decryptSecret(account.passwordCipher, this.encryptionKey());
    } catch {
      await this.markFailed(account);
      throw new InternalError('邮箱凭证无法解密，请重新绑定校园邮箱');
    }

    const lookbackDays = this.readInt(
      'MAIL_SYNC_LOOKBACK_DAYS',
      DEFAULT_LOOKBACK_DAYS,
      1,
      90,
    );
    const maxMessages = this.readInt('MAIL_SYNC_MAX_MESSAGES', DEFAULT_MAX_MESSAGES, 1, 500);

    // IMAP SINCE 只精确到天：上次同步当天稍早的信可能被漏掉，所以回退一天；
    // 已处理 UID 会跳过，不会重复落库。
    const since =
      account.lastSyncAt === null
        ? new Date(now.getTime() - lookbackDays * DAY_MS)
        : new Date(account.lastSyncAt.getTime() - DAY_MS);

    try {
      const knownUids = await this.messages.knownUids(account.id);
      const rawMessages = await this.inbox.fetchRecent(
        {
          email: account.email,
          imapHost: account.imapHost,
          imapPort: account.imapPort,
          password: plainPassword,
        },
        { since, limit: maxMessages, skipUids: knownUids },
      );

      const events: NewMailEvent[] = [];
      for (const message of rawMessages) {
        const extracted = extractEventFromMail(
          message.subject,
          message.body,
          message.receivedAt,
          timeZone,
        );
        if (extracted === null) continue;

        events.push({
          userId,
          accountId: account.id,
          uid: message.uid,
          title: extracted.title,
          startsAt: new Date(extracted.startsAt),
          location: extracted.location,
          organizer: extracted.organizer,
          confidence: extracted.confidence,
          matchedText: extracted.matchedText,
          receivedAt: message.receivedAt,
          stale: false,
        });
      }

      // `(accountId, uid)` 唯一 + skipDuplicates：重复同步不会产生重复活动。
      const stored = await this.messages.saveEvents(events);

      // 成功一次即清除历史 stale 标记；旧的"上次结果"重新变成可信快照。
      await this.messages.clearStale(account.id);
      await this.accounts.markSyncResult(userId, { lastSyncAt: now, status: 'active' });

      return {
        scanned: rawMessages.length,
        matched: events.length,
        stored,
        lastSyncAt: now.toISOString(),
        stale: false,
      };
    } catch (error) {
      await this.markFailed(account);

      if (error instanceof AppError) throw error;
      if (error instanceof RangeError) {
        // 只可能来自非法的 MAIL_TIME_ZONE；这是配置错误，不是上游故障。
        throw new InternalError('MAIL_TIME_ZONE 配置不合法，无法归一活动时间');
      }
      throw new UpstreamUnavailableError('校园邮箱同步失败，已保留上次结果', {
        reason: 'IMAP_SYNC_FAILED',
      });
    }
  }

  /* ---------------- 解绑 ---------------- */

  /** 硬删凭证。派生活动也清理；没绑过也返回成功（幂等）。 */
  async unlink(userId: string): Promise<MailUnlinkResult> {
    const account = await this.accounts.findByUserId(userId);

    if (account !== null) {
      try {
        await this.messages.purgeForAccount(account.id);
      } catch {
        // 数据库外键本身是 ON DELETE CASCADE；即使清理失败，下一步删账户也会级联。
        // 这里绝不因为"派生数据没删干净"而阻止删除凭证。
      }
    }

    await this.accounts.deleteByUserId(userId);
    return { unlinked: true };
  }

  /* ---------------- 活动列表 ---------------- */

  /**
   * 返回归一后的活动（按开始时间升序）。
   *
   * 账户处于 `stale` 时，所有活动都标 `stale: true` —— 让客户端能显示
   * "上次同步失败，以下为上次结果"，而不是让用户以为日历一直没变。
   */
  async listEvents(userId: string): Promise<MailEventsView> {
    const account = await this.accounts.findByUserId(userId);
    const events = await this.messages.listEvents(userId);
    const stale = account?.status === 'stale';

    const sorted = [...events].sort(
      (left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.id.localeCompare(right.id),
    );

    return {
      items: sorted.map((event: MailEventRecord) => toMailEventView(event, stale || event.stale)),
      stale,
    };
  }

  /* ---------------- 内部 ---------------- */

  private async requireAccount(userId: string): Promise<MailAccountRecord> {
    const account = await this.accounts.findByUserId(userId);
    if (account === null) {
      throw new ConflictError('尚未绑定校园邮箱', { reason: 'MAIL_ACCOUNT_NOT_LINKED' });
    }
    return account;
  }

  /**
   * 同步失败：保留上次结果，只标 stale。
   *
   * 两个写入分别 try/catch：标记失败不能掩盖原始错误（否则用户看到的是
   * "数据库错误"而不是"IMAP 拉取失败"）。
   */
  private async markFailed(account: MailAccountRecord): Promise<void> {
    try {
      await this.messages.markStale(account.id);
    } catch {
      // 保留原始错误
    }
    try {
      await this.accounts.markSyncResult(account.userId, {
        lastSyncAt: account.lastSyncAt,
        status: 'stale',
      });
    } catch {
      // 保留原始错误
    }
  }

  /**
   * 加密密钥解析。
   *
   * 优先 `MAIL_CREDENTIAL_ENC_KEY`，未配置时回退到既有的
   * `CAMPUS_SESSION_ENC_KEY`（两者都是 AES-256-GCM 的 32 字节密钥）。
   * 关键点：**没有密钥就失败**，绝不退化成明文存储。
   */
  private encryptionKey(): string {
    const dedicated = this.config.get<string>('MAIL_CREDENTIAL_ENC_KEY');
    const fallback = this.config.get<string>('CAMPUS_SESSION_ENC_KEY');
    const key = dedicated?.trim() ? dedicated : fallback?.trim() ? fallback : null;

    if (key === null) {
      throw new InternalError(
        'MAIL_CREDENTIAL_ENC_KEY 未配置：无法安全保存校园邮箱凭证',
        { reason: 'MAIL_ENC_KEY_MISSING' },
      );
    }
    return key;
  }

  private timeZone(): string {
    const configured = this.config.get<string>('MAIL_TIME_ZONE');
    return configured?.trim() ? configured.trim() : DEFAULT_TIME_ZONE;
  }

  private readInt(key: string, fallback: number, min: number, max: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }
}

/**
 * IMAP 主机白名单：只允许学校域（含子域）。
 *
 * 为什么不是"让用户随便填"：服务端会替用户发起 TCP 连接，任意 host 等于把
 * 后端变成 SSRF 跳板（`127.0.0.1`、云元数据地址、内网管理口）。
 * 校园邮箱的 IMAP 服务只可能在学校域内，因此这条限制没有牺牲可用性。
 */
function isCampusImapHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  return normalized === 'shanghaitech.edu.cn' || normalized.endsWith('.shanghaitech.edu.cn');
}
