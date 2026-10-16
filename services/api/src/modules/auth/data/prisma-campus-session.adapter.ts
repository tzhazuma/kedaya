import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CampusBinding } from '@prisma/client';
import { decryptSecret, encryptSecret, fingerprintSecret } from '../../../common/crypto/secret-box';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CampusBindCredentials,
  CampusBindingRecord,
  CampusPlatform,
  CampusSession,
  CampusSessionPort,
} from '../domain/auth.domain';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 第二级 · 能力层的 Prisma 实现（契约 §5）。
 *
 * 这是**唯一**接触校园系统 session 明文的地方：
 *   · 落库前用 AES-256-GCM 加密（`encryptedSession`）+ 不可逆指纹；
 *   · 对外返回的 `CampusBindingRecord` **不含**密文，也不含明文；
 *   · 只有 `acquireSession()` 会解密，且返回值由调用方（campus 能力模块）负责不外泄。
 */
@Injectable()
export class PrismaCampusSessionAdapter implements CampusSessionPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private encryptionKey(): string {
    const key = this.config.get<string>('CAMPUS_SESSION_ENC_KEY');
    if (!key) {
      throw new Error('CAMPUS_SESSION_ENC_KEY 未配置：无法安全保存校园系统 session');
    }
    return key;
  }

  async bind(
    userId: string,
    platform: CampusPlatform,
    credentials: CampusBindCredentials,
  ): Promise<CampusBindingRecord> {
    const ttlSeconds = credentials.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const encryptedSession = encryptSecret(credentials.sessionCookie, this.encryptionKey());
    const sessionFingerprint = fingerprintSecret(credentials.sessionCookie);
    const scopes = credentials.scopes ?? [];

    const row = await this.prisma.campusBinding.upsert({
      where: { userId_platform: { userId, platform } },
      create: {
        userId,
        platform,
        encryptedSession,
        sessionFingerprint,
        scopes,
        expiresAt,
        status: 'active',
      },
      update: {
        // 重新绑定：覆盖旧密文与指纹
        encryptedSession,
        sessionFingerprint,
        scopes,
        expiresAt,
        status: 'active',
      },
    });

    return toBindingRecord(row);
  }

  async listBindings(userId: string): Promise<CampusBindingRecord[]> {
    const rows = await this.prisma.campusBinding.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toBindingRecord);
  }

  async acquireSession(userId: string, platform: CampusPlatform): Promise<CampusSession | null> {
    const row = await this.prisma.campusBinding.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    if (!row || row.status !== 'active' || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    await this.prisma.campusBinding.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      platform,
      sessionRef: decryptSecret(row.encryptedSession, this.encryptionKey()),
      expiresAt: row.expiresAt,
    };
  }

  async unbind(userId: string, platform: CampusPlatform): Promise<void> {
    await this.prisma.campusBinding.deleteMany({ where: { userId, platform } });
  }
}

/** 行 → 对外视图。**刻意丢弃** encryptedSession / sessionFingerprint。 */
function toBindingRecord(row: CampusBinding): CampusBindingRecord {
  return {
    id: row.id,
    platform: row.platform as CampusPlatform,
    status: row.status,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}
