import { Inject, Injectable } from '@nestjs/common';
import { requiresConsent } from '@kedaya/contracts';
import { ConsentRequiredError, ValidationError } from '../errors/app-error';
import { currentContext } from '../context/request-context';
import {
  CONSENT_REPOSITORY,
  type ConsentMeta,
  type ConsentRecord,
  type ConsentRepository,
} from './compliance.types';

/**
 * 敏感模块二次同意（契约 §9）。
 *
 * 关键设计：**哪些模块需要同意，不在本服务里硬编码**，而是查
 * `@kedaya/contracts` 的 `requiresConsent()` —— 那是冻结契约 §4 的唯一真相。
 * 这样将来契约增删同意门模块时，后端无需改代码。
 */
@Injectable()
export class ConsentService {
  constructor(@Inject(CONSENT_REPOSITORY) private readonly repository: ConsentRepository) {}

  /** 该模块是否需要同意门 */
  isGated(moduleId: string): boolean {
    return requiresConsent(moduleId);
  }

  /**
   * 是否已获得有效同意。
   * 非同意门模块（如 auth / campus-card）恒返回 true —— 契约 §9 明确说明
   * 登录/开卡这个行为本身就是同意，不叠二次同意门。
   */
  async hasActiveConsent(userId: string, moduleId: string): Promise<boolean> {
    if (!this.isGated(moduleId)) return true;
    return (await this.repository.findActive(userId, moduleId)) !== null;
  }

  /** 校验并抛出 `CONSENT_REQUIRED`（契约 §6.1 错误码） */
  async requireConsent(userId: string, moduleId: string): Promise<void> {
    if (!(await this.hasActiveConsent(userId, moduleId))) {
      throw new ConsentRequiredError(moduleId);
    }
  }

  async grant(userId: string, moduleId: string, meta: ConsentMeta = {}): Promise<ConsentRecord> {
    if (!this.isGated(moduleId)) {
      throw new ValidationError(`模块 ${moduleId} 不需要二次同意，无需授权`, { module: moduleId });
    }
    const context = currentContext();
    return this.repository.upsertGrant(userId, moduleId, {
      version: meta.version,
      ip: meta.ip ?? context?.ip ?? null,
      ua: meta.ua ?? context?.ua ?? null,
    });
  }

  async revoke(userId: string, moduleId: string): Promise<ConsentRecord | null> {
    return this.repository.revoke(userId, moduleId);
  }

  list(userId: string): Promise<ConsentRecord[]> {
    return this.repository.listByUser(userId);
  }
}
