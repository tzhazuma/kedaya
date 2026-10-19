/**
 * 校园邮箱 · 账户 Prisma 仓储（data 层）
 *
 * data 层是唯一允许碰 IO 的地方。本文件只读写 `MailAccount`，
 * **不负责** IMAP 连接（见 `mail-imap.adapter.ts`），也**不负责**业务编排。
 *
 * ⚠️ `passwordCipher` 在这里被逐字段搬运，但永远只走向数据库；
 * 任何"下发给客户端"的投影都必须经过 domain 的 `toMailAccountView()`。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MailAccount } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  MailAccountPort,
  MailAccountRecord,
  MailAccountStatus,
  MailSyncState,
  UpsertMailAccountInput,
} from '../domain/mail.domain';

/** DB 里的状态是字符串；归一化避免脏值把 UI 打崩。 */
function normalizeStatus(value: string): MailAccountStatus {
  return value === 'stale' ? 'stale' : 'active';
}

/** 行 → 领域模型。逐字段显式映射，Prisma 加字段时不会悄悄进响应。 */
export function toMailAccountRecord(row: MailAccount): MailAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    passwordCipher: row.passwordCipher,
    cipherKeyId: row.cipherKeyId,
    lastSyncAt: row.lastSyncAt,
    status: normalizeStatus(row.status),
  };
}

@Injectable()
export class MailAccountPrismaRepository implements MailAccountPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MailAccountRecord | null> {
    const row = await this.prisma.mailAccount.findUnique({ where: { userId } });
    return row === null ? null : toMailAccountRecord(row);
  }

  /**
   * 绑定/重新绑定。
   *
   * `lastSyncAt` 归零是刻意的：换了凭证（甚至换了邮箱）之后，
   * 旧的同步游标不再可信。已知 UID 仍会阻止重复落库，所以归零不会制造重复活动。
   */
  async upsert(input: UpsertMailAccountInput): Promise<MailAccountRecord> {
    const row = await this.prisma.mailAccount.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        email: input.email,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        passwordCipher: input.passwordCipher,
        cipherKeyId: input.cipherKeyId,
        lastSyncAt: null,
        status: 'active',
      },
      update: {
        email: input.email,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        passwordCipher: input.passwordCipher,
        cipherKeyId: input.cipherKeyId,
        lastSyncAt: null,
        status: 'active',
      },
    });
    return toMailAccountRecord(row);
  }

  /** 硬删：`deleteMany` 会真正删除行（不是软删标记）。 */
  async deleteByUserId(userId: string): Promise<boolean> {
    const result = await this.prisma.mailAccount.deleteMany({ where: { userId } });
    return result.count > 0;
  }

  async markSyncResult(userId: string, state: MailSyncState): Promise<void> {
    await this.prisma.mailAccount.updateMany({
      where: { userId },
      data: { lastSyncAt: state.lastSyncAt, status: state.status },
    });
  }
}
