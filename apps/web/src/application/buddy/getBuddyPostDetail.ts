/**
 * 用例：搭子详情 + 申请 / 审批 / 关闭 / 撤回（契约 §7：application 层编排，不含 IO）。
 *
 * 动作名全部是契约 §11.2 **已冻结**的：`join` / `leave` / `close` / `decide`（`feedback` 在推荐用例里）。
 * 语义要点（规格 §5.5）：
 * - `join` 是**申请**，不占名额 —— `joinedCount` 只在 `decide(ACCEPTED)` 时递增；
 * - `decide` 只允许发起人，且名额满时返回 `CONFLICT` / `POST_FULL`；
 * - `close` 只允许发起人，走 `OPEN/FULL → CLOSED`（状态机在 domain，UI 不得自己改状态）。
 *
 * 隐私（规格 §6.1）：申请人列表与留言**只有发起人可见**；
 * 联系方式**不出现在本 VM 的任何字段里**，只展示"申请通过后经站内信交换"的说明。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  BUDDY_APPLICATION_STATUS_LABELS,
  BUDDY_CONTACT_NOTICE,
  BUDDY_PRIVACY_ITEMS,
  BUDDY_PRIVACY_SUMMARY,
  BUDDY_PRIVACY_VISIBILITY_LABELS,
  BUDDY_WITHDRAW_NOTICE,
  canTransitionPost,
  remainingSlots,
  sectionOf,
  type BuddyApplication,
  type BuddyApplicationStatus,
  type BuddyPrivacyItem,
} from '@/domain/models/buddy';
import type { BuddyRepository } from '@/domain/ports/buddy';

import { deriveViewState, type ViewState } from '../viewState';
import { newIdempotencyKey } from './ids';
import { toBuddyPostCardVM, type BuddyPostCardVM } from './listBuddyPosts';
import type { BuddySession } from './session';

export interface BuddyApplicationVM {
  id: string;
  applicantLabel: string;
  status: BuddyApplicationStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  message: string | null;
  createdLabel: string;
  decidedLabel: string | null;
  isMine: boolean;
  /** 待审批且我是发起人 → 可以审批 */
  decidable: boolean;
}

export interface BuddyPrivacyItemVM extends BuddyPrivacyItem {
  visibilityLabel: string;
}

export interface BuddyPostDetailVM {
  post: BuddyPostCardVM;
  description: string | null;
  viewerIsCreator: boolean;
  /** 只有发起人视角才有内容 */
  applications: BuddyApplicationVM[];
  viewerApplication: BuddyApplicationVM | null;
  pendingCount: number;
  acceptedCount: number;
  canJoin: boolean;
  canLeave: boolean;
  canClose: boolean;
  /** 我要填的申请留言上限 */
  messageMaxLength: number;
  contactNotice: string;
  withdrawNotice: string;
  privacy: {
    items: BuddyPrivacyItemVM[];
    publicNotice: string;
    hiddenNotice: string;
    contactExchange: string;
    withdrawal: string;
  };
  state: ViewState;
}

const STATUS_TONES: Record<
  BuddyApplicationStatus,
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'
> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'neutral',
  WITHDRAWN: 'neutral',
};

export function toBuddyApplicationVM(
  application: BuddyApplication,
  options: { viewerId: string; viewerIsCreator: boolean; now: Date },
): BuddyApplicationVM {
  return {
    id: application.id,
    applicantLabel: application.applicantNickname,
    status: application.status,
    statusLabel: BUDDY_APPLICATION_STATUS_LABELS[application.status],
    statusTone: STATUS_TONES[application.status],
    message: application.message,
    createdLabel: formatRelativeTime(application.createdAt, options.now) || '时间未知',
    decidedLabel: application.decidedAt
      ? formatRelativeTime(application.decidedAt, options.now) || null
      : null,
    isMine: application.applicantId === options.viewerId,
    decidable: options.viewerIsCreator && application.status === 'PENDING',
  };
}

export function buddyPrivacyItems(): BuddyPrivacyItemVM[] {
  return BUDDY_PRIVACY_ITEMS.map((item) => ({
    ...item,
    visibilityLabel: BUDDY_PRIVACY_VISIBILITY_LABELS[item.visibility],
  }));
}

