/**
 * 找搭子 · HTTP 层（规格 §5.1 端点总表 + §5.2 的 5 个冻结 action 名）
 *
 * ## 端点总表（19 个 + 2 个规格表遗漏但必需的）
 *
 * | # | 方法 | 路径 | 幂等键 |
 * | --- | --- | --- | --- |
 * | 1 | GET | `/profile` | — |
 * | 2 | PUT | `/profile` | 可选 |
 * | 3 | DELETE | `/profile` | 可选 |
 * | 4 | GET | `/items` | — |
 * | 5 | POST | `/items` | **必需** |
 * | 6 | GET | `/items/:id` | — |
 * | 7 | PATCH | `/items/:id` | 可选 |
 * | 8 | DELETE | `/items/:id` | 可选 |
 * | 9 | POST | `/items/:id/join` | **必需** |
 * | 10 | POST | `/items/:id/leave` | **必需** |
 * | 11 | POST | `/items/:id/close` | **必需** |
 * | 12 | POST | `/items/:id/decide` | **必需** |
 * | 12b | GET | `/items/:id/applications` | — ← **本实现补充**，见下 |
 * | 13 | GET | `/applications` | — |
 * | 14 | GET | `/recommendations` | — |
 * | 15 | POST | `/items/:id/feedback` | **必需** |
 * | 16 | GET | `/questionnaires` | — |
 * | 17 | GET | `/questionnaires/:slug` | — |
 * | 18 | POST | `/questionnaires/:slug/responses` | **必需** |
 * | 19 | GET | `/questionnaires/:slug/responses/me` | — |
 * | 20 | GET | `/tags` | — ← **本实现补充**，见下 |
 *
 * > **20 为什么必须存在（跨端 wire 缺口）**：服务端的封闭标签表是权威
 * > （`assertKnownTags` 抛 `UNKNOWN_TAG:<key>`），但规格 §5.1 的端点表里
 * > **没有**任何让客户端取到这张表的读端点。小程序因此只能内置一份镜像，
 * > 镜像一漂移，用户选到的标签就会被服务端拒绝，而客户端提交前无从得知。
 * > 修法是让服务端**下发权威表**（表本身仍只有 `@kedaya/contracts` 那一份）。
 * > 它是 `GET`，因此**不挂** `IdempotencyInterceptor`。
 *
 * > **12b 为什么必须存在**：规格 §6.1 的可见性矩阵写着"申请人列表：发起人 ✅"，
 * > 但 §5.1 的端点表里没有对应的读端点 —— 没有它，发起人拿不到 `applicationId`，
 * > `decide` 就无法使用。这是规格自身的缺口，本实现补上并记入交付说明。
 *
 * ## 全部端点都要求登录（规格 §5.1）
 *
 * `@UseGuards(AuthGuard)` 挂在**控制器**上，因此新增端点默认是受保护的 ——
 * 这比逐个方法加守卫安全（漏加一个就是一个匿名可读端点）。
 *
 * ## 幂等（契约 §11.3）
 *
 * 所有 `POST` 都挂 `IdempotencyInterceptor`（规格 §5.1 的"幂等键"列）。
 * 拦截器只对 POST 生效，缺 `Idempotency-Key` 直接 `VALIDATION_FAILED`。
 */

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { BUDDY_ACTIVITIES, BUDDY_SECTIONS, type BuddySection } from './domain/section';
import { SKILL_LEVELS } from './domain/tags';
import { BUDDY_POST_STATUSES, type BuddyPostStatus } from './domain/buddy-post.state';
import { BUDDY_APPLICATION_STATUSES } from './domain/buddy-application.state';
import type { CreateBuddyPostInput, UpdateBuddyPostInput } from './domain/buddy.domain';
import { BuddyProfileService } from './application/buddy-profile.service';
import { BuddyPostService } from './application/buddy-post.service';
import { BuddyApplicationService } from './application/buddy-application.service';
import { BuddyRecommendService } from './application/buddy-recommend.service';
import { BuddyFeedbackService } from './application/buddy-feedback.service';
import { BuddyQuestionnaireService } from './application/buddy-questionnaire.service';
import { BuddyTagsService } from './application/buddy-tags.service';
import {
  assertFutureStartsAt,
  assertKnownLocation,
  assertKnownLocations,
  assertKnownTags,
  assertPostTagCount,
} from './application/buddy-validation';

