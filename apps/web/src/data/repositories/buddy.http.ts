/**
 * 找搭子 HTTP 仓储 —— 端口 `BuddyRepository` 的真实实现（契约 §6.1 冻结路由）。
 *
 * 路由（模块名一律来自 `@kedaya/contracts` 的模块注册表，不硬编码字符串）：
 *   GET    /api/v1/buddy/items
 *   POST   /api/v1/buddy/items
 *   GET    /api/v1/buddy/items/:id
 *   POST   /api/v1/buddy/items/:id/join      已冻结 action（契约 §11.2）
 *   POST   /api/v1/buddy/items/:id/leave     已冻结 action
 *   POST   /api/v1/buddy/items/:id/close     已冻结 action
 *   POST   /api/v1/buddy/items/:id/decide    已冻结 action
 *   POST   /api/v1/buddy/items/:id/feedback  已冻结 action
 *   GET    /api/v1/buddy/recommendations
 *   GET    /api/v1/buddy/applications        集合路由（契约 §11.11）
 *   GET|PUT|DELETE /api/v1/buddy/profile     单例资源
 *
 * ⚠️ 身份：`userId` 从 `Authorization: Bearer` 取（`ApiClient.getAccessToken`），
 * **不**作为查询参数下发 —— 让客户端传 userId 等于把越权面交给客户端。
 * 端口里的 `userId` / `viewerId` 参数在 HTTP 实现里被显式忽略（前缀 `_`）。
 */
import { modulePath } from '@kedaya/contracts';
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { BuddyApplication, BuddyMatchFeedback, BuddyPost, BuddyProfile } from '@/domain/models/buddy';
import type {
  BuddyPostDetail,
  BuddyPostListQuery,
  BuddyRecommendationPage,
  BuddyRepository,
  CloseBuddyPostInput,
  CreateBuddyPostInput,
  DecideBuddyApplicationInput,
  JoinBuddyPostInput,
  LeaveBuddyPostInput,
} from '@/domain/ports/buddy';

import { createTraceId, type ApiClient } from '../api/client';
import {
  safeParseBuddyApplication,
  safeParseBuddyApplications,
  safeParseBuddyFeedback,
  safeParseBuddyPost,
  safeParseBuddyPostDetail,
  safeParseBuddyPostPage,
  safeParseBuddyProfile,
  safeParseBuddyRecommendationPage,
} from '../schemas/buddy';

const ITEMS_PATH = `/${modulePath('buddy', 'items')}`;
const RECOMMENDATIONS_PATH = `/${modulePath('buddy', 'recommendations')}`;
const APPLICATIONS_PATH = `/${modulePath('buddy', 'applications')}`;
const PROFILE_PATH = `/${modulePath('buddy', 'profile')}`;

/** ApiClientError → 契约 ApiError（端口只认契约错误载荷） */
function toApiError(cause: { code: ApiError['code']; message: string; details?: unknown }): ApiError {
  return cause.details === undefined
    ? { code: cause.code, message: cause.message }
    : { code: cause.code, message: cause.message, details: cause.details };
}

function contractMismatch(what: string, issues: string[]): ApiError {
  return { code: 'INTERNAL', message: `后端返回的${what}不符合冻结契约`, details: { issues } };
}

