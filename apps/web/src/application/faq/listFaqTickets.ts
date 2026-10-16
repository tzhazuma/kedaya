/**
 * 用例：我的工单（列表 + 提交）。
 *
 * 隐私硬规则（契约 §2.8）：`contact` 是邮箱或微信，**不存明文手机号**；
 * 展示一律脱敏（`maskContact`），application 层负责把脱敏结果放进视图模型。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  FAQ_TICKET_STATUS_LABELS,
  maskContact,
  ticketNeedsReply,
  validateTicketContact,
  validateTicketDraft,
  type FaqTicket,
  type FaqTicketStatus,
} from '@/domain/models/faq';
import type { FaqRepository, SubmitFaqTicketInput } from '@/domain/ports/faq';

import { deriveViewState, type ViewState } from '../viewState';

export interface FaqTicketVM {
  id: string;
  /** 已脱敏的联系方式（邮箱保留首字符与域名） */
  contactMasked: string;
  question: string;
  questionExcerpt: string;
  status: FaqTicketStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  createdLabel: string;
  updatedLabel: string;
  answer: string | null;
  answeredLabel: string | null;
  /** 已回复待确认（可追问） */
  needsReply: boolean;
  /** 未登录提交的工单（契约允许 userId 为 null） */
  guest: boolean;
}

export interface FaqTicketListVM {
  items: FaqTicketVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  openCount: number;
  emptyHint: string;
  state: ViewState;
}

const TICKET_STATUS_TONES: Record<FaqTicketStatus, FaqTicketVM['statusTone']> = {
  OPEN: 'info',
  ANSWERED: 'success',
  CLOSED: 'neutral',
};

export function toFaqTicketVM(ticket: FaqTicket, now: Date): FaqTicketVM {
  return {
    id: ticket.id,
    contactMasked: maskContact(ticket.contact),
    question: ticket.question,
    questionExcerpt: ticket.question.length > 80 ? `${ticket.question.slice(0, 80)}…` : ticket.question,
    status: ticket.status,
    statusLabel: FAQ_TICKET_STATUS_LABELS[ticket.status],
    statusTone: TICKET_STATUS_TONES[ticket.status],
    createdLabel: formatRelativeTime(ticket.createdAt, now) || '时间未知',
    updatedLabel: formatRelativeTime(ticket.updatedAt, now) || '时间未知',
    answer: ticket.answer ?? null,
    answeredLabel: ticket.answeredAt
      ? formatRelativeTime(ticket.answeredAt, now) || null
      : null,
    needsReply: ticketNeedsReply(ticket),
    guest: ticket.userId === null,
  };
}

export function toFaqTicketListVM(
  page: Page<FaqTicket>,
  now: Date,
  state?: ViewState,
): FaqTicketListVM {
  const items = page.items.map((ticket) => toFaqTicketVM(ticket, now));
  return {
    items,
    nextCursor: page.nextCursor,
    total: page.total ?? page.items.length,
    isEmpty: items.length === 0,
    openCount: items.filter((item) => item.status === 'OPEN').length,
    emptyHint:
      '还没有工单。如果知识库里没有答案，可以在这里提交问题 —— 填写邮箱或微信号即可，无需登录；我们不会保存明文手机号。',
    state: state ?? deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

export async function loadFaqTickets(
  repository: FaqRepository,
  options: { status?: FaqTicketStatus; now?: Date; limit?: number } = {},
): Promise<Result<FaqTicketListVM, ApiError>> {
  const result = await repository.listTickets({
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  if (!result.ok) return err(result.error);
  return ok(toFaqTicketListVM(result.value, options.now ?? new Date()));
}

export interface FaqTicketDraft {
  contact: string;
  question: string;
}

export function createEmptyTicketDraft(): FaqTicketDraft {
  return { contact: '', question: '' };
}

/** 草稿校验：返回阻断项（与后端同一套规则，前端只是预校验） */
export function validateFaqTicketDraft(draft: FaqTicketDraft): string[] {
  return validateTicketDraft({ contact: draft.contact, question: draft.question });
}

export interface SubmitFaqTicketOptions {
  /** 未登录传 null（契约 §2.8：未登录也可提交） */
  userId?: string | null;
  now?: Date;
  idempotencyKey?: string;
}

/** 用例入口：校验 → 提交 → 返回视图模型 */
export async function submitFaqTicket(
  repository: FaqRepository,
  draft: FaqTicketDraft,
  options: SubmitFaqTicketOptions = {},
): Promise<Result<FaqTicketVM, ApiError>> {
  const problems = validateFaqTicketDraft(draft);
  if (problems.length > 0) {
    return err({
      code: 'VALIDATION_FAILED',
      message: problems[0] ?? '工单内容不合法',
      details: { problems },
    });
  }

  const input: SubmitFaqTicketInput = {
    contact: validateTicketContact(draft.contact).contact,
    question: draft.question.trim(),
    userId: options.userId ?? null,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  };

  const result = await repository.submitTicket(input);
  if (!result.ok) return err(result.error);
  return ok(toFaqTicketVM(result.value, options.now ?? new Date()));
}

export function faqTicketState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}
