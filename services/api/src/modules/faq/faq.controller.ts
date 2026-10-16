/**
 * 常见问题 · faq —— 控制器（契约 §6.1 / §11.1 / §11.3）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/faq.domain.ts 顶部）。
 *
 * 路由一览（都在 `/api/v1/faq` 下）：
 *   GET    /items?category=&q=      条目列表（分类过滤 + 关键词搜索 + 游标分页）
 *   POST   /items                   新建条目（faq_staff）
 *   GET    /items/:id               条目详情
 *   PATCH  /items/:id               编辑条目（faq_staff；JSON Merge Patch）
 *   DELETE /items/:id               删除条目（faq_staff）
 *   POST   /items/:id/helpful       标记有用（幂等：同一用户只算一次）
 *   GET    /suggestions?q=          关键词建议（公开）
 *   POST   /tickets                 提交工单（可未登录；返回 FAQ 建议）
 *   GET    /tickets                 我的工单（游标分页）
 *   GET    /tickets/:id             工单详情（本人或 staff）
 *   PATCH  /tickets/:id             工单状态流转（staff 回复 / 提问者关闭 / 追问）
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IDEMPOTENCY_HEADER, modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { FaqService, FAQ_QUESTION_MAX, FAQ_SUGGESTION_LIMIT } from './faq.service';
import {
  FAQ_TICKET_STATUSES,
  FAQ_VOTE_VALUES,
  type PatchFaqTicketCommand,
  type SubmitFaqTicketCommand,
} from './domain/faq.domain';

const createEntrySchema = z.object({
  slug: z.string().min(1).max(96).optional(),
  question: z.string().min(1).max(120),
  answer: z.string().min(1).max(10000),
  category: z.string().min(1).max(60),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

/**
 * 投票请求体。
 * 契约 wire 形状是 `{ value: 'helpful' }`（Lead v1.2 裁决），
 * 但 Web 客户端发的是 `{ vote: ... }` —— 两个键都收，避免客户端二选一。
 */
const voteSchema = z.object({
  value: z.enum(FAQ_VOTE_VALUES).optional(),
  vote: z.enum(FAQ_VOTE_VALUES).optional(),
});

const patchEntrySchema = createEntrySchema.partial();

const submitTicketSchema = z.object({
  contact: z.string().min(1).max(120),
  question: z.string().min(1).max(FAQ_QUESTION_MAX),
});

const patchTicketSchema = z.object({
  status: z.enum(FAQ_TICKET_STATUSES).nullish(),
  answer: z.string().min(1).max(5000).nullish(),
});

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容用例层声明的命令类型。
 */
// 注意：`_Actual` 用下划线前缀，满足 eslint 的 no-unused-vars 允许名单
// （生成的 19 个模块用的是 `Actual`，因此全仓 lint 目前有 22 条既有告警）。
type AssertAssignable<Target, _Actual extends Target> = true;
export type SubmitTicketSchemaMatchesDomain = AssertAssignable<
  SubmitFaqTicketCommand,
  z.infer<typeof submitTicketSchema>
>;
export type PatchTicketSchemaMatchesDomain = AssertAssignable<
  PatchFaqTicketCommand,
  z.infer<typeof patchTicketSchema>
>;

@ApiTags('faq · 常见问题')
@Controller(modulePath('faq'))
@UseGuards(OptionalAuthGuard)
@UseInterceptors(IdempotencyInterceptor)
export class FaqController {
  constructor(@Inject(FaqService) private readonly service: FaqService) {}


  /* ---------------- 条目 ---------------- */

  @Get('items')
  @ApiOperation({ summary: '条目列表（category 过滤 + keyword 搜索 + 游标分页）' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.searchEntries({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      category: readString(query.category),
      // wire 契约：keyword。`q` 作为兼容别名保留。
      keyword: readString(query.keyword) ?? readString(query.q),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '新建 FAQ 条目（需要 faq_staff 角色）' })
  create(@CurrentUser() actorId: string, @ZodBody(createEntrySchema) body: z.infer<typeof createEntrySchema>) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '条目详情（接受 id 或 slug）' })
  detail(@Param('id') id: string) {
    return this.service.entryDetail(id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑条目（faq_staff；JSON Merge Patch）' })
  update(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(patchEntrySchema) body: z.infer<typeof patchEntrySchema>,
  ) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除条目（faq_staff）' })
  async remove(@CurrentUser() actorId: string, @Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Post('items/:id/votes')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '投票（主路由；幂等：同一用户对同一条目只有一票）' })
  vote(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(voteSchema) body: z.infer<typeof voteSchema>,
  ) {
    return this.service.vote(id, body.value ?? body.vote, actorId);
  }

  /**
   * 兼容别名：任务书原文写的是 `POST /faq/items/:id/helpful`。
   * 语义等价于 `{ value: 'helpful' }` 的投票；保留以免破坏既有调用方。
   */
  @Post('items/:id/helpful')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '标记有用（兼容别名，等价于 POST /items/:id/votes {value:"helpful"}）' })
  markHelpful(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.vote(id, 'helpful', actorId);
  }

  @Get('suggestions')
  @ApiOperation({ summary: '关键词建议（公开，无需登录；简单关键词匹配，非向量检索）' })
  suggestions(@Query() query: Record<string, unknown>) {
    // wire 契约是 `keyword`；`q` 是兼容别名
    return this.service.suggest(readString(query.keyword) ?? readString(query.q) ?? '', FAQ_SUGGESTION_LIMIT);
  }

  /* ---------------- 工单 ---------------- */

  @Post('tickets')
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true, description: '契约 §11.3：POST 必需' })
  @ApiOperation({ summary: '提交工单（未登录也可；返回相关 FAQ 建议）' })
  submitTicket(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(submitTicketSchema) body: SubmitFaqTicketCommand,
  ) {
    return this.service.submitTicket(body, actorId);
  }

  @Get('tickets')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的工单（游标分页）' })
  listMyTickets(@CurrentUser() actorId: string, @Query() query: Record<string, unknown>) {
    return this.service.listMyTickets({ cursor: readCursor(query), limit: normalizeLimit(query.limit) }, actorId);
  }

  @Get('tickets/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '工单详情（本人或 staff）' })
  ticketDetail(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.ticketDetail(id, actorId);
  }

  @Patch('tickets/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '工单状态流转（staff 回复 / 提问者关闭 / 追问）' })
  patchTicket(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(patchTicketSchema) body: PatchFaqTicketCommand,
  ) {
    return this.service.patchTicket(id, body, actorId);
  }
}

/** 取一个非空字符串查询参数 */
function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}
