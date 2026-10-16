import { describe, expect, it } from 'vitest'

import {
  ANONYMOUS_DISPLAY_NAME,
  FORUM_BODY_MAX_LENGTH,
  FORUM_MAX_TAGS,
  FORUM_TAG_MAX_LENGTH,
  FORUM_TITLE_MAX_LENGTH,
  boardVisibilityLabel,
  buildReplyThreads,
  canReply,
  canReportPost,
  canReportReply,
  containsBlockedKeyword,
  displayAuthorName,
  excerptOf,
  isPostVisible,
  normalizeTags,
  postStatusLabel,
  reportReasonLabel,
  summarizeBoard,
  summarizePost,
  validatePostDraft,
  validateReplyDraft,
  visibleReplies,
} from '../forum'
import type { ForumPost, ForumReply } from '../forum'

/**
 * 论坛领域模型测试 —— 状态机、匿名展示、草稿校验与回复树。
 *
 * 这些规则是 UI 与用例层共用的唯一真相；测试在这里钉死，
 * 页面就不允许自己再实现一遍（否则治理规则会漂移）。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function post(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 'fp-1',
    boardId: 'fb-1',
    title: '标题',
    body: '正文',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u-1',
    authorName: '张同学',
    tags: [],
    replyCount: 0,
    likeCount: 0,
    createdAt: '2026-10-16T11:00:00.000Z',
    updatedAt: '2026-10-16T11:00:00.000Z',
    ...overrides,
  }
}

function reply(overrides: Partial<ForumReply> = {}): ForumReply {
  return {
    id: 'fr-1',
    postId: 'fp-1',
    body: '回复',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u-2',
    authorName: '李同学',
    createdAt: '2026-10-16T11:30:00.000Z',
    ...overrides,
  }
}

describe('forum · 状态标签与可见性', () => {
  it('状态标签覆盖全部五种状态', () => {
    expect(postStatusLabel('DRAFT')).toBe('草稿')
    expect(postStatusLabel('PUBLISHED')).toBe('已发布')
    expect(postStatusLabel('LOCKED')).toBe('已锁定')
    expect(postStatusLabel('HIDDEN')).toBe('已隐藏')
    expect(postStatusLabel('DELETED')).toBe('已删除')
  })

  it('举报理由与版块可见性标签取自冻结枚举', () => {
    expect(reportReasonLabel('spam')).toBe('垃圾广告')
    expect(reportReasonLabel('privacy')).toBe('泄露隐私')
    expect(boardVisibilityLabel('public')).toBe('公开')
    expect(boardVisibilityLabel('campus_only')).toBe('仅校内')
  })

  it('PUBLISHED / LOCKED 可见，DRAFT / HIDDEN / DELETED 不可见', () => {
    expect(isPostVisible(post({ status: 'PUBLISHED' }))).toBe(true)
    expect(isPostVisible(post({ status: 'LOCKED' }))).toBe(true)
    expect(isPostVisible(post({ status: 'DRAFT' }))).toBe(false)
    expect(isPostVisible(post({ status: 'HIDDEN' }))).toBe(false)
    expect(isPostVisible(post({ status: 'DELETED' }))).toBe(false)
  })

  it('不可见的主题也不能被举报', () => {
    expect(canReportPost(post({ status: 'PUBLISHED' }))).toBe(true)
    expect(canReportPost(post({ status: 'LOCKED' }))).toBe(true)
    expect(canReportPost(post({ status: 'HIDDEN' }))).toBe(false)
    expect(canReportPost(post({ status: 'DELETED' }))).toBe(false)
    expect(canReportReply(reply({ status: 'PUBLISHED' }))).toBe(true)
    expect(canReportReply(reply({ status: 'HIDDEN' }))).toBe(false)
  })
})

describe('forum · canReply 状态机（domain-model §2.4）', () => {
  it('PUBLISHED 可以回复', () => {
    expect(canReply(post({ status: 'PUBLISHED' }))).toEqual({ allowed: true })
  })

  it('LOCKED 禁止新回复，并给出准确原因', () => {
    const eligibility = canReply(post({ status: 'LOCKED' }))
    expect(eligibility.allowed).toBe(false)
    if (!eligibility.allowed) {
      expect(eligibility.reason).toBe('locked')
      expect(eligibility.message).toContain('锁定')
    }
  })

  it('HIDDEN / DELETED / DRAFT 各自返回可区分的原因', () => {
    const hidden = canReply(post({ status: 'HIDDEN' }))
    const deleted = canReply(post({ status: 'DELETED' }))
    const draft = canReply(post({ status: 'DRAFT' }))

    expect(hidden.allowed).toBe(false)
    expect(deleted.allowed).toBe(false)
    expect(draft.allowed).toBe(false)
    if (!hidden.allowed) expect(hidden.reason).toBe('hidden')
    if (!deleted.allowed) expect(deleted.reason).toBe('deleted')
    if (!draft.allowed) expect(draft.reason).toBe('not-published')
  })
})

describe('forum · 匿名展示（契约 §9）', () => {
  it('匿名时一律返回统一展示名，不泄漏实名', () => {
    expect(displayAuthorName(true, '张同学')).toBe(ANONYMOUS_DISPLAY_NAME)
    expect(displayAuthorName(false, '张同学')).toBe('张同学')
  })

  it('摘要里的作者名同样遵守匿名规则', () => {
    const anonymous = summarizePost(post({ anonymous: true, authorName: '张同学' }), NOW)
    expect(anonymous.authorName).toBe(ANONYMOUS_DISPLAY_NAME)
    expect(anonymous.anonymous).toBe(true)
  })
})

describe('forum · summarizePost / summarizeBoard', () => {
  it('摘要包含状态、可回复性、置顶与相对时间', () => {
    const summary = summarizePost(
      post({ status: 'LOCKED', pinnedAt: '2026-10-16T10:00:00.000Z', replyCount: 3, likeCount: 7 }),
      NOW,
    )

    expect(summary.statusLabel).toBe('已锁定')
    expect(summary.commentable).toBe(false)
    expect(summary.visible).toBe(true)
    expect(summary.pinned).toBe(true)
    expect(summary.replyCount).toBe(3)
    expect(summary.likeCount).toBe(7)
    expect(summary.createdAtLabel).toBe('1 小时前')
  })

  it('正文摘要压平换行并截断', () => {
    const body = `第一行\n\n第二行   ${'x'.repeat(80)}`
    const excerpt = excerptOf(body, 20)
    expect(excerpt).not.toContain('\n')
    expect(excerpt.endsWith('…')).toBe(true)
    expect([...excerpt].length).toBe(21)
  })

  it('版块摘要暴露 campus_only 语义', () => {
    const summary = summarizeBoard({
      id: 'fb-9',
      slug: 'market',
      name: '二手闲置',
      visibility: 'campus_only',
      postCount: 5,
    })
    expect(summary.campusOnly).toBe(true)
    expect(summary.visibilityLabel).toBe('仅校内')
    expect(summary.description).toBe('')
  })
})

describe('forum · 草稿校验', () => {
  it('合法草稿被规范化（去空白 + 标签去重）', () => {
    const result = validatePostDraft({
      boardId: ' fb-1 ',
      title: '  标题  ',
      body: '  正文  ',
      tags: [' 食堂 ', '食堂', '', '  '],
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value).toEqual({ boardId: 'fb-1', title: '标题', body: '正文', tags: ['食堂'] })
      expect(result.warnings).toEqual([])
    }
  })

  it('空标题 / 空正文 / 空版块都被拦截', () => {
    const result = validatePostDraft({ boardId: '', title: '   ', body: '' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.map((error) => error.field).sort()).toEqual(['boardId', 'body', 'title'])
    }
  })

  it('超长标题与超长正文被拦截', () => {
    const result = validatePostDraft({
      boardId: 'fb-1',
      title: 'x'.repeat(FORUM_TITLE_MAX_LENGTH + 1),
      body: 'y'.repeat(FORUM_BODY_MAX_LENGTH + 1),
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toHaveLength(2)
    }
  })

  it('标签数量与单个标签长度都受限', () => {
    const tooMany = validatePostDraft({
      boardId: 'fb-1',
      title: '标题',
      body: '正文',
      tags: Array.from({ length: FORUM_MAX_TAGS + 1 }, (_unused, index) => `t${index}`),
    })
    expect(tooMany.valid).toBe(false)

    const tooLong = validatePostDraft({
      boardId: 'fb-1',
      title: '标题',
      body: '正文',
      tags: ['x'.repeat(FORUM_TAG_MAX_LENGTH + 1)],
    })
    expect(tooLong.valid).toBe(false)
  })

  it('命中敏感词即拦截（不静默改写）', () => {
    expect(containsBlockedKeyword('可以代考吗')).toBe(true)
    const result = validatePostDraft({ boardId: 'fb-1', title: '求助', body: '有没有代考服务' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.message.includes('敏感词'))).toBe(true)
    }
  })

  it('疑似 PII 只提示不拦截', () => {
    const result = validatePostDraft({
      boardId: 'fb-1',
      title: '找失主',
      body: '请联系 13800138000 或 student@shanghaitech.edu.cn',
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('隐私')
    }
  })

  it('回复草稿：空 / 超长 / 敏感词被拦截，正常内容通过', () => {
    expect(validateReplyDraft('   ').valid).toBe(false)
    expect(validateReplyDraft('x'.repeat(5_001)).valid).toBe(false)
    expect(validateReplyDraft('出售违禁品').valid).toBe(false)

    const okResult = validateReplyDraft('  同意楼上  ')
    expect(okResult.valid).toBe(true)
    if (okResult.valid) expect(okResult.value).toBe('同意楼上')
  })

  it('normalizeTags 保持首次出现顺序', () => {
    expect(normalizeTags(['b', 'a', 'b', ' c '])).toEqual(['b', 'a', 'c'])
    expect(normalizeTags(undefined)).toEqual([])
  })
})

describe('forum · 回复树与可见回复', () => {
  it('把二级回复挂到父回复下，并按时间排序', () => {
    const root = reply({ id: 'fr-1', createdAt: '2026-10-16T10:00:00.000Z' })
    const child = reply({
      id: 'fr-2',
      parentReplyId: 'fr-1',
      createdAt: '2026-10-16T10:30:00.000Z',
    })
    const other = reply({ id: 'fr-3', createdAt: '2026-10-16T11:00:00.000Z' })

    const threads = buildReplyThreads([other, child, root])

    expect(threads).toHaveLength(2)
    expect(threads[0]?.root.id).toBe('fr-1')
    expect(threads[0]?.children.map((item) => item.id)).toEqual(['fr-2'])
    expect(threads[1]?.root.id).toBe('fr-3')
  })

  it('父回复不在当前页时，子回复退化为顶层（不丢数据）', () => {
    const orphan = reply({ id: 'fr-9', parentReplyId: 'fr-missing' })
    const threads = buildReplyThreads([orphan])
    expect(threads).toHaveLength(1)
    expect(threads[0]?.root.id).toBe('fr-9')
    expect(threads[0]?.children).toEqual([])
  })

  it('visibleReplies 过滤掉 HIDDEN / DELETED', () => {
    const list = [
      reply({ id: 'a' }),
      reply({ id: 'b', status: 'HIDDEN' }),
      reply({ id: 'c', status: 'DELETED' }),
    ]
    expect(visibleReplies(list).map((item) => item.id)).toEqual(['a'])
  })
})
