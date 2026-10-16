/**
 * 用例：举报（主题 / 回复）与发表回复。
 *
 * 举报走的是**已冻结的领域动作** `POST /api/v1/forum/items/:id/report`（契约 §11.2），
 * 客户端不得自创 action 名。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  FORUM_REPORT_REASON_LABELS,
  FORUM_REPORT_STATUS_LABELS,
  FORUM_REPORT_TARGET_LABELS,
  REPORT_AUTO_HIDE_THRESHOLD,
  validateForumReplyDraft,
  type ForumReport,
  type ForumReportReason,
  type ForumReportTargetType,
  type ForumReply,
} from '@/domain/models/forum';
import type { ForumRepository } from '@/domain/ports/forum';

import { toForumReplyVM, type ForumReplyVM } from './getForumPostDetail';
import type { ForumSession } from './session';

/* ------------------------------------------------------------------ *
 * 举报
 * ------------------------------------------------------------------ */

export interface ForumReportReasonOption {
  value: ForumReportReason;
  label: string;
  description: string;
}

const REASON_DESCRIPTIONS: Record<ForumReportReason, string> = {
  spam: '广告、刷屏、无意义重复内容',
  abuse: '辱骂、人身攻击、歧视',
  illegal: '违法违规或涉及危险行为',
  privacy: '泄露他人姓名、学号、手机号等隐私',
  other: '以上都不是，我来补充说明',
};

/** 举报原因选项（顺序即展示顺序） */
export const FORUM_REPORT_REASON_OPTIONS: readonly ForumReportReasonOption[] = (
  ['spam', 'abuse', 'illegal', 'privacy', 'other'] as const
).map((value) => ({
  value,
  label: FORUM_REPORT_REASON_LABELS[value],
  description: REASON_DESCRIPTIONS[value],
}));

/** 治理阈值文案（让用户知道举报不是"提交即隐藏"） */
export const REPORT_THRESHOLD_NOTICE = `同一内容被 ${REPORT_AUTO_HIDE_THRESHOLD} 个不同用户举报后会先自动隐藏并进入人工复核队列；举报不成立时内容会恢复。`;

export interface ReportForumTargetCommand {
  targetType: ForumReportTargetType;
  targetId: string;
  reason: ForumReportReason;
  note?: string;
}

export interface ForumReportReceiptVM {
  id: string;
  targetLabel: string;
  reasonLabel: string;
  statusLabel: string;
  createdAtLabel: string;
  /** 提交成功后的确认文案 */
  receiptText: string;
  anonymous: boolean;
}

export function toForumReportReceiptVM(report: ForumReport, now: Date): ForumReportReceiptVM {
  return {
    id: report.id,
    targetLabel: FORUM_REPORT_TARGET_LABELS[report.targetType],
    reasonLabel: FORUM_REPORT_REASON_LABELS[report.reason],
    statusLabel: FORUM_REPORT_STATUS_LABELS[report.status],
    createdAtLabel: formatRelativeTime(report.createdAt, now) || '刚刚',
    receiptText: `举报已提交（${FORUM_REPORT_TARGET_LABELS[report.targetType]} · ${FORUM_REPORT_REASON_LABELS[report.reason]}），当前状态：${FORUM_REPORT_STATUS_LABELS[report.status]}。`,
    anonymous: report.anonymous,
  };
}

export interface SubmitForumReportOptions {
  session: ForumSession;
  /** 匿名举报（与发帖匿名语义一致） */
  anonymous?: boolean;
  now?: Date;
  idempotencyKey?: string;
}

export async function submitForumReport(
  repository: ForumRepository,
  command: ReportForumTargetCommand,
  options: SubmitForumReportOptions,
): Promise<Result<ForumReportReceiptVM, ApiError>> {
  if (!command.targetId.trim()) {
    return err({ code: 'VALIDATION_FAILED', message: '缺少举报目标' });
  }
  if (!command.reason) {
    return err({ code: 'VALIDATION_FAILED', message: '请选择举报原因' });
  }

  const result = await repository.report({
    targetType: command.targetType,
    targetId: command.targetId,
    reason: command.reason,
    ...(command.note?.trim() ? { note: command.note.trim() } : {}),
    reporterId: options.session.userId,
    anonymous: options.anonymous ?? false,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  });
  if (!result.ok) return err(result.error);

  return ok(toForumReportReceiptVM(result.value, options.now ?? new Date()));
}

/* ------------------------------------------------------------------ *
 * 回复
 * ------------------------------------------------------------------ */

export interface ReplyToForumPostOptions {
  session: ForumSession;
  anonymous?: boolean;
  parentReplyId?: string | null;
  now?: Date;
  idempotencyKey?: string;
}

export async function replyToForumPost(
  repository: ForumRepository,
  postId: string,
  body: string,
  options: ReplyToForumPostOptions,
): Promise<Result<ForumReplyVM, ApiError>> {
  const problems = validateForumReplyDraft({
    postId,
    body,
    anonymous: options.anonymous ?? false,
    parentReplyId: options.parentReplyId ?? null,
  });
  if (problems.length > 0) {
    return err({
      code: 'VALIDATION_FAILED',
      message: problems[0] ?? '回复内容不合法',
      details: { problems },
    });
  }

  const result = await repository.createReply({
    postId,
    body,
    anonymous: options.anonymous ?? false,
    parentReplyId: options.parentReplyId ?? null,
    authorId: options.session.userId,
    authorNickname: options.session.nickname,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  });
  if (!result.ok) return err(result.error);

  const reply: ForumReply = result.value;
  return ok(toForumReplyVM(reply, options.now ?? new Date(), options.parentReplyId ? 1 : 0));
}
