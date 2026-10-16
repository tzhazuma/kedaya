import { err, ok, type Result } from '@kedaya/shared'

import { canReply, validateReplyDraft } from '../../domain/models/forum'
import type { ForumPost, ForumReply } from '../../domain/models/forum'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { ForumRepository } from '../../domain/ports/forumRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 「回复主题」用例。
 *
 * 与发帖一样先本地判定，但这里多一步：**必须**先拉主题详情，
 * 用 domain 的 `canReply` 判定状态机（LOCKED / HIDDEN / DELETED / DRAFT）。
 * 这样「版主已锁定」这类情况在弱网下也能立刻给出准确反馈，
 * 而不是发出去被后端拒绝。
 */

export interface ReplyToPostDeps {
  repository: ForumRepository
  session: SessionStorePort
  clock: ClockPort
}

export interface ReplyToPostDraft {
  postId: string
  body: string
  /** 二级回复的父回复 id */
  parentReplyId?: string
  anonymous?: boolean
  idempotencyKey?: string
}

export interface ReplyToPostOutcome {
  reply: ForumReply
  post: ForumPost
  warnings: string[]
}

export interface ReplyToPostUseCase {
  validate(body: string): ReturnType<typeof validateReplyDraft>
  submit(draft: ReplyToPostDraft): Promise<Result<ReplyToPostOutcome, RepositoryError>>
}

export function createReplyToPostUseCase(deps: ReplyToPostDeps): ReplyToPostUseCase {
  const { repository, session, clock } = deps

  return {
    validate: (body: string) => validateReplyDraft(body),

    async submit(draft: ReplyToPostDraft): Promise<Result<ReplyToPostOutcome, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再回复' })
      }

      const validation = validateReplyDraft(draft.body)
      if (!validation.valid) {
        const [first] = validation.errors
        return err({
          code: 'VALIDATION_FAILED',
          message: first?.message ?? '回复内容校验未通过',
          details: { errors: validation.errors },
        })
      }

      const detail = await repository.postDetail(draft.postId)
      if (!detail.ok) return detail

      const eligibility = canReply(detail.value)
      if (!eligibility.allowed) {
        return err({
          code: 'CONFLICT',
          message: eligibility.message,
          details: { reason: eligibility.reason },
        })
      }

      const now = clock.now()
      const created = await repository.createReply({
        postId: draft.postId,
        body: validation.value,
        ...(draft.parentReplyId === undefined ? {} : { parentReplyId: draft.parentReplyId }),
        anonymous: draft.anonymous === true,
        authorId: profile.id,
        authorName: profile.nickname,
        idempotencyKey: draft.idempotencyKey ?? createIdempotencyKey(`forum:reply:${profile.id}`, now),
      })
      if (!created.ok) return created

      // 本地把 replyCount 也 +1，页面用 `appendReply` 就地更新，避免整页重拉
      const post: ForumPost = { ...detail.value, replyCount: detail.value.replyCount + 1 }

      return ok({ reply: created.value, post, warnings: validation.warnings })
    },
  }
}
