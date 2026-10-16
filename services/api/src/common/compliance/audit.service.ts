import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { currentContext } from '../context/request-context';
import {
  AUDIT_REPOSITORY,
  type AuditEntry,
  type AuditListParams,
  type AuditRecord,
  type AuditRepository,
} from './compliance.types';

/**
 * 审计日志服务（契约 §9）。
 *
 * 两种写入语义，刻意分开：
 *   · `record()`       —— **fail-closed**。敏感模块（wellbeing / dorm-harmony /
 *                         ai-portrait）必须用它：审计写不进去就不能放行读写。
 *   · `recordQuietly()` —— 尽力而为，失败只告警。用于非敏感模块的辅助埋点。
 *
 * ip / ua / actorId 未显式提供时，自动从请求上下文补齐，
 * 避免每个调用点重复传参。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository) {}

  async record(entry: AuditEntry): Promise<AuditRecord> {
    return this.repository.append(this.withContext(entry));
  }

  async recordQuietly(entry: AuditEntry): Promise<void> {
    try {
      await this.repository.append(this.withContext(entry));
    } catch (error) {
      this.logger.warn(
        `审计日志写入失败（已降级，不影响主流程）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  list(params: AuditListParams): Promise<Page<AuditRecord>> {
    return this.repository.list(params);
  }

  private withContext(entry: AuditEntry): AuditEntry {
    const context = currentContext();
    return {
      ...entry,
      actorId: entry.actorId ?? context?.userId ?? null,
      actorType: entry.actorType ?? (entry.actorId || context?.userId ? 'user' : 'anonymous'),
      ip: entry.ip ?? context?.ip ?? null,
      ua: entry.ua ?? context?.ua ?? null,
    };
  }
}
