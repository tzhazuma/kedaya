'use client';

import { useMutation } from '@tanstack/react-query';
import { RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

import {
  FORUM_REPORT_REASON_OPTIONS,
  REPORT_THRESHOLD_NOTICE,
  submitForumReport,
  type ForumReportReceiptVM,
} from '@/application/forum/reportForumTarget';
import { DEMO_FORUM_SESSION } from '@/application/forum/session';
import { getRepositories } from '@/data/repositories';
import type { ForumReportReason, ForumReportTargetType } from '@/domain/models/forum';

import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';

export interface ForumReportDialogProps {
  open: boolean;
  targetType: ForumReportTargetType;
  targetId: string;
  /** 展示用目标描述，例：主题「快递站周末到底开不开门」 */
  targetLabel: string;
  onClose: () => void;
  onSubmitted?: (receipt: ForumReportReceiptVM) => void;
}

/**
 * 举报弹层（走已冻结的领域动作 `forum.report`）。
 *
 * 无障碍：`role="dialog"` + `aria-modal` + Escape 关闭；
 * 文案上明确「举报 ≠ 立即删除」——3 个不同用户举报才会自动隐藏（域模型 §2.4）。
 */
export function ForumReportDialog({
  open,
  targetType,
  targetId,
  targetLabel,
  onClose,
  onSubmitted,
}: ForumReportDialogProps) {
  const [reason, setReason] = useState<ForumReportReason>('spam');
  const [note, setNote] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [receipt, setReceipt] = useState<ForumReportReceiptVM | null>(null);

  const repository = getRepositories().forum;

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapOrThrow(
        await submitForumReport(
          repository,
          { targetType, targetId, reason, ...(note.trim() ? { note: note.trim() } : {}) },
          { session: DEMO_FORUM_SESSION, anonymous },
        ),
      ),
    onSuccess: (result) => {
      setReceipt(result);
      onSubmitted?.(result);
    },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="forum-report-title"
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="forum-report-title" className="flex items-center gap-2 text-md font-semibold text-body">
              <ShieldAlert className="size-4 text-danger" aria-hidden />
              举报{targetType === 'POST' ? '主题' : '回复'}
            </h2>
            <p className="text-xs text-muted">{targetLabel}</p>
          </div>
          <KdyButton size="sm" variant="ghost" onClick={onClose} aria-label="关闭举报弹层">
            <X className="size-4" aria-hidden />
          </KdyButton>
        </div>

        {receipt ? (
          <KdyAlert tone="success" title="举报已提交" role="status">
            <p>{receipt.receiptText}</p>
            <p className="mt-1 text-xs">{REPORT_THRESHOLD_NOTICE}</p>
            <p className="mt-1 text-xs">
              举报记录 id：<code className="font-mono">{receipt.id}</code>
              {receipt.anonymous ? '（匿名举报，被举报方看不到你的身份）' : ''}
            </p>
          </KdyAlert>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-body">举报原因</legend>
              {FORUM_REPORT_REASON_OPTIONS.map((option, index) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm',
                    reason === option.value
                      ? 'border-brand-soft bg-brand-soft text-brand-strong'
                      : 'border-border bg-surface text-body hover:bg-surface-alt',
                  )}
                >
                  <input
                    type="radio"
                    name="forum-report-reason"
                    value={option.value}
                    checked={reason === option.value}
                    autoFocus={index === 0}
                    onChange={() => setReason(option.value)}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-body">补充说明（可选）</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="例：这条内容包含他人手机号，请协助处理"
                className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              匿名举报（被举报方看不到你的身份）
            </label>

            <p className="rounded-md border border-border bg-surface-alt px-2 py-1 text-xs text-muted">
              {REPORT_THRESHOLD_NOTICE}
            </p>

            {mutation.isError ? (
              <KdyAlert tone="danger" title="举报提交失败" role="alert">
                <p>{errorMessage(mutation.error)}</p>
              </KdyAlert>
            ) : null}

            <div className="flex justify-end gap-2">
              <KdyButton variant="secondary" size="sm" onClick={onClose}>
                取消
              </KdyButton>
              <KdyButton
                size="sm"
                variant="danger"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                提交举报
              </KdyButton>
            </div>
          </>
        )}

        {receipt ? (
          <div className="flex justify-end">
            <KdyButton size="sm" variant="secondary" onClick={onClose}>
              知道了
            </KdyButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
