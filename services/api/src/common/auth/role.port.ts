import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 角色端口（治理动作的授权落点）。
 *
 * 为什么需要它：契约 §11.2 冻结了 `forum.report`，但**没有**冻结
 * `hide` / `restore` / `answer` 这类治理动作名。因此论坛的隐藏/恢复
 * 走的是已冻结的 `PATCH /items/:id` + 状态机（不是自创 action 名），
 * 而"谁有权做这个状态流转"就落在这个端口上。
 *
 * 骨架阶段用环境变量白名单实现（`EnvRoleAdapter`），
 * 真实系统应换成后台角色表 —— 端口形状不变，用例层无需改动。
 */
export type KedaYaRole = 'forum_moderator' | 'faq_staff';

export const KEDAYA_ROLES: readonly KedaYaRole[] = ['forum_moderator', 'faq_staff'];

export interface RolePort {
  hasRole(userId: string, role: KedaYaRole): Promise<boolean>;
}

export const ROLE_PORT = Symbol('KEDAYA_ROLE_PORT');

/** 每个角色的环境变量名（运维可查；也用于交付说明与 .env.example） */
export const ROLE_ENV_KEYS: Record<KedaYaRole, string> = {
  forum_moderator: 'FORUM_MODERATOR_USER_IDS',
  faq_staff: 'FAQ_STAFF_USER_IDS',
};

/** 逗号分隔的 id 白名单 → 去空去重后的数组 */
export function parseIdList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

@Injectable()
export class EnvRoleAdapter implements RolePort {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async hasRole(userId: string, role: KedaYaRole): Promise<boolean> {
    if (!userId) return false;
    return parseIdList(this.config.get<string>(ROLE_ENV_KEYS[role])).includes(userId);
  }
}

@Global()
@Module({
  providers: [{ provide: ROLE_PORT, useClass: EnvRoleAdapter }],
  exports: [ROLE_PORT],
})
export class RoleModule {}
