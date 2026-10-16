/**
 * 常见问题 · faq —— 用例层（契约 §7：只编排，不含 IO）
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/faq.domain.ts 顶部）。
 *
 * 覆盖的用例：条目检索（分类 + 关键词）/ 幂等「有用」/ 工单提交（带 FAQ 建议）/
 * 我的工单 / 工单状态流转（管理员回复、提问者关闭、追问）。
 *
 * 权限约定（如实声明，未决项见交付说明）：
 *   · 条目**写**操作（增改删）需要 `faq_staff` 角色（环境变量 `FAQ_STAFF_USER_IDS`）；
 *   · 「有用」投票需要登录 —— 幂等键是 userId，匿名投票需要契约先给出设备级身份；
 *   · 工单提交允许未登录（`userId=null`），但未登录工单只能由 staff 跟进。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from '@kedaya/contracts';
import { containsLikelyPii, slugify } from '@kedaya/shared';
import { ROLE_PORT, type RolePort } from '../../common/auth/role.port';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
import { ulid } from '../../common/ids/ulid';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  FAQ_ENTRY_REPOSITORY,
  FAQ_MODULE_ID,
  FAQ_TICKET_REPOSITORY,
  canTransitionFaqTicket,
  isFaqTicketStatus,
  normalizeContact,
  normalizeFaqEntryStatus,
  normalizeVote,
  rankFaqSuggestions,
  voterKeyFor,
  type CreateFaqEntryInput,
  type FaqEntryListFilter,
  type FaqEntryModel,
  type FaqEntryRepository,
  type FaqSuggestion,
  type FaqTicketModel,
  type FaqTicketRepository,
  type FaqTicketStatus,
  type FaqVoteValue,
  type PatchFaqTicketCommand,
  type SubmitFaqTicketCommand,
  type UpdateFaqEntryInput,
  type UpdateFaqTicketInput,
} from './domain/faq.domain';

export const FAQ_QUESTION_MAX = 2000;
export const FAQ_SUGGESTION_LIMIT = 3;

/** 提交工单的返回：工单本体 + 未命中时给出的 FAQ 建议 */
export type FaqTicketWithSuggestions = FaqTicketView & {
  suggestions: FaqEntryView[];
  piiWarning: boolean;
};

/**
 * 条目对外 DTO（wire 形状 = OpenAPI + 三端客户端）：
 * `slug` / `status`（大写）/ `helpfulCount` / `unhelpfulCount` / `updatedAt`。
 */
export interface FaqEntryView {
  id: string;
  slug: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  status: string;
  helpfulCount: number;
  unhelpfulCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 投票动作的返回：更新后的条目 + 幂等/改票标记 */
export interface VoteResult extends FaqEntryView {
  /** false = 这次是重复投同一票（幂等命中，计数不变） */
  counted: boolean;
  /** true = 这次是改票（helpful ⇄ unhelpful），两边计数已同步调整 */
  changed: boolean;
}

/** 工单对外 DTO：可空字段在为空时**省略**（客户端 schema 是 `z.string().optional()`） */
export type FaqTicketView = Omit<FaqTicketModel, 'answer' | 'answeredAt' | 'closedAt'> &
  Partial<Pick<FaqTicketModel, 'answer' | 'answeredAt' | 'closedAt'>>;

@Injectable()
export class FaqService extends CrudService<FaqEntryModel, CreateFaqEntryInput, UpdateFaqEntryInput> {
  constructor(
    @Inject(FAQ_ENTRY_REPOSITORY) private readonly entries: FaqEntryRepository,
    @Inject(FAQ_TICKET_REPOSITORY) private readonly tickets: FaqTicketRepository,
    @Inject(ROLE_PORT) private readonly roles: RolePort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super(entries, FAQ_MODULE_ID, '常见问题条目');
  }

  /* ================= 条目 ================= */