/* ------------------------------------------------------------------ *
 * Zod schema（形状与长度；白名单类校验见 application/buddy-validation.ts）
 * ------------------------------------------------------------------ */

const sectionSchema = z.enum(['academic', 'daily', 'sport']);
const activitySchema = z.enum(['sport', 'study', 'meal', 'travel', 'game', 'other']);
const skillLevelSchema = z.enum(['beginner', 'casual', 'regular', 'competitive']);
const genderPreferenceSchema = z.enum(['any', 'same', 'other']);
const feedbackActionSchema = z.enum(['like', 'dislike', 'skip']);

const availabilitySlotSchema = z
  .object({
    dow: z.number().int().min(0).max(6),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(0).max(1439),
  })
  .refine((slot) => slot.endMin > slot.startMin, {
    message: 'endMin 必须大于 startMin',
    path: ['endMin'],
  });

const createPostSchema = z.object({
  activity: activitySchema,
  title: z.string().min(1).max(60),
  description: z.string().max(1000).nullish(),
  location: z.string().min(1).max(64),
  startsAt: z.coerce.date(),
  durationMin: z.number().int().min(30).max(480).nullish(),
  capacity: z.number().int().min(2).max(20),
  genderPreference: genderPreferenceSchema.default('any'),
  tags: z.array(z.string()).max(8).default([]),
  minSkillLevel: skillLevelSchema.nullish(),
});

/**
 * PATCH 的 Merge Patch schema（RFC 7396，验收 T21）。
 *
 * `nullish()` 而不是 `optional()`：`null` 必须能表达"清空这个字段"，
 * 而 `optional()` 会把 `null` 判成非法。
 */
const patchPostSchema = z.object({
  title: z.string().min(1).max(60).optional(),
  description: z.string().max(1000).nullish(),
  location: z.string().min(1).max(64).optional(),
  startsAt: z.coerce.date().optional(),
  durationMin: z.number().int().min(30).max(480).nullish(),
  capacity: z.number().int().min(2).max(20).optional(),
  genderPreference: genderPreferenceSchema.optional(),
  tags: z.array(z.string()).max(8).optional(),
  minSkillLevel: skillLevelSchema.nullish(),
});

const joinSchema = z.object({ message: z.string().max(200).nullish() });

const decideSchema = z.object({
  applicationId: z.string().min(1).max(64),
  decision: z.enum(['ACCEPTED', 'REJECTED']),
});

const feedbackSchema = z.object({
  section: sectionSchema,
  action: feedbackActionSchema,
});

const putProfileSchema = z.object({
  sections: z.array(sectionSchema).max(3).default([]),
  interestTags: z.array(z.string()).max(20).default([]),
  activityTags: z.array(z.string()).max(10).default([]),
  skillLevel: skillLevelSchema.nullish(),
  availability: z.array(availabilitySlotSchema).max(28).default([]),
  preferredAreas: z.array(z.string()).max(5).default([]),
  department: z.string().max(64).nullish(),
  bio: z.string().max(200).nullish(),
  matchEnabled: z.boolean().default(false),
});

const questionnaireAnswersSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

/* ---------------- GET /items 的 status 过滤（跨端 wire 缺口 3） ---------------- */

/**
 * 可过滤的帖子状态白名单。
 *
 * ⚠️ **`EXPIRED` 刻意不在其中**：它由 `startsAt` 到期推导，不是用户可操作的状态，
 * 而且列表本来就有 `startsAt > now` 的约束 —— 允许 `status=EXPIRED`
 * 只会得到一个永远为空的查询。请求它是 `VALIDATION_FAILED`（fail closed），
 * 而不是"静默返回空列表"（后者会让客户端以为"确实没有过期活动"）。
 *
 * 顺序与 `BUDDY_POST_STATUSES` 一致，下面有编译期断言保证它不会漏掉或新增冻结状态。
 */
const LISTABLE_POST_STATUSES = ['OPEN', 'FULL', 'CLOSED', 'CANCELLED'] as const;

/**
 * `status` 查询参数：支持**重复**（`?status=OPEN&status=FULL`）与**逗号多值**
 * （`?status=OPEN,FULL`）两种写法 —— 三端框架的序列化习惯不同
 * （小程序/Web 用重复键，Flutter 的 `Uri` 习惯用逗号），服务端两种都收，
 * 免得某一端要为了"服务端只认一种"而写适配层。
 *
 * 缺省（不传 / 空串 / 全是空项）→ `undefined` = **不过滤**，与规格 §5.3 一致
 * （§5.3 的 query 表没有 `status`；§5.9 的 `where status='OPEN'` 与它矛盾，
 * 按 Lead 裁决以 §5.3 为准）。
 */
const postStatusFilterSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : [value];
    const parts = raw
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
      .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
      .filter((entry) => entry !== '');
    return parts.length > 0 ? parts : undefined;
  },
  z.array(z.enum(LISTABLE_POST_STATUSES)).optional(),
);

const listQuerySchema = z.object({
  section: sectionSchema.optional(),
  activity: z.string().max(200).optional(),
  tags: z.string().max(500).optional(),
  startsAfter: z.string().max(64).optional(),
  status: postStatusFilterSchema,
  cursor: z.string().max(500).optional(),
  limit: z.union([z.string(), z.number()]).optional(),
  sort: z.enum(['createdAt_desc', 'startsAt_asc']).optional(),
});

const recommendQuerySchema = z.object({
  section: sectionSchema,
  limit: z.union([z.string(), z.number()]).optional(),
});

const questionnaireListQuerySchema = z.object({ section: sectionSchema.optional() });

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败（沿用 `scripts/scaffold.mjs` 的做法）。
 */
type AssertAssignable<Target, Actual extends Target> = Actual extends Target ? true : never;
export type CreateSchemaMatchesDomain = AssertAssignable<
  CreateBuddyPostInput,
  z.infer<typeof createPostSchema>
>;
export type UpdateSchemaMatchesDomain = AssertAssignable<
  UpdateBuddyPostInput,
  z.infer<typeof patchPostSchema>
>;
/**
 * `status` 过滤白名单必须**全是**冻结状态（新增一个不存在的状态会在这里编译失败）。
 * 反向（漏掉某个可过滤状态）由 `EXPIRED` 的刻意排除说明，见上面的注释。
 */
export type ListableStatusesAreFrozen = AssertAssignable<
  BuddyPostStatus,
  (typeof LISTABLE_POST_STATUSES)[number]
>;

/* ------------------------------------------------------------------ *
 * 控制器
 * ------------------------------------------------------------------ */

@ApiTags('buddy · 找搭子')
@ApiBearerAuth()
@Controller(modulePath('buddy'))
@UseGuards(AuthGuard)
export class BuddyController {
  constructor(
    @Inject(BuddyProfileService) private readonly profile: BuddyProfileService,
    @Inject(BuddyPostService) private readonly posts: BuddyPostService,
    @Inject(BuddyApplicationService) private readonly applications: BuddyApplicationService,
    @Inject(BuddyRecommendService) private readonly recommend: BuddyRecommendService,
    @Inject(BuddyFeedbackService) private readonly feedback: BuddyFeedbackService,
    @Inject(BuddyQuestionnaireService) private readonly questionnaires: BuddyQuestionnaireService,
    @Inject(BuddyTagsService) private readonly tags: BuddyTagsService,
  ) {}

  /* ---------------- 标签表（20） ---------------- */

  /**
   * 权威标签表 + 数量上限。
   *
   * `GET` → **不挂** `IdempotencyInterceptor`（拦截器只对 POST 生效，但这里刻意不挂，
   * 免得将来拦截器扩展成"所有方法都要求幂等键"时把读端点也拖下水）。
   * 登录要求由控制器级 `AuthGuard` 保证 —— 与其它 buddy 端点一致。
   */
  @Get('tags')
  @ApiOperation({ summary: '权威标签表与数量上限（客户端渲染选择器用）' })
  listTags() {
    return this.tags.list();
  }

  /* ---------------- 资料（1–3） ---------------- */

  @Get('profile')
  @ApiOperation({ summary: '读我的匹配资料（只有自己可见）' })
  getProfile(@CurrentUser() userId: string) {
    return this.profile.get(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: '整体替换我的匹配资料' })
  putProfile(@CurrentUser() userId: string, @ZodBody(putProfileSchema) body: z.infer<typeof putProfileSchema>) {
    assertKnownTags(body.interestTags, 'interestTags');
    assertKnownTags(body.activityTags, 'activityTags');
    const preferredAreas = assertKnownLocations(body.preferredAreas, 'preferredAreas');

    if (body.sections.length === 0) {
      throw new ValidationError('至少要选择一个板块才能被推荐', { field: 'sections' });
    }

    return this.profile.put(userId, {
      sections: body.sections,
      interestTags: [...new Set(body.interestTags)],
      activityTags: [...new Set(body.activityTags)],
      skillLevel: body.skillLevel ?? null,
      availability: body.availability,
      preferredAreas,
      department: body.department ?? null,
      bio: body.bio ?? null,
      matchEnabled: body.matchEnabled,
    });
  }

