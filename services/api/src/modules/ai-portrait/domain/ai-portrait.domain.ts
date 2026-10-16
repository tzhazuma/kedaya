import type { ResourceRepository } from '../../../common/crud/resource';
import { ForbiddenError } from '../../../common/errors/app-error';

/**
 * AI 校园画像 · ai-portrait（契约 §4.1，敏感级 **high**）
 *
 * 契约 §9「数据最小化」的落点：
 *   心理（wellbeing）与宿舍矛盾（dorm-harmony）数据**不得进入**通用画像。
 */

export const AI_PORTRAIT_MODULE_ID = 'ai-portrait';

/** 契约 §9：这些模块的数据**禁止**被画像读取 */
export const FORBIDDEN_PORTRAIT_SOURCES: readonly string[] = ['wellbeing', 'dorm-harmony'];

/** 允许作为画像输入的低/中敏感模块 */
export const ALLOWED_PORTRAIT_SOURCES: readonly string[] = [
  'groupbuy',
  'errand',
  'flea-market',
  'canteen',
  'forum',
  'schedule',
  'lost-found',
  'buddy',
  'wildlife',
  'faq',
];

export interface AiPortraitProfileModel {
  id: string;
  userId: string;
  /** 画像标签（可解释） */
  traits: unknown;
  /** 每个标签的推导来源，供用户查看"为什么给我推这个" */
  explain: unknown;
  /** 用户可关闭（契约 §9） */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAiPortraitProfileInput {
  traits: unknown;
  explain: unknown;
  enabled?: boolean;
}

export interface UpdateAiPortraitProfileInput {
  traits?: unknown;
  explain?: unknown;
  enabled?: boolean;
}

export type AiPortraitProfileRepository = ResourceRepository<
  AiPortraitProfileModel,
  CreateAiPortraitProfileInput,
  UpdateAiPortraitProfileInput
> & {
  findByUserId(userId: string): Promise<AiPortraitProfileModel | null>;
  upsertForUser(
    userId: string,
    input: { traits: unknown; explain: unknown; enabled: boolean },
  ): Promise<AiPortraitProfileModel>;
};

export const AI_PORTRAIT_PROFILE_REPOSITORY = Symbol('KEDAYA_AI_PORTRAIT_PROFILE_REPOSITORY');

/**
 * 契约 §9 的运行时护栏：任何把禁读域当作画像来源的请求都会被拒绝。
 * 这是**可执行**的合规断言，而不是文档约定。
 */
export function assertAllowedSources(sources: readonly string[]): void {
  const forbidden = sources.filter((source) => FORBIDDEN_PORTRAIT_SOURCES.includes(source));
  if (forbidden.length > 0) {
    throw new ForbiddenError(
      `契约 §9 数据最小化：ai-portrait 不得读取 [${forbidden.join(', ')}] 的数据`,
      { forbidden, rule: 'data-minimization' },
    );
  }

  const unknown = sources.filter((source) => !ALLOWED_PORTRAIT_SOURCES.includes(source));
  if (unknown.length > 0) {
    throw new ForbiddenError(`以下模块不在画像允许的数据来源白名单内：[${unknown.join(', ')}]`, {
      unknown,
      allowed: ALLOWED_PORTRAIT_SOURCES,
    });
  }
}