  /** `GET /faq/items`：分类过滤 + 关键词搜索 + 游标分页 */
  async searchEntries(filter: FaqEntryListFilter): Promise<Page<FaqEntryView>> {
    const page = await this.entries.searchEntries(filter);
    return { items: page.items.map((row) => this.toEntryView(row)), nextCursor: page.nextCursor };
  }

  /** 条目详情（按 id 或 slug） */
  async entryDetail(idOrSlug: string): Promise<FaqEntryView> {
    const entry = await this.entries.findEntryByIdOrSlug(idOrSlug);
    if (!entry) throw new NotFoundError('常见问题条目不存在或已被删除');
    return this.toEntryView(entry);
  }

  /** 条目创建（编辑内容，需要 faq_staff） */
  async createEntry(input: CreateFaqEntryInput, actorId?: string): Promise<FaqEntryView> {
    const actor = this.requireActor(actorId);
    await this.requireStaff(actor);
    const created = await super.create(this.normalizeEntry(input));
    return this.toEntryView(created);
  }

  /** CrudService.create 的重写：收敛到 createEntry（保持继承签名的类型兼容） */
  override async create(input: CreateFaqEntryInput, actorId?: string): Promise<FaqEntryModel> {
    return (await this.createEntry(input, actorId)) as unknown as FaqEntryModel;
  }

  override async update(id: string, input: UpdateFaqEntryInput, actorId?: string): Promise<FaqEntryModel> {
    const actor = this.requireActor(actorId);
    await this.requireStaff(actor);
    const existing = await this.entries.findEntryByIdOrSlug(id);
    if (!existing) throw new NotFoundError('常见问题条目不存在或已被删除');

    const normalized: UpdateFaqEntryInput = {};
    if (input.question !== undefined) normalized.question = this.normalizeText(input.question, 120, 'question');
    if (input.answer !== undefined) normalized.answer = this.normalizeText(input.answer, 10000, 'answer');
    if (input.category !== undefined) normalized.category = this.normalizeText(input.category, 60, 'category');
    if (input.tags !== undefined) normalized.tags = this.normalizeTags(input.tags);
    if (input.status !== undefined) {
      const status = normalizeFaqEntryStatus(input.status);
      if (!status) throw new ValidationError('status 只能是 DRAFT / PUBLISHED / ARCHIVED', { field: 'status' });
      normalized.status = status;
    }
    if (Object.keys(normalized).length === 0) throw new ValidationError('PATCH 请求体没有可修改的字段');
    return this.entries.update(existing.id, normalized);
  }

  override async remove(id: string, actorId?: string): Promise<void> {
    const actor = this.requireActor(actorId);
    await this.requireStaff(actor);
    const existing = await this.entries.findEntryByIdOrSlug(id);
    if (!existing) throw new NotFoundError('常见问题条目不存在或已被删除');
    await this.entries.remove(existing.id);
  }

  /**
   * 投票（主路由 `POST /faq/items/:id/votes`，`/helpful` 是保留的兼容别名）。
   *
   * 幂等：同一用户对同一条目只有一票 —— 重复投同一票不改计数（`counted:false`），
   * 改票则两边计数同步调整（`changed:true`）。由唯一约束保证，不靠先查后写。
   */
  async vote(idOrSlug: string, rawVote: unknown, actorId?: string): Promise<VoteResult> {
    const actor = this.requireActor(actorId);
    const vote: FaqVoteValue = normalizeVote(rawVote) ?? 'helpful';
    const entry = await this.entries.findEntryByIdOrSlug(idOrSlug);
    if (!entry) throw new NotFoundError('常见问题条目不存在或已被删除');

    const result = await this.entries.castVote(entry.id, voterKeyFor(actor), vote);
    return { ...this.toEntryView(result.entry), counted: result.counted, changed: result.changed };
  }

  /* ================= 工单 ================= */

