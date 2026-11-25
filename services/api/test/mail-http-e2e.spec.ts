import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { API_BASE_PATH } from '@kedaya/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { json, type NextFunction, type Request, type Response } from 'express';

import { signJwt } from '../src/common/auth/jwt';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { TraceMiddleware } from '../src/common/middleware/trace.middleware';
import { MailController } from '../src/modules/mail/mail.controller';
import { MailService } from '../src/modules/mail/application/mail.service';
import { MailImapAdapter } from '../src/modules/mail/data/mail-imap.adapter';
import {
  MAIL_ACCOUNT_PORT,
  MAIL_CLOCK,
  MAIL_MESSAGE_REPOSITORY,
  type MailAccountPort,
  type MailAccountRecord,
  type MailEventRecord,
  type MailSyncState,
  type NewMailEvent,
  type MailMessageRepository,
} from '../src/modules/mail/domain/mail.domain';
import { MAIL_INBOX_PORT } from '../src/modules/mail/domain/ports/mail-inbox.port';

/**
 * 校园邮箱 **真实 IMAP** 的 HTTP 验收（真控制器 + 真守卫 + 真信封 + 真 IMAP）。
 *
 * 只有「数据库」换成了内存实现；IMAP 连接、密码加密、归一抽取都走生产代码。
 * 没有 Postgres 时也能跑，用来验证「绑定 → 同步 → 列表」这条链。
 *
 * 需要环境变量（缺任何一个就整体跳过，CI 默认跳过）：
 *   KEDAYA_MAIL_E2E_USER  邮箱地址
 *   KEDAYA_MAIL_E2E_PASS  客户端专用密码（不是账号密码）
 *
 * ⚠️ 本文件**不打印**密码：断言只检查响应里没有凭据类键名与密码原文。
 */

const SECRET = process.env.JWT_SECRET ?? 'test-secret-please-change-me-32-chars';
const USER_ID = 'user-mail-e2e';
const USER = process.env.KEDAYA_MAIL_E2E_USER;
const PASS = process.env.KEDAYA_MAIL_E2E_PASS;
const enabled = Boolean(USER && PASS);

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
    const row = {
      id: existing?.id ?? 'acc-1',
      userId: input.userId,
      email: input.email,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      passwordCipher: input.passwordCipher,
      cipherKeyId: input.cipherKeyId,
      status: 'active',
      lastSyncAt: null,
      createdAt: new Date('2026-11-25T00:00:00Z'),
      updatedAt: new Date('2026-11-25T00:00:00Z'),
    } as unknown as MailAccountRecord;
    this.rows.set(input.userId, row);
    return row;
  }

  async deleteByUserId(userId: string): Promise<boolean> {
    return this.rows.delete(userId);
  }

  async markSyncResult(userId: string, state: MailSyncState): Promise<void> {
    const row = this.rows.get(userId);
    if (row && state.lastSyncAt !== null) {
      (row as unknown as { lastSyncAt: Date | null }).lastSyncAt = state.lastSyncAt;
    }
  }
}

class MemoryMessages implements MailMessageRepository {
  readonly events: MailEventRecord[] = [];

  async knownUids(accountId: string): Promise<Set<number>> {
    return new Set(
      this.events
        .filter((event) => (event as unknown as { accountId: string }).accountId === accountId)
        .map((event) => Number((event as unknown as { uid: number }).uid)),
    );
  }

  async saveEvents(rows: readonly NewMailEvent[]): Promise<number> {
    for (const row of rows) this.events.push(row as unknown as MailEventRecord);
    return rows.length;
  }

  async listEvents(): Promise<MailEventRecord[]> {
    return [...this.events];
  }

  async markStale(): Promise<number> {
    return 0;
  }

  async clearStale(): Promise<number> {
    return 0;
  }

