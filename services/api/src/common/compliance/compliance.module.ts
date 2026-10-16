import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ConsentService } from './consent.service';
import { AuditPrismaRepository } from './data/audit.prisma-repository';
import { ConsentPrismaRepository } from './data/consent.prisma-repository';
import { AUDIT_REPOSITORY, CONSENT_REPOSITORY } from './compliance.types';

/**
 * 合规层（契约 §9）：审计 + 二次同意。
 *
 * 全局模块：任何业务模块都能注入 `AuditService` / `ConsentService`，
 * 无需各自 import —— 避免某个敏感模块"忘了"接审计。
 */
@Global()
@Module({
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: AuditPrismaRepository },
    { provide: CONSENT_REPOSITORY, useClass: ConsentPrismaRepository },
    AuditService,
    ConsentService,
  ],
  exports: [AuditService, ConsentService, AUDIT_REPOSITORY, CONSENT_REPOSITORY],
})
export class ComplianceModule {}