  @Delete('profile')
  @ApiOperation({ summary: '删除匹配资料（含 embedding），立即从推荐池移除' })
  async deleteProfile(@CurrentUser() userId: string): Promise<{ deleted: true }> {
    await this.profile.remove(userId);
    return { deleted: true };
  }

  /* ---------------- 活动列表 / CRUD（4–8） ---------------- */

  @Get('items')
  @ApiOperation({ summary: '活动列表（游标分页，契约 §6.1 不用 offset；status 可多值）' })
  listItems(@CurrentUser() userId: string, @ZodQuery(listQuerySchema) query: z.infer<typeof listQuerySchema>) {
    const startsAfter = query.startsAfter ? new Date(query.startsAfter) : undefined;
    if (startsAfter && Number.isNaN(startsAfter.getTime())) {
      throw new ValidationError('startsAfter 不是合法 ISO 时间', { field: 'startsAfter' });
    }

    return this.posts.list({
      section: query.section,
      activities: parseCsv(query.activity),
      tags: parseCsv(query.tags),
      startsAfter,
      // 缺省 undefined = **不过滤**（规格 §5.3 优先于 §5.9，见 schema 处的说明）。
      // 传了就必须是 LISTABLE_POST_STATUSES 里的值，否则管道已经 400。
      statuses: query.status,
      cursor: readCursor(query as unknown as Record<string, unknown>),
      limit: normalizeLimit(query.limit),
      // 默认 createdAt_desc：这样游标就是 id，**逐字符合**契约 api-contract §3.1。
      // `startsAt_asc` 需要复合游标（规格 U3 的唯一偏离），已实现但非默认。
      sort: query.sort ?? 'createdAt_desc',
    });
  }

