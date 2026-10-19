import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { decryptSecret, encryptSecret } from '../../../common/crypto/secret-box';
import {
  ConflictError,
  InternalError,
  UpstreamUnavailableError,
  ValidationError,
} from '../../../common/errors/app-error';
import { MailService } from './mail.service';
import {
  assertNoMailCredentialKeys,
  type MailAccountPort,
  type MailAccountRecord,
  type MailClock,
  type MailEventRecord,
  type MailMessageRepository,
  type MailSyncState,
  type NewMailEvent,
} from '../domain/mail.domain';
import type {
  FetchRecentMailOptions,
  MailCredentials,
  MailInboxPort,
  RawMailMessage,
} from '../domain/ports/mail-inbox.port';

/**
 * 用例层测试：**用假端口 + 假 IMAP**，绝不真的连邮箱。
 *
 * 覆盖四条安全边界：
 *   1. 密码只以密文落库，且绑定前真的验证过；
 *   2. 同步失败保留上次结果并标 stale（不清空）；
 *   3. 解绑硬删；
 *   4. 绑定/同步/列表响应里没有凭据类键名。
 */

const KEY = 'a'.repeat(64); // 64 hex = 32 字节
const PASSWORD = 'mail-password-2026';
const USER_ID = 'user-1';
const IMAP_HOST = 'imap.stu.shanghaitech.edu.cn';
const EMAIL = 'student@stu.shanghaitech.edu.cn';
const NOW = new Date('2026-10-19T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * 假端口
 * ------------------------------------------------------------------ */

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    MAIL_CREDENTIAL_ENC_KEY: KEY,
    MAIL_TIME_ZONE: 'Asia/Shanghai',
    MAIL_SYNC_LOOKBACK_DAYS: '14',
    MAIL_SYNC_MAX_MESSAGES: '100',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

class MemoryAccounts implements MailAccountPort {
  readonly rows = new Map<string, MailAccountRecord>();

  async findByUserId(userId: string): Promise<MailAccountRecord | null> {
    return this.rows.get(userId) ?? null;
  }

  async upsert(input: {
    userId: string;
    email: string;
    imapHost: string;
    imapPort: number;
    passwordCipher: string;
    cipherKeyId: string;
  }): Promise<MailAccountRecord> {
    const existing = this.rows.get(input.userId);
    const row: MailAccountRecord = {
      id: existing?.id ?? 'acc-1',
      userId: input.userId,
      email: input.email,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      passwordCipher: input.passwordCipher,
      cipherKeyId: input.cipherKeyId,
      lastSyncAt: null,
      status: 'active',
    };
    this.rows.set(input.userId, row);
    return row;
  }

  async deleteByUserId(userId: string): Promise<boolean> {
    return this.rows.delete(userId);
  }

  async markSyncResult(userId: string, state: MailSyncState): Promise<void> {
    const row = this.rows.get(userId);
    if (row !== undefined) {
      row.lastSyncAt = state.lastSyncAt;
      row.status = state.status;
    }
  }
}

class MemoryMessages implements MailMessageRepository {
  events: MailEventRecord[] = [];
  private sequence = 0;

  async knownUids(accountId: string): Promise<Set<number>> {
    return new Set(
      this.events.filter((event) => event.accountId === accountId).map((event) => event.uid),
    );
  }

  async saveEvents(events: readonly NewMailEvent[]): Promise<number> {
    let count = 0;
    for (const event of events) {
      const duplicate = this.events.some(
        (existing) => existing.accountId === event.accountId && existing.uid === event.uid,
      );
      if (duplicate) continue;
      this.sequence += 1;
      this.events.push({ ...event, id: `event-${this.sequence}` });
      count += 1;
    }
    return count;
  }

  async listEvents(userId: string): Promise<MailEventRecord[]> {
    return this.events.filter((event) => event.userId === userId);
  }

  async markStale(accountId: string): Promise<number> {
    let count = 0;
    for (const event of this.events) {
      if (event.accountId === accountId) {
        event.stale = true;
        count += 1;
      }
    }
    return count;
  }

  async clearStale(accountId: string): Promise<number> {
    let count = 0;
    for (const event of this.events) {
      if (event.accountId === accountId) {
        event.stale = false;
        count += 1;
      }
    }
    return count;
  }

  async purgeForAccount(accountId: string): Promise<number> {
    const before = this.events.length;
    this.events = this.events.filter((event) => event.accountId !== accountId);
    return before - this.events.length;
  }
}

class FakeInbox implements MailInboxPort {
  readonly verifyCalls: MailCredentials[] = [];
  readonly fetchCalls: Array<{ credentials: MailCredentials; options: FetchRecentMailOptions }> = [];
  messages: RawMailMessage[] = [];
  verifyImpl: () => Promise<void> = async () => {};
  fetchImpl:
    | ((credentials: MailCredentials, options: FetchRecentMailOptions) => Promise<RawMailMessage[]>)
    | null = null;

  async verify(credentials: MailCredentials): Promise<void> {
    this.verifyCalls.push(credentials);
    await this.verifyImpl();
  }

  async fetchRecent(
    credentials: MailCredentials,
    options: FetchRecentMailOptions,
  ): Promise<RawMailMessage[]> {
    this.fetchCalls.push({ credentials, options });
    if (this.fetchImpl !== null) return this.fetchImpl(credentials, options);
    return this.messages.filter((message) => !options.skipUids.has(message.uid));
  }
}

function build(options: { config?: ConfigService } = {}) {
  const accounts = new MemoryAccounts();
  const messages = new MemoryMessages();
  const inbox = new FakeInbox();
  const clock: MailClock = { now: () => NOW };
  const service = new MailService(accounts, messages, inbox, options.config ?? makeConfig(), clock);
  return { service, accounts, messages, inbox };
}

function seedAccount(
  accounts: MemoryAccounts,
  overrides: Partial<MailAccountRecord> = {},
): MailAccountRecord {
  const row: MailAccountRecord = {
    id: 'acc-1',
    userId: USER_ID,
    email: EMAIL,
    imapHost: IMAP_HOST,
    imapPort: 993,
    passwordCipher: encryptSecret(PASSWORD, KEY),
    cipherKeyId: 'v1',
    lastSyncAt: null,
    status: 'active',
    ...overrides,
  };
  accounts.rows.set(USER_ID, row);
  return row;
}

describe('MailService · 绑定', () => {
  it('先真连一次 IMAP 验证，再把**密文**落库（明文不落库、不进响应）', async () => {
    const { service, accounts, inbox } = build();
    const view = await service.link(USER_ID, {
      email: 'Student@Stu.ShanghaiTech.edu.cn',
      imapHost: IMAP_HOST,
      imapPort: 993,
      password: PASSWORD,
    });

    expect(inbox.verifyCalls).toHaveLength(1);
    expect(inbox.verifyCalls[0]).toMatchObject({
      email: EMAIL,
      imapHost: IMAP_HOST,
      imapPort: 993,
      password: PASSWORD,
    });

    const stored = accounts.rows.get(USER_ID)!;
    expect(stored.passwordCipher).not.toBe(PASSWORD);
    expect(stored.passwordCipher).not.toContain(PASSWORD);
    expect(decryptSecret(stored.passwordCipher, KEY)).toBe(PASSWORD);
    expect(stored.cipherKeyId).toBe('v1');

    expect(view).toEqual({
      email: EMAIL,
      imapHost: IMAP_HOST,
      imapPort: 993,
      status: 'active',
      lastSyncAt: null,
    });
    expect(() => assertNoMailCredentialKeys(view)).not.toThrow();
    expect(JSON.stringify(view)).not.toMatch(/password|cipher|cookie|session/i);
  });

  it('IMAP 验证失败 → 拒绝，且数据库里什么都没有', async () => {
    const { service, accounts, inbox } = build();
    inbox.verifyImpl = async () => {
      throw new Error('authentication failed');
    };

    await expect(
      service.link(USER_ID, {
        email: EMAIL,
        imapHost: IMAP_HOST,
        imapPort: 993,
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(accounts.rows.size).toBe(0);
  });

  it('非校园邮箱 / 非学校域 IMAP 主机被拒（避免 SSRF 与任意来源）', async () => {
    const { service, accounts, inbox } = build();

    await expect(
      service.link(USER_ID, {
        email: 'someone@gmail.com',
        imapHost: IMAP_HOST,
        imapPort: 993,
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      service.link(USER_ID, {
        email: EMAIL,
        imapHost: '127.0.0.1',
        imapPort: 993,
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(inbox.verifyCalls).toHaveLength(0);
    expect(accounts.rows.size).toBe(0);
  });

  it('加密密钥缺失时 fail closed：不验证、不落库', async () => {
    const { service, accounts, inbox } = build({
      config: makeConfig({ MAIL_CREDENTIAL_ENC_KEY: undefined, CAMPUS_SESSION_ENC_KEY: undefined }),
    });

    await expect(
      service.link(USER_ID, {
        email: EMAIL,
        imapHost: IMAP_HOST,
        imapPort: 993,
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InternalError);
    expect(inbox.verifyCalls).toHaveLength(0);
    expect(accounts.rows.size).toBe(0);
  });

  it('换邮箱时清理旧邮箱的派生活动；同邮箱重绑保留活动', async () => {
    const { service, accounts, messages } = build();
    seedAccount(accounts);
    messages.events.push({
      id: 'event-old',
      userId: USER_ID,
      accountId: 'acc-1',
      uid: 7,
      title: '旧活动',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      location: null,
      organizer: null,
      confidence: 0.7,
      matchedText: '2026-10-01 08:00',
      receivedAt: NOW,
      stale: false,
    });

    await service.link(USER_ID, {
      email: EMAIL,
      imapHost: IMAP_HOST,
      imapPort: 993,
      password: PASSWORD,
    });
    expect(messages.events).toHaveLength(1);

    await service.link(USER_ID, {
      email: 'teacher@shanghaitech.edu.cn',
      imapHost: 'imap.shanghaitech.edu.cn',
      imapPort: 993,
      password: PASSWORD,
    });
    expect(messages.events).toHaveLength(0);
  });
});

describe('MailService · 同步', () => {
  it('拉邮件 → 只存归一后的活动；按 uid 去重', async () => {
    const { service, accounts, messages, inbox } = build();
    seedAccount(accounts);
    inbox.messages = [
      {
        uid: 101,
        subject: '【讲座】AI for Science',
        body: '时间：2026年10月20日 14:00\n地点：图书馆 302',
        receivedAt: NOW,
      },
      {
        uid: 102,
        subject: 'Lunch menu',
        body: '2026-10-20 12:00',
        receivedAt: NOW,
      },
      {
        uid: 103,
        subject: 'Meeting',
        body: 'Date: October 21, 2026\nTime: 3:30 PM',
        receivedAt: NOW,
      },
    ];
    // 103 之前已经处理过，适配器应跳过它
    messages.events.push({
      id: 'event-old',
      userId: USER_ID,
      accountId: 'acc-1',
      uid: 103,
      title: '旧会议',
      startsAt: new Date('2026-10-21T07:30:00Z'),
      location: null,
      organizer: null,
      confidence: 0.7,
      matchedText: 'October 21, 2026 3:30 PM',
      receivedAt: NOW,
      stale: false,
    });

    const result = await service.sync(USER_ID);

    expect(result).toEqual({
      scanned: 2,
      matched: 1,
      stored: 1,
      lastSyncAt: NOW.toISOString(),
      stale: false,
    });

    const fetch = inbox.fetchCalls[0]!;
    expect(fetch.options.limit).toBe(100);
    expect(fetch.options.since.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DAY_MS).toISOString(),
    );
    expect(fetch.options.skipUids.has(103)).toBe(true);
    expect(fetch.credentials.password).toBe(PASSWORD); // 同步时解密使用，但不返回

    const fresh = messages.events.find((event) => event.uid === 101)!;
    expect(fresh).toMatchObject({
      userId: USER_ID,
      accountId: 'acc-1',
      title: 'AI for Science',
      location: '图书馆 302',
      stale: false,
    });
    expect(fresh.startsAt.toISOString()).toBe('2026-10-20T06:00:00.000Z');

    const account = accounts.rows.get(USER_ID)!;
    expect(account.status).toBe('active');
    expect(account.lastSyncAt?.toISOString()).toBe(NOW.toISOString());

    // 响应里没有活动正文/密码/密文
    expect(() => assertNoMailCredentialKeys(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toMatch(/password|cipher|cookie|session/i);
  });

  it('上次同步时间会回退一天（IMAP SINCE 只精确到天）', async () => {
    const { service, accounts, inbox } = build();
    seedAccount(accounts, { lastSyncAt: new Date('2026-10-18T00:00:00.000Z') });

    await service.sync(USER_ID);
    expect(inbox.fetchCalls[0]!.options.since.toISOString()).toBe(
      new Date('2026-10-17T00:00:00.000Z').toISOString(),
    );
  });

  it('同步失败：标记 stale、保留上次结果、不清空', async () => {
    const { service, accounts, messages, inbox } = build();
    seedAccount(accounts, { lastSyncAt: new Date('2026-10-18T00:00:00.000Z') });
    messages.events.push({
      id: 'event-keep',
      userId: USER_ID,
      accountId: 'acc-1',
      uid: 55,
      title: '上次同步的活动',
      startsAt: new Date('2026-10-20T06:00:00Z'),
      location: '图书馆',
      organizer: null,
      confidence: 0.8,
      matchedText: '2026年10月20日 14:00',
      receivedAt: new Date('2026-10-18T00:00:00Z'),
      stale: false,
    });
    inbox.fetchImpl = async () => {
      throw new Error('IMAP timeout');
    };

    await expect(service.sync(USER_ID)).rejects.toBeInstanceOf(UpstreamUnavailableError);

    const account = accounts.rows.get(USER_ID)!;
    expect(account.status).toBe('stale');
    expect(account.lastSyncAt?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(messages.events).toHaveLength(1);
    expect(messages.events[0]!.stale).toBe(true);

    const view = await service.listEvents(USER_ID);
    expect(view.stale).toBe(true);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ title: '上次同步的活动', stale: true });
  });

  it('未绑定就同步 → 409 CONFLICT（不是 500，也不是静默空结果）', async () => {
    const { service } = build();
    await expect(service.sync(USER_ID)).rejects.toBeInstanceOf(ConflictError);
  });

  it('密文无法解密（密钥轮换/损坏）→ 标记 stale 并保留旧结果', async () => {
    const { service, accounts, messages } = build();
    seedAccount(accounts, { passwordCipher: 'v1.bad.bad.bad' });
    messages.events.push({
      id: 'event-keep',
      userId: USER_ID,
      accountId: 'acc-1',
      uid: 56,
      title: '旧活动',
      startsAt: new Date('2026-10-20T06:00:00Z'),
      location: null,
      organizer: null,
      confidence: 0.8,
      matchedText: '2026-10-20 14:00',
      receivedAt: NOW,
      stale: false,
    });

    await expect(service.sync(USER_ID)).rejects.toBeInstanceOf(InternalError);
    expect(accounts.rows.get(USER_ID)!.status).toBe('stale');
    expect(messages.events[0]!.stale).toBe(true);
  });
});

describe('MailService · 解绑与列表', () => {
  it('解绑硬删账户与派生活动；重复解绑幂等', async () => {
    const { service, accounts, messages } = build();
    seedAccount(accounts);
    messages.events.push({
      id: 'event-1',
      userId: USER_ID,
      accountId: 'acc-1',
      uid: 1,
      title: '活动',
      startsAt: new Date('2026-10-20T06:00:00Z'),
      location: null,
      organizer: null,
      confidence: 0.8,
      matchedText: '2026-10-20 14:00',
      receivedAt: NOW,
      stale: false,
    });

    await expect(service.unlink(USER_ID)).resolves.toEqual({ unlinked: true });
    expect(accounts.rows.has(USER_ID)).toBe(false);
    expect(messages.events).toHaveLength(0);

    await expect(service.unlink(USER_ID)).resolves.toEqual({ unlinked: true });
  });

  it('listEvents 按 startsAt 升序；没有账户时返回空列表', async () => {
    const { service, accounts, messages } = build();
    expect(await service.listEvents(USER_ID)).toEqual({ items: [], stale: false });

    seedAccount(accounts);
    messages.events.push(
      {
        id: 'event-late',
        userId: USER_ID,
        accountId: 'acc-1',
        uid: 2,
        title: '晚一点的活动',
        startsAt: new Date('2026-10-22T06:00:00Z'),
        location: null,
        organizer: null,
        confidence: 0.8,
        matchedText: '2026-10-22 14:00',
        receivedAt: NOW,
        stale: false,
      },
      {
        id: 'event-early',
        userId: USER_ID,
        accountId: 'acc-1',
        uid: 1,
        title: '早一点的活动',
        startsAt: new Date('2026-10-20T06:00:00Z'),
        location: null,
        organizer: null,
        confidence: 0.8,
        matchedText: '2026-10-20 14:00',
        receivedAt: NOW,
        stale: false,
      },
    );

    const view = await service.listEvents(USER_ID);
    expect(view.items.map((item) => item.title)).toEqual(['早一点的活动', '晚一点的活动']);
    expect(() => assertNoMailCredentialKeys(view)).not.toThrow();
    expect(JSON.stringify(view)).not.toMatch(/password|cipher|cookie|session/i);
  });
});
