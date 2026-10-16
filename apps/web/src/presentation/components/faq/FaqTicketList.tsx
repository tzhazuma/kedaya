'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';

import {
  createEmptyTicketDraft,
  loadFaqTickets,
  submitFaqTicket,
  validateFaqTicketDraft,
  type FaqTicketDraft,
  type FaqTicketListVM,
  type FaqTicketVM,
} from '@/application/faq/listFaqTickets';
import { deriveViewState } from '@/application/viewState';
import { getMockFaqRepository, getRepositories } from '@/data/repositories';
import { FAQ_LIMITS, FAQ_TICKET_STATUS_LABELS } from '@/domain/models/faq';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';

/** 演示用户（未登录时传 null —— 契约 §2.8 允许未登录提交工单） */
const DEMO_FAQ_USER_ID: string | null = 'u_1024';

/**
 * 我的工单：列表（三态）+ 提交表单。
 *
 * 隐私：联系方式**不接受明文手机号**（契约 §2.8），列表里一律脱敏展示。
 */
export function FaqTicketList() {
  const repository = getRepositories().faq;
  const mockRepository = getMockFaqRepository();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<FaqTicketDraft>(createEmptyTicketDraft());
  const [problems, setProblems] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<FaqTicketVM | null>(null);
  const [forcingError, setForcingError] = useState(false);

  const filters = { status: 'all' as const };
  const queryKey = queryKeys.faq.tickets(filters);

  const query = useQuery({
    queryKey,
    queryFn: async () => unwrapOrThrow(await loadFaqTickets(repository)),
  });

  const data: FaqTicketListVM | undefined = query.data;
  const items = data?.items ?? [];

  const state = deriveViewState({
    isPending: query.isPending,
    isError: query.isError,
    isEmpty: items.length === 0,
  });

  const draftProblems = validateFaqTicketDraft(draft);

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapOrThrow(
        await submitFaqTicket(repository, draft, { userId: DEMO_FAQ_USER_ID }),
      ),
    onSuccess: async (ticket) => {
      setProblems([]);
      setSubmitted(ticket);
      setDraft(createEmptyTicketDraft());
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => setProblems([errorMessage(error)]),
  });

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="faq-tickets-heading">
      {/* ---- 提交工单 ---- */}
      <KdyCard className="flex flex-col gap-3">
        <h2 id="faq-tickets-heading" className="text-sm font-semibold text-body">
          提交新工单
        </h2>
        <p className="text-xs text-muted">
          无需登录也能提交。联系方式请填**邮箱或微信号** —— 出于数据最小化，我们不保存明文手机号。
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">联系方式</span>
          <input
            type="text"
            value={draft.contact}
            maxLength={FAQ_LIMITS.contactMax}
            onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
            placeholder="例：yaya@shanghaitech.edu.cn 或 wechat: yaya_duck"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">
            问题描述 <span className="text-xs text-muted">（≤{FAQ_LIMITS.ticketQuestionMax} 字）</span>
          </span>
          <textarea
            value={draft.question}
            rows={4}
            maxLength={FAQ_LIMITS.ticketQuestionMax}
            onChange={(event) => setDraft({ ...draft, question: event.target.value })}
            placeholder="说清你做了什么、期望什么、实际发生了什么；有 traceId 更好"
            className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body outline-none placeholder:text-muted"
          />
        </label>

        {problems.length > 0 ? (
          <KdyAlert tone="danger" title="工单无法提交" role="alert">
            <ul className="list-disc pl-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </KdyAlert>
        ) : null}

        {submitted ? (
          <KdyAlert tone="success" title="工单已提交" role="status">
            <p>
              工单 id <code className="font-mono">{submitted.id}</code>，状态：
              {submitted.statusLabel}，联系方式记录为 {submitted.contactMasked}。
            </p>
            <p className="mt-1 text-xs">已回复后 7 天未确认会自动关闭；你也可以随时追问。</p>
          </KdyAlert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {draftProblems.length === 0 && (draft.contact.trim() || draft.question.trim())
              ? '检查通过，可以提交。'
              : '填写联系方式与问题描述后即可提交。'}
          </p>
          <KdyButton
            disabled={mutation.isPending || draftProblems.length > 0 || !draft.question.trim()}
            onClick={() => mutation.mutate()}
          >
            <Send className="size-4" aria-hidden />
            {mutation.isPending ? '提交中…' : '提交工单'}
          </KdyButton>
        </div>
      </KdyCard>

      {/* ---- 我的工单列表 ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-body">我的工单</h2>
        {mockRepository ? (
          <KdyButton
            size="sm"
            variant={forcingError ? 'danger' : 'secondary'}
            onClick={toggleForcedError}
          >
            {forcingError ? '恢复正常' : '演练故障'}
          </KdyButton>
        ) : null}
      </div>

      {state === 'loading' ? (
        <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="faq-tickets-loading">
          <KdyCardSkeleton />
        </div>
      ) : null}

      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="工单列表加载失败"
          role="alert"
          action={
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {state === 'empty' ? (
        <KdyEmpty
          title="还没有工单"
          description={data?.emptyHint ?? '知识库里没有答案时，就在上面提交一个问题。'}
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((ticket) => (
            <li key={ticket.id}>
              <KdyCard className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <KdyBadge tone={ticket.statusTone}>{ticket.statusLabel}</KdyBadge>
                  <span className="font-mono">{ticket.id}</span>
                  <span>· 提交于 {ticket.createdLabel}</span>
                  <span>· 联系方式 {ticket.contactMasked}</span>
                  {ticket.guest ? <KdyBadge tone="neutral">未登录提交</KdyBadge> : null}
                </div>
                <p className="text-sm text-body">{ticket.question}</p>
                {ticket.answer ? (
                  <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
                    <p className="text-xs text-muted">
                      管理员回复
                      {ticket.answeredLabel ? `（${ticket.answeredLabel}）` : ''}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-body">{ticket.answer}</p>
                  </div>
                ) : null}
                {ticket.needsReply ? (
                  <p className="text-xs text-muted">
                    已回复，等待你确认或追问（{FAQ_TICKET_STATUS_LABELS.ANSWERED} → 确认后关闭）。
                  </p>
                ) : null}
              </KdyCard>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