  async purgeForAccount(): Promise<number> {
    return 0;
  }
}

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    MAIL_CREDENTIAL_ENC_KEY: 'a'.repeat(64),
    MAIL_TIME_ZONE: 'Asia/Shanghai',
    MAIL_SYNC_LOOKBACK_DAYS: '7',
    MAIL_SYNC_MAX_MESSAGES: '10',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const accounts = new MemoryAccounts();
const messages = new MemoryMessages();

@Module({
  controllers: [MailController],
  providers: [
    MailService,
    MailImapAdapter,
    TraceMiddleware,
    { provide: MAIL_ACCOUNT_PORT, useValue: accounts },
    { provide: MAIL_MESSAGE_REPOSITORY, useValue: messages },
    { provide: MAIL_INBOX_PORT, useExisting: MailImapAdapter },
    { provide: MAIL_CLOCK, useValue: { now: () => new Date() } },
    { provide: ConfigService, useValue: makeConfig() },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class MailProbeModule {}

describe.skipIf(!enabled)('HTTP 集成：/mail 真实 IMAP（绑定 → 同步 → 列表）', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [MailProbeModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));
    app.use(json());
    const trace = app.get(TraceMiddleware);
    app.use((req: Request, res: Response, next: NextFunction) => trace.use(req, res, next));
    app.useLogger(false);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}${API_BASE_PATH}`;
    token = signJwt(USER_ID, 'access', SECRET, 900);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  it('绑定真实邮箱：先真连 IMAP 验证，响应里不回显密码', async () => {
    const response = await fetch(`${baseUrl}/mail/account`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        email: USER,
        imapHost: 'imap.shanghaitech.edu.cn',
        imapPort: 993,
        password: PASS,
      }),
    });
    const body = (await response.json()) as { ok: boolean; data?: unknown };
    expect(response.status).toBeLessThan(300);
    expect(body.ok).toBe(true);

    const text = JSON.stringify(body);
    expect(text).not.toContain(PASS as string);
    expect(text).not.toMatch(/passwordCipher|cipherKeyId|password/i);
  }, 120_000);

  it('同步最近邮件：返回计数，且不泄露凭据', async () => {
    const response = await fetch(`${baseUrl}/mail/sync`, { method: 'POST', headers: auth() });
    const body = (await response.json()) as { ok: boolean; data?: Record<string, unknown> };
    if (response.status >= 300) console.log('[mail-e2e] sync failed body=', JSON.stringify(body));
    expect(response.status).toBeLessThan(300);
    expect(body.ok).toBe(true);

    const text = JSON.stringify(body);
    expect(text).not.toContain(PASS as string);
    expect(text).not.toMatch(/passwordCipher|cipherKeyId/i);

    const data = body.data ?? {};
    // 只断言形状：具体数字取决于邮箱内容。
    expect(typeof data.scanned).toBe('number');
    expect(typeof data.matched).toBe('number');
    expect(typeof data.stored).toBe('number');
    console.log(
      `[mail-e2e] scanned=${data.scanned} matched=${data.matched} stored=${data.stored} stale=${data.stale}`,
    );
  }, 180_000);

  it('列表返回归一后的活动（含时间与标题），仍无凭据', async () => {
    const response = await fetch(`${baseUrl}/mail/events`, { headers: auth() });
    const body = (await response.json()) as {
      ok: boolean;
      data?: { items?: Array<Record<string, unknown>>; stale?: boolean };
    };
    expect(response.status).toBeLessThan(300);
    expect(body.ok).toBe(true);

    const items = body.data?.items ?? [];
    console.log(`[mail-e2e] events=${items.length}`);
    for (const item of items.slice(0, 5)) {
      console.log(
        `  · ${String(item.title).slice(0, 40)} | ${String(item.startsAt)} | ${String(item.location ?? '—')}`,
      );
    }
    expect(JSON.stringify(body)).not.toContain(PASS as string);
    // 真邮箱里绝大多数情况下能识别出至少一封活动邮件；识别不到也允许（内容取决于收件箱）。
    for (const item of items) {
      expect(typeof item.title).toBe('string');
      expect(typeof item.startsAt).toBe('string');
    }
  }, 120_000);
});
