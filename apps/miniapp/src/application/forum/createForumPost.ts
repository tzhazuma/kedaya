import { err, ok, type Result } from '@kedaya/shared'

import { summarizePost, validatePostDraft } from '../../domain/models/forum'
import type { ForumPost, ForumPostSummary, NormalizedPostDraft } from '../../domain/models/forum'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ForumRepository } from '../../domain/ports/forumRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 「发帖」用例 —— 论坛垂直切片的写动作。
 *
 * 顺序刻意如此（与 `joinGroupBuy` 同构）：
 * 1. 先看会话（未登录直接 `UNAUTHENTICATED`，不发无意义的请求）
 * 2. 用 **domain 的 `validatePostDraft`** 做本地预校验（规则只写一次）
 * 3. 才真正调用仓储的 `createPost`，并带 `Idempotency-Key`
 *
 * 关于匿名（契约 §9 + domain-model §2.4）：端上**不伪造**匿名身份。
 * `anonymous: true` 只是把「请以匿名身份发布」告诉后端，真实匿名标识
 * （`AnonymousIdentity.id`）由后端签发；端上仍传实名 `authorId` 供服务端做
 * 身份映射与治理追溯。**前端永远不是匿名性的安全边界。**
 */

export interface CreateForumPostDeps {
  repository: ForumRepository
  session: SessionStorePort
  clock: ClockPort
}

export interface CreateForumPostDraft {
  boardId: string
  title: string
  body: string
  tags?: readonly string[]
  anonymous?: boolean
  /** 显式传入时复用（例如「失败后重试同一次提交」） */
  idempotencyKey?: string
}

export interface CreateForumPostOutcome {
  post: ForumPost
  summary: ForumPostSummary
  /** 非阻断提示（例如疑似 PII），页面应展示但不阻止发布 */
  warnings: string[]
}

export interface CreateForumPostUseCase {
  /** 纯本地校验，供页面在提交前即时反馈（不触发网络） */
  validate(draft: CreateForumPostDraft): ReturnType<typeof validatePostDraft>
  submit(draft: CreateForumPostDraft): Promise<Result<CreateForumPostOutcome, RepositoryError>>
}

export function createCreateForumPostUseCase(deps: CreateForumPostDeps): CreateForumPostUseCase {
  const { repository, session, clock } = deps

  function validate(draft: CreateForumPostDraft): ReturnType<typeof validatePostDraft> {
    return validatePostDraft(draft)
  }

  return {
    validate,

    async submit(draft: CreateForumPostDraft): Promise<Result<CreateForumPostOutcome, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发帖' })
      }

      const validation = validatePostDraft(draft)
      if (!validation.valid) {
        const [first] = validation.errors
        return err({
          code: 'VALIDATION_FAILED',
          message: first?.message ?? '内容校验未通过',
          details: { errors: validation.errors },
        })
      }

      const value: NormalizedPostDraft = validation.value
      const now = clock.now()

      const created = await repository.createPost({
        boardId: value.boardId,
        title: value.title,
        body: value.body,
        tags: value.tags,
        anonymous: draft.anonymous === true,
        authorId: profile.id,
        authorName: profile.nickname,
        idempotencyKey: draft.idempotencyKey ?? createIdempotencyKey(`forum:post:${profile.id}`, now),
      })
      if (!created.ok) return created

      return ok({
        post: created.value,
        summary: summarizePost(created.value, now),
        warnings: validation.warnings,
      })
    },
  }
}
