/**
 * 用例：发帖（含**匿名开关语义**）。
 *
 * 匿名语义的落点（契约 §9 + 域模型 §2.4）：
 * - application 层只做「开关 → 文案 + 校验 + 输入装配」，**不生成**匿名身份 id
 *   （匿名化是 data 层/服务端的职责，客户端拼 id 等于自己发明隐私边界）；
 * - 开关打开时必须把 `ANONYMITY_NOTICE` 原文展示给用户，说明"实名身份不会与帖子关联"，
 *   并如实说明版主在同一版块内可追溯（不能只讲前半句）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  ANONYMITY_NOTICE,
  ANONYMITY_TOGGLE_LABEL,
  draftPrivacyHints,
  findSensitiveWords,
  FORUM_POST_STATUS_LABELS,
  normalizeTags,
  parseTagInput,
  resolveAuthorLabel,
  validateForumPostDraft,
  type ForumPost,
} from '@/domain/models/forum';
import type { CreateForumPostInput, ForumRepository } from '@/domain/ports/forum';

import type { ForumSession } from './session';

export interface ForumComposerDraft {
  boardId: string;
  title: string;
  body: string;
  /** 标签输入框原文（逗号 / 空格分隔） */
  tagInput: string;
  anonymous: boolean;
}

export const ANONYMOUS_TOGGLE_COPY = {
  label: ANONYMITY_TOGGLE_LABEL,
  notice: ANONYMITY_NOTICE,
  onLabel: '匿名发布（已开启）',
  offLabel: '实名发布',
} as const;

export function createEmptyForumDraft(boardId = ''): ForumComposerDraft {
  return { boardId, title: '', body: '', tagInput: '', anonymous: false };
}

/** 草稿里是否已经有内容（用于"离开会丢失"提示 / 按钮可用性） */
export function isForumDraftDirty(draft: ForumComposerDraft): boolean {
  return Boolean(draft.title.trim() || draft.body.trim() || draft.tagInput.trim());
}

export interface ForumDraftValidation {
  ok: boolean;
  problems: string[];
  /** 非阻断提示（疑似个人信息等） */
  hints: string[];
  sensitiveWords: string[];
  tags: string[];
}

/** 草稿校验：阻断项（problems）与非阻断提示（hints）分开返回 */
export function validateForumComposerDraft(draft: ForumComposerDraft): ForumDraftValidation {
  const tags = parseTagInput(draft.tagInput);
  const problems = validateForumPostDraft({
    boardId: draft.boardId,
    title: draft.title,
    body: draft.body,
    tags,
    anonymous: draft.anonymous,
  });
  return {
    ok: problems.length === 0,
    problems,
    hints: draftPrivacyHints({ title: draft.title, body: draft.body }),
    sensitiveWords: findSensitiveWords(`${draft.title}\n${draft.body}`),
    tags,
  };
}

/**
 * 草稿 → 端口输入。
 *
 * `authorId` / `authorNickname` 一律传**实名**身份；匿名化由仓储实现完成。
 */
export function toCreatePostInput(
  draft: ForumComposerDraft,
  session: ForumSession,
  idempotencyKey?: string,
): CreateForumPostInput {
  const tags = normalizeTags(parseTagInput(draft.tagInput));
  return {
    boardId: draft.boardId,
    title: draft.title.trim(),
    body: draft.body,
    tags,
    anonymous: draft.anonymous,
    authorId: session.userId,
    authorNickname: session.nickname,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

/** 匿名开关打开时返回必须展示的说明；关闭时返回 null */
export function anonymityNoticeFor(anonymous: boolean): string | null {
  return anonymous ? ANONYMITY_NOTICE : null;
}

export interface ForumPostCreatedVM {
  id: string;
  boardId: string;
  title: string;
  statusLabel: string;
  /** 展示用作者名：匿名一律「匿名同学」 */
  authorLabel: string;
  anonymous: boolean;
  /** 匿名发布后给作者的确认文案（与开关处的说明一致） */
  anonymityNotice: string | null;
  createdLabel: string;
  href: string;
}

export function toForumPostCreatedVM(post: ForumPost, now: Date): ForumPostCreatedVM {
  return {
    id: post.id,
    boardId: post.boardId,
    title: post.title,
    statusLabel: FORUM_POST_STATUS_LABELS[post.status],
    authorLabel: resolveAuthorLabel(post),
    anonymous: post.anonymous,
    anonymityNotice: anonymityNoticeFor(post.anonymous),
    createdLabel: formatRelativeTime(post.createdAt, now) || '刚刚',
    href: `/forum/${post.id}`,
  };
}

/** 用例入口：校验 → 提交 → 返回"已创建"视图模型 */
export async function submitForumPost(
  repository: ForumRepository,
  draft: ForumComposerDraft,
  session: ForumSession,
  options: { now?: Date; idempotencyKey?: string } = {},
): Promise<Result<ForumPostCreatedVM, ApiError>> {
  const validation = validateForumComposerDraft(draft);
  if (!validation.ok) {
    return err({
      code: 'VALIDATION_FAILED',
      message: validation.problems[0] ?? '发帖内容不合法',
      details: { problems: validation.problems },
    });
  }

  const result = await repository.createPost(
    toCreatePostInput(draft, session, options.idempotencyKey),
  );
  if (!result.ok) return err(result.error);

  return ok(toForumPostCreatedVM(result.value, options.now ?? new Date()));
}
