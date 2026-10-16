/**
 * 仓储工厂 —— 装配点（契约 §7：`app/` 负责 DI 与运行时工厂）。
 *
 * 默认走 **mock**，保证 `npm run dev` 在完全没有后端时也能跑通垂直切片；
 * 设 `NEXT_PUBLIC_KEDAYA_USE_MOCK=false` 切到真实 HTTP（契约 §6.1 路由）。
 */
import { API_BASE_PATH } from '@kedaya/contracts';

import type { AuditLogRepository, ModuleSwitchRepository } from '@/domain/ports/audit';
import type { BuddyRepository } from '@/domain/ports/buddy';
import type { FaqRepository } from '@/domain/ports/faq';
import type { ForumRepository } from '@/domain/ports/forum';
import type { GroupBuyRepository } from '@/domain/ports/groupbuy';
import type { WildlifeRepository } from '@/domain/ports/wildlife';

import { createApiClient, type ApiClient } from '../api/client';
import {
  createMockAdminRepositories,
  type MockAdminRepositories,
} from '../mock/admin.repository';
import { createMockBuddyRepository, type MockBuddyRepository } from '../mock/buddy.repository';
import { createMockFaqRepository, type MockFaqRepository } from '../mock/faq.repository';
import { createMockForumRepository, type MockForumRepository } from '../mock/forum.repository';
import {
  createMockGroupBuyRepository,
  type MockGroupBuyRepository,
} from '../mock/groupbuy.repository';
import {
  createMockWildlifeRepository,
  type MockWildlifeRepository,
} from '../mock/wildlife.repository';
import { createAuditLogHttpRepository, createModuleSwitchHttpRepository } from './admin.http';
import { createBuddyHttpRepository } from './buddy.http';
import { createFaqHttpRepository } from './faq.http';
import { createForumHttpRepository } from './forum.http';
import { createGroupBuyHttpRepository } from './groupbuy.http';
import { createWildlifeHttpRepository } from './wildlife.http';

export type RepositoryMode = 'mock' | 'http';

export interface RepositoryBundle {
  mode: RepositoryMode;
  groupbuy: GroupBuyRepository;
  forum: ForumRepository;
  faq: FaqRepository;
  wildlife: WildlifeRepository;
  buddy: BuddyRepository;
  auditLog: AuditLogRepository;
  moduleSwitches: ModuleSwitchRepository;
}

/** 运行时模式：默认 mock（无后端可跑） */
export function repositoryMode(): RepositoryMode {
  return process.env.NEXT_PUBLIC_KEDAYA_USE_MOCK === 'false' ? 'http' : 'mock';
}

export function createRepositories(mode: RepositoryMode = repositoryMode()): RepositoryBundle {
  if (mode === 'http') {
    const client: ApiClient = createApiClient({
      baseUrl: process.env.NEXT_PUBLIC_KEDAYA_API_BASE ?? API_BASE_PATH,
      getAccessToken: () => process.env.NEXT_PUBLIC_KEDAYA_DEMO_TOKEN,
    });
    return {
      mode,
      groupbuy: createGroupBuyHttpRepository(client),
      forum: createForumHttpRepository(client),
      faq: createFaqHttpRepository(client),
      wildlife: createWildlifeHttpRepository(client),
      buddy: createBuddyHttpRepository(client),
      auditLog: createAuditLogHttpRepository(client),
      moduleSwitches: createModuleSwitchHttpRepository(client),
    };
  }

  const admin: MockAdminRepositories = createMockAdminRepositories();
  return {
    mode,
    groupbuy: createMockGroupBuyRepository(),
    forum: createMockForumRepository(),
    faq: createMockFaqRepository(),
    wildlife: createMockWildlifeRepository(),
    // mock 需要知道「我」是谁（真实 API 从 Bearer token 取）；
    // 默认取 fixture 的 DEMO_BUDDY_USER_ID，与 application 的演示会话由单测锁死一致
    buddy: createMockBuddyRepository(),
    auditLog: admin.auditLog,
    moduleSwitches: admin.moduleSwitches,
  };
}

/* ------------------------------------------------------------------ *
 * 单例：让 mock 的内存状态在页面间共享（例如故障演练开关）
 * ------------------------------------------------------------------ */

let bundle: RepositoryBundle | undefined;

export function getRepositories(): RepositoryBundle {
  bundle ??= createRepositories();
  return bundle;
}

/** 拿到 mock 拼单仓储（若非 mock 模式返回 undefined） */
export function getMockGroupBuyRepository(): MockGroupBuyRepository | undefined {
  const current = getRepositories();
  return current.mode === 'mock' ? (current.groupbuy as MockGroupBuyRepository) : undefined;
}

/** 拿到 mock 论坛仓储（用于故障演练开关 / 测试） */
export function getMockForumRepository(): MockForumRepository | undefined {
  const current = getRepositories();
  return current.mode === 'mock' ? (current.forum as MockForumRepository) : undefined;
}

/** 拿到 mock FAQ 仓储（用于故障演练开关 / 测试） */
export function getMockFaqRepository(): MockFaqRepository | undefined {
  const current = getRepositories();
  return current.mode === 'mock' ? (current.faq as MockFaqRepository) : undefined;
}

/** 拿到 mock wildlife 仓储（用于故障演练 / 分类模式开关 / 测试） */
export function getMockWildlifeRepository(): MockWildlifeRepository | undefined {
  const current = getRepositories();
  return current.mode === 'mock' ? (current.wildlife as MockWildlifeRepository) : undefined;
}

/** 拿到 mock 找搭子仓储（用于故障演练开关 / 测试） */
export function getMockBuddyRepository(): MockBuddyRepository | undefined {
  const current = getRepositories();
  return current.mode === 'mock' ? (current.buddy as MockBuddyRepository) : undefined;
}

/** 测试/热重载用：丢弃单例 */
export function resetRepositories(): void {
  bundle = undefined;
}