  /**
   * `POST /faq/tickets` —— 工单式自助答疑。
   * 未命中（或命中很少）时返回**相关 FAQ 建议**，让用户先自助解决。
   */
  async submitTicket(command: SubmitFaqTicketCommand, actorId?: string): Promise<FaqTicketWithSuggestions> {
    const contact = normalizeContact(command.contact);
    const question = this.normalizeText(command.question, FAQ_QUESTION_MAX, 'question');

    const suggestions = await this.suggest(question);
    const ticket = await this.tickets.createTicket({
      userId: actorId ?? null,
      contact,
      question,
      suggestedEntryIds: suggestions.map((item) => item.entry.id),
    });

    return {
      ...this.toTicketView(ticket),
      suggestions: suggestions.map((item) => this.toEntryView(item.entry)),
      piiWarning: containsLikelyPii(question),
    };
  }

  /** `GET /faq/suggestions?q=` —— 公开的建议接口（无需登录） */
  async suggest(query: string, limit = FAQ_SUGGESTION_LIMIT): Promise<Array<FaqSuggestion<FaqEntryModel>>> {
    const keyword = (query ?? '').trim();
    if (!keyword) return [];
    const page = await this.entries.searchEntries({ limit: 50, keyword });
    return rankFaqSuggestions(keyword, page.items, limit);
  }

  /** `GET /faq/tickets` —— 我的工单（游标分页） */
  async listMyTickets(params: ListParams, actorId?: string): Promise<Page<FaqTicketView>> {
    const actor = this.requireActor(actorId);
    const page = await this.tickets.listTickets({ userId: actor, ...params });
    return { items: page.items.map((row) => this.toTicketView(row)), nextCursor: page.nextCursor };
  }

  /** `GET /faq/tickets/:id` —— 工单详情（本人或 staff） */
  async ticketDetail(id: string, actorId?: string): Promise<FaqTicketView> {
    const actor = this.requireActor(actorId);
    const ticket = await this.tickets.findTicketById(id);
    if (!ticket) throw new NotFoundError('工单不存在');
    if (ticket.userId !== actor && !(await this.isStaff(actor))) {
      // 不确认他人工单是否存在
      throw new NotFoundError('工单不存在');
    }
    return this.toTicketView(ticket);
  }

  /**
   * `PATCH /faq/tickets/:id` —— 状态流转（JSON Merge Patch，契约 §11.1）。
   *   · staff 回复：`{answer}` → 自动推进为 ANSWERED（也可显式传 status）
   *   · 提问者关闭：`{status:'CLOSED'}`（仅从 ANSWERED）
   *   · 追问：`{status:'OPEN'}`（ANSWERED → OPEN）
   */
  async patchTicket(id: string, patch: PatchFaqTicketCommand, actorId?: string): Promise<FaqTicketView> {
    const actor = this.requireActor(actorId);
    const ticket = await this.tickets.findTicketById(id);
    if (!ticket) throw new NotFoundError('工单不存在');

    const isStaff = await this.isStaff(actor);
    const isOwner = ticket.userId === actor;
    if (!isStaff && !isOwner) throw new NotFoundError('工单不存在');

    const data: UpdateFaqTicketInput = {};
    const from = ticket.status as FaqTicketStatus;

    if ('answer' in patch) {
      if (!isStaff) throw new ForbiddenError('只有 staff 可以回复工单');
      if (patch.answer === null) throw new ValidationError('answer 不能清空', { field: 'answer' });
      data.answer = this.normalizeText(patch.answer, 5000, 'answer');
      // 回复即视为已答复；若同一请求显式给了 status，下面以显式值优先
      if (patch.status === undefined || patch.status === null) {
        data.status = 'ANSWERED';
        data.answeredAt = new Date();
      }
    }

    if (patch.status !== undefined && patch.status !== null) {
      if (!isFaqTicketStatus(patch.status)) {
        throw new ValidationError('status 不是合法的工单状态', { field: 'status' });
      }
      const next = patch.status;
      if (!canTransitionFaqTicket(from, next)) {
        throw new ConflictError(`工单状态不能从 ${from} 变为 ${next}`, { from, to: next });
      }
      if (next === 'ANSWERED') {
        if (!isStaff) throw new ForbiddenError('只有 staff 可以把工单标记为已答复');
        if (!data.answer && !ticket.answer) {
          throw new ValidationError('标记已答复时必须给出 answer', { field: 'answer' });
        }
        data.answeredAt = data.answeredAt ?? new Date();
      }
      if (next === 'CLOSED') data.closedAt = new Date();
      if (next === 'OPEN') {
        // 追问：回到待答复，清掉关闭时间（answer 保留作为历史）
        data.closedAt = null;
      }
      data.status = next;
    }

    if (Object.keys(data).length === 0) throw new ValidationError('PATCH 请求体没有可修改的字段');
    return this.toTicketView(await this.tickets.updateTicket(id, data));
  }

