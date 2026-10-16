/**
 * 论坛 · forum —— 控制器（契约 §6.1 路由形状 / §11.1 PATCH / §11.2 action / §11.3 幂等）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/forum.domain.ts 顶部）。
 *
 * 路由一览（都在 `/api/v1/forum` 下）：
 *   GET    /boards                     版块列表（游标分页）
 *   POST   /boards                     新建版块（版主）
 *   GET    /items?board=&q=&status=    主题列表（游标分页 + 版块过滤 + 搜索）
 *   POST   /items                      发帖（可匿名）
 *   GET    /items/:id                  详情（含 replyCount）
 *   PATCH  /items/:id                  编辑 / 状态流转（JSON Merge Patch）
 *   DELETE /items/:id                  软删除
 *   POST   /items/:id/replies          回复（可匿名）
 *   GET    /items/:id/replies          回复列表（游标分页）
 *   POST   /items/:id/report           举报（契约 §11.2 冻结的 action 名）
 *   GET    /reports                    举报队列（版主）
 *   PATCH  /reports/:id                举报裁决（版主）
 *
 * 注意：**没有**自创 `hide` / `restore` 这类 action 名 ——
 * 契约 §11.2 规定新 action 必须同时登记进契约表与 OpenAPI，
 * 而契约文件是 Lead 独占的。因此版主隐藏/恢复走已冻结的
 * `PATCH /items/:id` + 状态机（见 forum.service.patchPost）。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IDEMPOTENCY_HEADER, modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { ValidationError } from '../../common/errors/app-error';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { ForumService, FORUM_BODY_MAX, FORUM_REPLY_BODY_MAX, FORUM_TAGS_MAX, FORUM_TAG_MAX, FORUM_TITLE_MAX } from './forum.service';
import {
  FORUM_REPORT_STATUSES,
  normalizePostStatus,
  type CreateForumBoardInput,
  type CreateForumPostCommand,
  type CreateForumReplyCommand,
  type ForumPostStatus,
  type UpdateForumPostCommand,
} from './domain/forum.domain';

/* ===================== Zod 入参（全站唯一校验入口） ===================== */

const createPostSchema = z.object({
  /** 02-domain-model §2.4 的字段名（→ ForumBoard.id；也接受 slug） */
  boardId: z.string().min(1).max(64).optional(),
  /** 兼容别名（骨架期生成物用过 `board`） */
  board: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(FORUM_TITLE_MAX),
  body: z.string().min(1).max(FORUM_BODY_MAX),
  tags: z.array(z.string().min(1).max(FORUM_TAG_MAX)).max(FORUM_TAGS_MAX).optional(),
  /** 匿名：对外不显示实名，但仍需登录（见 service 注释） */
  anonymous: z.boolean().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

const patchPostSchema = z.object({
  title: z.string().min(1).max(FORUM_TITLE_MAX).nullish(),
  body: z.string().min(1).max(FORUM_BODY_MAX).nullish(),
  /** 状态机校验在 service（这里只收窄形状，合法值由 domain 判定） */
  status: z.string().min(1).max(32).nullish(),
  tags: z.array(z.string().min(1).max(FORUM_TAG_MAX)).max(FORUM_TAGS_MAX).nullish(),
  pinnedAt: z.coerce.date().nullish(),
});

const createReplySchema = z.object({
  body: z.string().min(1).max(FORUM_REPLY_BODY_MAX),
  parentReplyId: z.string().min(1).max(64).nullish(),
  anonymous: z.boolean().optional(),
});

const reportSchema = z.object({
  /**
   * 刻意用 `z.string()` 而不是 `z.enum()`：
   * 举报原因要接受旧写法 `privacy` 并归一化为 `pii`（见 domain 的
   * `normalizeReportReason`），枚举收窄放在 service，错误码才统一是 VALIDATION_FAILED。
   */
  reason: z.string().min(1).max(32),
  detail: z.string().max(2000).nullish(),
  anonymous: z.boolean().optional(),
});

const createBoardSchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(30),
  description: z.string().max(200).nullish(),
  visibility: z.enum(['public', 'campus_only']).optional(),
});

const reportStatusSchema = z.object({
  status: z.enum(FORUM_REPORT_STATUSES),
});

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
// 注意：`_Actual` 用下划线前缀，满足 eslint 的 no-unused-vars 允许名单
// （生成的 19 个模块用的是 `Actual`，因此全仓 lint 目前有 22 条既有告警）。
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreatePostSchemaMatchesDomain = AssertAssignable<CreateForumPostCommand, z.infer<typeof createPostSchema>>;
export type PatchPostSchemaMatchesDomain = AssertAssignable<UpdateForumPostCommand, z.infer<typeof patchPostSchema>>;
export type CreateReplySchemaMatchesDomain = AssertAssignable<
  CreateForumReplyCommand,
  z.infer<typeof createReplySchema>
>;
export type CreateBoardSchemaMatchesDomain = AssertAssignable<
  CreateForumBoardInput,
  z.infer<typeof createBoardSchema>