export function createBuddyHttpRepository(client: ApiClient): BuddyRepository {
  const itemPath = (id: string, ...rest: string[]): string =>
    `${ITEMS_PATH}/${encodeURIComponent(id)}${rest.length > 0 ? `/${rest.join('/')}` : ''}`;

  return {
    async listPosts(query: BuddyPostListQuery): Promise<Result<Page<BuddyPost>, ApiError>> {
      const result = await client.get<unknown>(ITEMS_PATH, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.section === undefined ? {} : { section: query.section }),
        ...(query.activity === undefined ? {} : { activity: query.activity }),
        ...(query.tags === undefined || query.tags.length === 0
          ? {}
          : { tags: query.tags.join(',') }),
        ...(query.startsAfter === undefined ? {} : { startsAfter: query.startsAfter }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
        ...(query.includeClosed === undefined ? {} : { includeClosed: query.includeClosed }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyPostPage(result.value);
      if (!parsed.ok) return err(contractMismatch('活动列表', parsed.issues));
      return ok(parsed.value);
    },

    async postDetail(id: string, _viewerId: string): Promise<Result<BuddyPostDetail, ApiError>> {
      const result = await client.get<unknown>(itemPath(id));
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyPostDetail(result.value);
      if (!parsed.ok) return err(contractMismatch('活动详情', parsed.issues));
      return ok(parsed.value);
    },

    async createPost(input: CreateBuddyPostInput): Promise<Result<BuddyPost, ApiError>> {
      const result = await client.post<unknown>(
        ITEMS_PATH,
        {
          activity: input.activity,
          title: input.title,
          description: input.description,
          location: input.location,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          capacity: input.capacity,
          genderPreference: input.genderPreference,
          tags: input.tags,
          minSkillLevel: input.minSkillLevel,
        },
        // 契约 §11.3：POST 必须带 Idempotency-Key
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyPost(result.value);
      if (!parsed.ok) return err(contractMismatch('发布结果', parsed.issues));
      return ok(parsed.value);
    },

    async join(input: JoinBuddyPostInput): Promise<Result<BuddyApplication, ApiError>> {
      const result = await client.post<unknown>(
        itemPath(input.postId, 'join'),
        { ...(input.message === undefined ? {} : { message: input.message }) },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyApplication(result.value);
      if (!parsed.ok) return err(contractMismatch('申请结果', parsed.issues));
      return ok(parsed.value);
    },

    async leave(input: LeaveBuddyPostInput): Promise<Result<BuddyApplication, ApiError>> {
      const result = await client.post<unknown>(
        itemPath(input.postId, 'leave'),
        {},
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyApplication(result.value);
      if (!parsed.ok) return err(contractMismatch('撤回结果', parsed.issues));
      return ok(parsed.value);
    },

    async decide(input: DecideBuddyApplicationInput): Promise<Result<BuddyPostDetail, ApiError>> {
      const result = await client.post<unknown>(
        itemPath(input.postId, 'decide'),
        { applicationId: input.applicationId, decision: input.decision },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyPostDetail(result.value);
      if (!parsed.ok) return err(contractMismatch('审批结果', parsed.issues));
      return ok(parsed.value);
    },

    async close(input: CloseBuddyPostInput): Promise<Result<BuddyPost, ApiError>> {
      const result = await client.post<unknown>(
        itemPath(input.postId, 'close'),
        {},
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyPost(result.value);
      if (!parsed.ok) return err(contractMismatch('关闭结果', parsed.issues));
      return ok(parsed.value);
    },

    async feedback(input): Promise<Result<BuddyMatchFeedback, ApiError>> {
      const result = await client.post<unknown>(
        itemPath(input.postId, 'feedback'),
        { section: input.section, action: input.action },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyFeedback(result.value);
      if (!parsed.ok) return err(contractMismatch('反馈结果', parsed.issues));
      return ok(parsed.value);
    },

    async recommendations(query): Promise<Result<BuddyRecommendationPage, ApiError>> {
      // `userId` 刻意**不**下发：身份来自 Bearer token
      const result = await client.get<unknown>(RECOMMENDATIONS_PATH, {
        section: query.section,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyRecommendationPage(result.value);
      if (!parsed.ok) return err(contractMismatch('推荐结果', parsed.issues));
      return ok({
        items: parsed.value.items.map((item) => ({
          post: item.post,
          score: item.score,
          reason: item.reason,
          reasons: item.reasons ?? [],
        })),
        nextCursor: parsed.value.nextCursor,
        matchMode: parsed.value.matchMode,
      });
    },

    async listMyApplications(_userId: string): Promise<Result<BuddyApplication[], ApiError>> {
      const result = await client.get<unknown>(APPLICATIONS_PATH);
      if (!result.ok) return err(toApiError(result.error));

      // 服务端可以直接给数组，也可以给分页信封；两种都接受
      const payload =
        result.value && typeof result.value === 'object' && 'items' in (result.value as object)
          ? (result.value as { items: unknown }).items
          : result.value;

      const parsed = safeParseBuddyApplications(payload);
      if (!parsed.ok) return err(contractMismatch('我的申请列表', parsed.issues));
      return ok(parsed.value);
    },

    async getProfile(_userId: string): Promise<Result<BuddyProfile, ApiError>> {
      const result = await client.get<unknown>(PROFILE_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyProfile(result.value);
      if (!parsed.ok) return err(contractMismatch('匹配资料', parsed.issues));
      return ok(parsed.value);
    },

    async putProfile(input): Promise<Result<BuddyProfile, ApiError>> {
      const result = await client.put<unknown>(
        PROFILE_PATH,
        {
          sections: input.sections,
          interestTags: input.interestTags,
          activityTags: input.activityTags,
          skillLevel: input.skillLevel,
          availability: input.availability,
          preferredAreas: input.preferredAreas,
          department: input.department,
          bio: input.bio,
          matchEnabled: input.matchEnabled,
        },
        { idempotencyKey: input.idempotencyKey ?? createTraceId() },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseBuddyProfile(result.value);
      if (!parsed.ok) return err(contractMismatch('匹配资料', parsed.issues));
      return ok(parsed.value);
    },

    async deleteProfile(_userId: string): Promise<Result<{ deleted: true }, ApiError>> {
      const result = await client.del<unknown>(PROFILE_PATH);
      if (!result.ok) return err(toApiError(result.error));
      return ok({ deleted: true });
    },
  };
}