  @Post('items')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '发布活动（需 Idempotency-Key）' })
  createItem(
    @CurrentUser() userId: string,
    @ZodBody(createPostSchema) body: z.infer<typeof createPostSchema>,
  ) {
    assertKnownTags(body.tags, 'tags');
    assertPostTagCount(body.tags);
    const location = assertKnownLocation(body.location);
    assertFutureStartsAt(body.startsAt);

    return this.posts.create(userId, {
      activity: body.activity,
      title: body.title,
      description: body.description ?? null,
      location,
      startsAt: body.startsAt,
      durationMin: body.durationMin ?? null,
      capacity: body.capacity,
      genderPreference: body.genderPreference,
      tags: [...new Set(body.tags)],
      minSkillLevel: body.minSkillLevel ?? null,
    });
  }

  @Get('items/:id')
  @ApiOperation({ summary: '活动详情（不存在与不可见都是 404，不区分）' })
  detailItem(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.posts.detail(id, userId);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '更新活动（JSON Merge Patch：undefined 不动、null 清空）' })
  patchItem(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(patchPostSchema) body: z.infer<typeof patchPostSchema>,
  ) {
    if (body.tags !== undefined) {
      assertKnownTags(body.tags, 'tags');
      assertPostTagCount(body.tags);
    }
    const location = body.location === undefined ? undefined : assertKnownLocation(body.location);
    if (body.startsAt !== undefined) assertFutureStartsAt(body.startsAt);

    return this.posts.update(
      id,
      {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
        ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.genderPreference !== undefined ? { genderPreference: body.genderPreference } : {}),
        ...(body.tags !== undefined ? { tags: [...new Set(body.tags)] } : {}),
        ...(body.minSkillLevel !== undefined ? { minSkillLevel: body.minSkillLevel } : {}),
      },
      userId,
    );
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '取消活动（转 CANCELLED；动作名与状态名一一对应）' })
  async cancelItem(@CurrentUser() userId: string, @Param('id') id: string): Promise<{ id: string; status: string }> {
    const view = await this.posts.cancel(id, userId);
    return { id: view.id, status: view.status };
  }

  /* ---------------- 领域动作（9–12 + 12b） ---------------- */

  @Post('items/:id/join')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '申请加入（建 PENDING 申请；不占名额，名额在 decide 时递增）' })
  join(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(joinSchema) body: z.infer<typeof joinSchema>,
  ) {
    return this.applications.join(id, userId, body.message ?? null);
  }

  @Post('items/:id/leave')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '撤回申请（PENDING → WITHDRAWN）' })
  leave(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.applications.leave(id, userId);
  }

  @Post('items/:id/close')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '发起人关闭活动（OPEN/FULL → CLOSED）' })
  close(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.posts.close(id, userId);
  }

  @Post('items/:id/decide')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '发起人接受/拒绝申请（ACCEPTED 时递增 joinedCount）' })
  decide(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(decideSchema) body: z.infer<typeof decideSchema>,
  ) {
    return this.applications.decide(id, body.applicationId, userId, body.decision);
  }

  @Get('items/:id/applications')
  @ApiOperation({ summary: '某活动的申请列表（仅发起人；规格 §6.1 矩阵要求）' })
  listApplications(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.applications.listByPost(id, userId);
  }

  @Get('applications')
  @ApiOperation({ summary: '我的申请列表' })
  myApplications(@CurrentUser() userId: string) {
    return this.applications.listMine(userId);
  }

  /* ---------------- 推荐（14） ---------------- */

  @Get('recommendations')
  @ApiOperation({ summary: '主动推荐（响应必须带 matchMode，理由必须非空）' })
  recommendations(
    @CurrentUser() userId: string,
    @ZodQuery(recommendQuerySchema) query: z.infer<typeof recommendQuerySchema>,
  ) {
    const limit = normalizeRecommendLimit(query.limit);
    return this.recommend.recommend(userId, query.section as BuddySection, limit);
  }

  /* ---------------- 反馈（15） ---------------- */

  @Post('items/:id/feedback')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '提交 like/dislike/skip（UPSERT，按 section 隔离）' })
  submitFeedback(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(feedbackSchema) body: z.infer<typeof feedbackSchema>,
  ) {
    return this.feedback.submit(userId, id, body.section as BuddySection, body.action);
  }

  /* ---------------- 问卷（16–19） ---------------- */

  @Get('questionnaires')
  @ApiOperation({ summary: '问卷列表' })
  listQuestionnaires(@ZodQuery(questionnaireListQuerySchema) query: z.infer<typeof questionnaireListQuerySchema>) {
    return this.questionnaires.list(query.section as BuddySection | undefined);
  }

  @Get('questionnaires/:slug')
  @ApiOperation({ summary: '问卷详情' })
  questionnaireDetail(@Param('slug') slug: string) {
    return this.questionnaires.detail(slug);
  }

  @Post('questionnaires/:slug/responses')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: '提交答案（只把白名单键同步进匹配资料）' })
  submitQuestionnaire(
    @CurrentUser() userId: string,
    @Param('slug') slug: string,
    @ZodBody(questionnaireAnswersSchema) body: z.infer<typeof questionnaireAnswersSchema>,
  ) {
    return this.questionnaires.submit(slug, userId, body.answers);
  }

  @Get('questionnaires/:slug/responses/me')
  @ApiOperation({ summary: '我的答案' })
  myQuestionnaireResponse(@CurrentUser() userId: string, @Param('slug') slug: string) {
    return this.questionnaires.mine(slug, userId);
  }
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** `a,b,c` → `['a','b','c']`（去空去重）。规格 §5.3 的多值参数用逗号分隔。 */
function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

/**
 * 推荐条数上限。
 *
 * 规格 §5.7 说 1–50、默认 10 —— 与全局 `normalizeLimit` 的 1–100 不同，
 * 所以不能直接复用它（否则 `limit=100` 会被静默接受，偏离规格）。
 */
function normalizeRecommendLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 10;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ValidationError('limit 必须在 1–50 之间', { field: 'limit' });
  }
  return parsed;
}

/** 供 `modulePath` 之外的静态检查使用：确保常量与契约表一致 */
export const BUDDY_CONSTANTS = {
  sections: BUDDY_SECTIONS,
  activities: BUDDY_ACTIVITIES,
  skillLevels: SKILL_LEVELS,
  postStatuses: BUDDY_POST_STATUSES,
  /** `GET /items?status=` 的白名单（比冻结状态少一个刻意排除的 `EXPIRED`） */
  listablePostStatuses: LISTABLE_POST_STATUSES,
  applicationStatuses: BUDDY_APPLICATION_STATUSES,
  /** 契约 §11.2 冻结的 5 个 action 名（规格 §5.2） */
  actions: ['join', 'leave', 'close', 'decide', 'feedback'] as const,
};