>;

/* ===================== 控制器 ===================== */

@ApiTags('forum · 论坛')
@Controller(modulePath('forum'))
@UseGuards(OptionalAuthGuard)
@UseInterceptors(IdempotencyInterceptor)
export class ForumController {
  constructor(@Inject(ForumService) private readonly service: ForumService) {}

  /* ---------------- 版块 ---------------- */

  @Get('boards')
  @ApiOperation({ summary: '版块列表（游标分页）' })
  listBoards(@Query() query: Record<string, unknown>) {
    return this.service.listBoards({ cursor: readCursor(query), limit: normalizeLimit(query.limit) });
  }

  @Post('boards')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '新建版块（需要 forum_moderator 角色）' })
  createBoard(@CurrentUser() actorId: string, @ZodBody(createBoardSchema) body: CreateForumBoardInput) {
    return this.service.createBoard(body, actorId);
  }

  /* ---------------- 主题 ---------------- */

  @Get('items')
  @ApiOperation({ summary: '主题列表（游标分页；boardId / keyword / status 过滤）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.listPosts({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      // wire 契约：boardId（OpenAPI）。`board` 作为兼容别名保留。
      boardId: readString(query.boardId) ?? readString(query.board),
      // wire 契约：keyword。`q` 作为兼容别名保留。
      keyword: readString(query.keyword) ?? readString(query.q),
      status: parseStatusFilter(query.status),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '发帖（anonymous=true 时实名身份不落库，契约 §9）' })
  create(@CurrentUser() actorId: string, @ZodBody(createPostSchema) body: CreateForumPostCommand) {
    return this.service.createPost(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '主题详情（含 replyCount；隐藏主题仅作者/版主可见）' })
  detail(@OptionalCurrentUser() viewerId: string | undefined, @Param('id') id: string) {
    return this.service.detailView(id, viewerId);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑主题 / 状态流转（JSON Merge Patch；锁定·隐藏·恢复需版主）' })
  patch(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(patchPostSchema) body: UpdateForumPostCommand,
  ) {
    return this.service.patchPost(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除主题（作者本人或版主）' })
  async remove(@CurrentUser() actorId: string, @Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  /* ---------------- 回复 ---------------- */

  @Post('items/:id/replies')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '回复主题（可匿名；锁定/隐藏的主题拒绝回复）' })
  createReply(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(createReplySchema) body: CreateForumReplyCommand,
  ) {
    return this.service.createReply(id, body, actorId);
  }

  @Get('items/:id/replies')
  @ApiOperation({ summary: '回复列表（游标分页；版主可见被隐藏的回复）' })
  listReplies(
    @OptionalCurrentUser() viewerId: string | undefined,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.listReplies(id, { cursor: readCursor(query), limit: normalizeLimit(query.limit) }, viewerId);
  }

  /* ---------------- 举报与治理 ---------------- */

  @Post('items/:id/report')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '举报主题（契约 §11.2 冻结 action：report）' })
  report(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(reportSchema) body: z.infer<typeof reportSchema>,
  ) {
    return this.service.reportPost(id, body, actorId);
  }

  @Get('reports')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '举报队列（版主）' })
  listReports(@CurrentUser() actorId: string, @Query() query: Record<string, unknown>) {
    return this.service.listReports(
      {
        cursor: readCursor(query),
        limit: normalizeLimit(query.limit),
        targetId: typeof query.targetId === 'string' && query.targetId ? query.targetId : undefined,
        status: parseReportStatus(query.status),
      },
      actorId,
    );
  }

  @Patch('reports/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '举报裁决（版主）：PENDING → UPHELD / DISMISSED' })
  patchReport(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(reportStatusSchema) body: z.infer<typeof reportStatusSchema>,
  ) {
    return this.service.setReportStatus(id, body.status, actorId);
  }
}

/* ===================== 查询参数解析 ===================== */

/** 取一个非空字符串查询参数（其余类型一律视为未提供） */
function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/**
 * `?status=PUBLISHED,LOCKED`（大写 canonical）。
 * 小写输入也接受（骨架期客户端可能发小写）；非法值抛 VALIDATION_FAILED。
 */
export function parseStatusFilter(raw: unknown): ForumPostStatus | ForumPostStatus[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new ValidationError('status 必须是字符串', { status: raw });
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const normalized: ForumPostStatus[] = [];
  for (const part of parts) {
    const status = normalizePostStatus(part);
    if (!status) throw new ValidationError('status 不是合法的论坛主题状态', { status: raw });
    normalized.push(status);
  }
  return normalized.length === 1 ? normalized[0] : normalized;
}

function parseReportStatus(raw: unknown): (typeof FORUM_REPORT_STATUSES)[number] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !(FORUM_REPORT_STATUSES as readonly string[]).includes(raw)) {
    throw new ValidationError('status 不是合法的举报状态', { status: raw });
  }
  return raw as (typeof FORUM_REPORT_STATUSES)[number];
}