export function toBuddyPostDetailVM(
  detail: {
    post: Parameters<typeof toBuddyPostCardVM>[0];
    applications: BuddyApplication[];
    viewerApplication: BuddyApplication | null;
    viewerIsCreator: boolean;
  },
  options: { viewerId: string; now: Date; state?: ViewState },
): BuddyPostDetailVM {
  const { post, viewerIsCreator } = detail;
  const card = toBuddyPostCardVM(post, {
    now: options.now,
    viewerId: options.viewerId,
    myApplicationStatus: detail.viewerApplication?.status ?? null,
  });
  const applications = detail.applications.map((application) =>
    toBuddyApplicationVM(application, {
      viewerId: options.viewerId,
      viewerIsCreator,
      now: options.now,
    }),
  );

  const remaining = remainingSlots(post);

  return {
    post: card,
    description: post.description,
    viewerIsCreator,
    applications,
    viewerApplication: detail.viewerApplication
      ? toBuddyApplicationVM(detail.viewerApplication, {
          viewerId: options.viewerId,
          viewerIsCreator,
          now: options.now,
        })
      : null,
    pendingCount: applications.filter((a) => a.status === 'PENDING').length,
    acceptedCount: applications.filter((a) => a.status === 'ACCEPTED').length,
    canJoin:
      card.joinable &&
      !viewerIsCreator &&
      detail.viewerApplication?.status !== 'PENDING' &&
      detail.viewerApplication?.status !== 'ACCEPTED',
    canLeave: detail.viewerApplication?.status === 'PENDING',
    canClose: viewerIsCreator && canTransitionPost(post.status, 'CLOSED'),
    messageMaxLength: 200,
    contactNotice: BUDDY_CONTACT_NOTICE,
    withdrawNotice: BUDDY_WITHDRAW_NOTICE,
    privacy: {
      items: buddyPrivacyItems(),
      publicNotice: BUDDY_PRIVACY_SUMMARY.publicNotice,
      hiddenNotice: BUDDY_PRIVACY_SUMMARY.hiddenNotice,
      contactExchange: BUDDY_PRIVACY_SUMMARY.contactExchange,
      withdrawal: BUDDY_PRIVACY_SUMMARY.withdrawal,
    },
    state: options.state ?? deriveViewState({ isPending: false, isError: false, isEmpty: false }),
  };
}

/** 用例入口：加载详情（按身份裁剪可见字段） */
export async function loadBuddyPostDetail(
  repository: BuddyRepository,
  postId: string,
  options: { session: BuddySession; now?: Date; state?: ViewState },
): Promise<Result<BuddyPostDetailVM, ApiError>> {
  const now = options.now ?? new Date();
  const result = await repository.postDetail(postId, options.session.userId);
  if (!result.ok) return err(result.error);

  return ok(
    toBuddyPostDetailVM(result.value, {
      viewerId: options.session.userId,
      now,
      ...(options.state === undefined ? {} : { state: options.state }),
    }),
  );
}

/** 已冻结动作 `join`：提交申请（**不占名额**，规格 §5.5） */
export async function joinBuddyPost(
  repository: BuddyRepository,
  input: { postId: string; session: BuddySession; message?: string; now?: Date },
): Promise<Result<BuddyPostDetailVM, ApiError>> {
  const joined = await repository.join({
    postId: input.postId,
    applicant: {
      id: input.session.userId,
      nickname: input.session.nickname,
      gender: input.session.gender,
      skillLevel: input.session.skillLevel,
    },
    ...(input.message === undefined ? {} : { message: input.message }),
    idempotencyKey: newIdempotencyKey(),
  });
  if (!joined.ok) return err(joined.error);

  // 申请成功后重新读一次详情：名额/申请状态由服务端说了算，客户端不自己改
  return loadBuddyPostDetail(repository, input.postId, {
    session: input.session,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** 已冻结动作 `leave`：撤回申请（`PENDING → WITHDRAWN`） */
export async function leaveBuddyPost(
  repository: BuddyRepository,
  input: { postId: string; session: BuddySession; now?: Date },
): Promise<Result<BuddyPostDetailVM, ApiError>> {
  const left = await repository.leave({
    postId: input.postId,
    applicantId: input.session.userId,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!left.ok) return err(left.error);
  return loadBuddyPostDetail(repository, input.postId, {
    session: input.session,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** 已冻结动作 `decide`：发起人接受 / 拒绝 */
export async function decideBuddyApplication(
  repository: BuddyRepository,
  input: {
    postId: string;
    applicationId: string;
    decision: 'ACCEPTED' | 'REJECTED';
    session: BuddySession;
    now?: Date;
  },
): Promise<Result<BuddyPostDetailVM, ApiError>> {
  const decided = await repository.decide({
    postId: input.postId,
    applicationId: input.applicationId,
    decision: input.decision,
    actorId: input.session.userId,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!decided.ok) return err(decided.error);
  return loadBuddyPostDetail(repository, input.postId, {
    session: input.session,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** 已冻结动作 `close`：发起人关闭招募（`OPEN/FULL → CLOSED`） */
export async function closeBuddyPost(
  repository: BuddyRepository,
  input: { postId: string; session: BuddySession; now?: Date },
): Promise<Result<BuddyPostDetailVM, ApiError>> {
  const closed = await repository.close({
    postId: input.postId,
    actorId: input.session.userId,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!closed.ok) return err(closed.error);
  return loadBuddyPostDetail(repository, input.postId, {
    session: input.session,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** 详情页的板块标签（面包屑用，避免 UI 自己查表） */
export function detailSectionLabel(post: { activity: Parameters<typeof sectionOf>[0] }): string {
  return sectionOf(post.activity);
}