  /* ================= 内部工具 ================= */

  private requireActor(actorId?: string): string {
    if (!actorId) throw new UnauthenticatedError('该操作需要先登录上科大统一身份认证');
    return actorId;
  }

  private async isStaff(actorId: string): Promise<boolean> {
    return this.roles.hasRole(actorId, 'faq_staff');
  }

  private async requireStaff(actorId: string): Promise<void> {
    if (!(await this.isStaff(actorId))) {
      throw new ForbiddenError('该操作需要 faq_staff 角色（环境变量 FAQ_STAFF_USER_IDS）');
    }
  }

  private normalizeEntry(input: CreateFaqEntryInput): CreateFaqEntryInput {
    const question = this.normalizeText(input.question, 120, 'question');
    const status = input.status ? normalizeFaqEntryStatus(input.status) : 'PUBLISHED';
    if (!status) throw new ValidationError('status 只能是 DRAFT / PUBLISHED / ARCHIVED', { field: 'status' });
    return {
      // slug 是 wire 上的业务键（客户端按 slug 投票）：中文问题 slugify 会退化，用 ULID 兜底
      slug: (input.slug?.trim() || slugify(question) || ulid().toLowerCase()).slice(0, 96),
      question,
      answer: this.normalizeText(input.answer, 10000, 'answer'),
      category: this.normalizeText(input.category, 60, 'category'),
      tags: this.normalizeTags(input.tags),
      status,
      // 计数一律从 0 起，防止客户端伪造热度
    };
  }

  /** 条目 DTO：wire 形状（slug / 大写 status / 两个计数） */
  private toEntryView(row: FaqEntryModel): FaqEntryView {
    return {
      id: row.id,
      slug: row.slug,
      question: row.question,
      answer: row.answer,
      category: row.category,
      tags: row.tags,
      status: row.status,
      helpfulCount: row.helpfulCount,
      unhelpfulCount: row.unhelpfulCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 工单 DTO：可空字段为空时省略（客户端 schema 是 optional 而非 nullable） */
  private toTicketView(row: FaqTicketModel): FaqTicketView {
    return {
      id: row.id,
      userId: row.userId,
      contact: row.contact,
      question: row.question,
      status: row.status,
      suggestedEntryIds: row.suggestedEntryIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.answer ? { answer: row.answer } : {}),
      ...(row.answeredAt ? { answeredAt: row.answeredAt } : {}),
      ...(row.closedAt ? { closedAt: row.closedAt } : {}),
    };
  }

  private normalizeText(raw: string | null | undefined, max: number, field: string): string {
    const value = (raw ?? '').trim();
    if (value.length < 1 || value.length > max) {
      throw new ValidationError(`${field} 长度必须在 1–${max} 字之间`, { field });
    }
    return value;
  }

  private normalizeTags(raw: string[] | null | undefined): string[] {
    if (!raw) return [];
    if (raw.length > 10) throw new ValidationError('标签最多 10 个', { field: 'tags' });
    return [...new Set(raw.map((tag) => tag.trim()).filter(Boolean))].map((tag) => tag.slice(0, 32));
  }
}
