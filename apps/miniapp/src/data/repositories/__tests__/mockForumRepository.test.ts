import { describe, expect, it } from 'vitest'

import { validatePostDraft, validateReplyDraft } from '../../../application/forum/forumUseCases'
import {
  FORUM_ANONYMOUS_LABEL,
  FORUM_BOARDS,
  FORUM_STATUS,
  authorLabel,
  availableActions,
  boardBadge,
  boardLabel,
  canClose,
  canRemove,
  canReply,
  deriveAnonHandle,
  normalizeBoardStats,
  statusLabel,
  summarizePost,
  summarizeReply,
} from '../../../domain/models/forum'
import type { ForumPost, ForumReply } from '../../../domain/models/forum'
import { StorageKeys } from '../../storage/keys'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { createMockForumRepository } from '../mockForumRepository'

/**
 * 论坛「领域规则 + Mock 仓储」的可执行规格。
 *
 * 重点不在「能跑」，而在**规则与后端 `ForumPostService` 一致**：
 *   · 匿名 = `authorId: null` + 不含实名信息的 handle；
 *   · 匿名帖不保存作者身份 ⇒ 关闭 / 删除一律 FORBIDDEN（连原发布者也不行）；
 *   · published → closed 状态机，关闭后回复 CONFLICT；
 *   · 回复与帖子计数在同一动作里维护；hot 排序与后端 orderBy 同序；
 *   · 列表默认只返回 published。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const DB_KEY = `${StorageKeys.forumListCache}:mock-db`

const REPORTER = 'user-reporter'
const OTHER = 'user-other'

function post(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 'post-1',
    board: 'campus',
    authorId: REPORTER,
    anonHandle: null,
    title: '图书馆周五几点闭馆',
    body: '想去自习，不确定周五是否提前闭馆。',
    imageUrls: [],
    status: FORUM_STATUS.published,
    pinnedRank: 0,
    replyCount: 0,
    lastReplyAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function reply(overrides: Partial<ForumReply> = {}): ForumReply {
  return {
    id: 'reply-1',
    postId: 'post-1',
    authorId: REPORTER,
    anonHandle: null,
    body: '周五是 21:30。',
    status: FORUM_STATUS.published,
    createdAt: '2026-05-01T10:10:00.000Z',
    ...overrides,
  }
}

function make(
  viewer: string | null,
  posts: readonly ForumPost[] = [post()],
  replies: readonly ForumReply[] = [],
) {
  const cache = createMemoryStorage()
  const repository = createMockForumRepository({
    cache,
    viewerId: () => viewer,
    latencyMs: 0,
    now: () => NOW,
  })
  repository.seed({ posts, replies })
  return { repository, cache }
}

function repo(
  viewer: string | null,
  posts: readonly ForumPost[] = [post()],
  replies: readonly ForumReply[] = [],
) {
  return make(viewer, posts, replies).repository
}

describe('领域标签与派生视图', () => {
  it('未知版块 / 状态降级为可读文案，而不是抛错', () => {
    expect(boardLabel('campus')).toBe('校园')
    expect(boardBadge('campus')).toBe('校园')
    expect(boardLabel('nope')).toBe('其它版块')
    expect(boardBadge('nope')).toBe('版块')
    expect(statusLabel('published')).toBe('讨论中')
    expect(statusLabel('closed')).toBe('已关闭')
    expect(statusLabel('nope')).toBe('未知状态')
  })

  it('作者展示名只区分「我 / 实名同学 / 匿名 handle」', () => {
    expect(authorLabel(REPORTER, null, REPORTER)).toBe('我')
    expect(authorLabel(REPORTER, null, OTHER)).toBe('实名同学')
    expect(authorLabel(REPORTER, null, null)).toBe('实名同学')
    expect(authorLabel(null, '鸭友ABC123', REPORTER)).toBe('鸭友ABC123')
    expect(authorLabel(null, null, REPORTER)).toBe(FORUM_ANONYMOUS_LABEL)
  })

  it('normalizeBoardStats 按契约顺序补齐 0，并丢掉未知版块', () => {
    const stats = normalizeBoardStats([
      { board: 'treehole', postCount: 3 },
      { board: 'campus', postCount: 1 },
      { board: 'unknown', postCount: 9 },
      { board: 'study', postCount: -4 },
    ])
    expect(stats.map((stat) => stat.board)).toEqual([...FORUM_BOARDS])
    expect(stats.find((stat) => stat.board === 'campus')?.postCount).toBe(1)
    expect(stats.find((stat) => stat.board === 'treehole')?.postCount).toBe(3)
    expect(stats.find((stat) => stat.board === 'study')?.postCount).toBe(0)
    expect(stats).toHaveLength(FORUM_BOARDS.length)
  })

  it('summarizePost 给出可读卡片视图，并标记匿名 / 我的 / 置顶', () => {
    const summary = summarizePost(
      post({ replyCount: 3, lastReplyAt: '2026-05-01T11:00:00.000Z', pinnedRank: 1 }),
      REPORTER,
      NOW,
    )
    expect(summary.boardLabel).toBe('校园')
    expect(summary.status).toBe('published')
    expect(summary.authorLabel).toBe('我')
    expect(summary.mine).toBe(true)
    expect(summary.pinned).toBe(true)
    expect(summary.anonymous).toBe(false)
    expect(summary.replyCountLabel).toBe('3 条回复')
    expect(summary.lastReplyLabel).toBe('最后回复 1 小时前')
    expect(summary.createdLabel).toBe('2 小时前')

    const empty = summarizePost(post({ replyCount: 0 }), OTHER, NOW)
    expect(empty.mine).toBe(false)
    expect(empty.replyCountLabel).toBe('还没有回复')
    expect(empty.lastReplyLabel).toBeNull()

    const anon = summarizePost(post({ authorId: null, anonHandle: '鸭友XYZ' }), REPORTER, NOW)
    expect(anon.anonymous).toBe(true)
    expect(anon.authorLabel).toBe('鸭友XYZ')
  })

  it('summarizePost 的正文预览截断到 60 字', () => {
    const summary = summarizePost(post({ body: 'x'.repeat(200) }), REPORTER, NOW)
    expect(summary.bodyPreview).toHaveLength(60)
  })

  it('summarizeReply 派生匿名标记与相对时间', () => {
    const view = summarizeReply(reply(), REPORTER, NOW)
    expect(view.authorLabel).toBe('我')
    expect(view.mine).toBe(true)
    expect(view.anonymous).toBe(false)
    expect(view.body).toBe('周五是 21:30。')

    const anon = summarizeReply(
      reply({ authorId: null, anonHandle: '鸭友ZZZ', createdAt: '2026-05-01T11:30:00.000Z' }),
      REPORTER,
      NOW,
    )
    expect(anon.anonymous).toBe(true)
    expect(anon.mine).toBe(false)
    expect(anon.authorLabel).toBe('鸭友ZZZ')
    expect(anon.timeLabel).toBe('30 分钟前')
  })

  it('deriveAnonHandle 确定可复现、两个种子不同、且不含实名信息', () => {
    const first = deriveAnonHandle('post-1:user-1')
    expect(first).toBe(deriveAnonHandle('post-1:user-1'))
    expect(first).not.toBe(deriveAnonHandle('post-2:user-1'))
    expect(first.startsWith('鸭友')).toBe(true)
    expect(first).toHaveLength(8)
    expect(first).not.toContain('user-1')
  })
})

describe('动作闸门（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录时没有任何动作', () => {
    expect(availableActions(post(), null)).toEqual([])
  })

  it('登录用户对 published 主题都能回复', () => {
    expect(availableActions(post(), OTHER)).toEqual(['reply'])
    expect(availableActions(post({ status: FORUM_STATUS.closed }), OTHER)).toEqual([])
  })

  it('实名作者在 published 时可关闭 / 删除，关闭后只剩删除', () => {
    expect(availableActions(post(), REPORTER)).toEqual(['reply', 'close', 'delete'])
    expect(availableActions(post({ status: FORUM_STATUS.closed }), REPORTER)).toEqual(['delete'])
  })

  it('匿名主题的作者不可辨 ⇒ 任何人（含原发布者）都不能关闭 / 删除', () => {
    const anon = post({ authorId: null, anonHandle: '鸭友AAA' })
    expect(availableActions(anon, REPORTER)).toEqual(['reply'])
    expect(canClose(anon, REPORTER)).toEqual({
      allowed: false,
      message: '匿名主题不保存作者身份，出于隐私保护无法关闭',
    })
    expect(canRemove(anon, REPORTER)).toEqual({
      allowed: false,
      message: '匿名主题不保存作者身份，出于隐私保护无法删除',
    })
  })

  it('canReply / canClose / canRemove 给出可读的拒绝原因', () => {
    expect(canReply(post(), null).message).toContain('登录')
    expect(canReply(post({ status: FORUM_STATUS.closed }), REPORTER).message).toBe(
      '该主题已关闭，无法回复',
    )
    expect(canReply(post(), REPORTER).allowed).toBe(true)

    expect(canClose(post(), null).message).toContain('登录')
    expect(canClose(post(), OTHER).message).toBe('只能关闭自己发布的内容')
    expect(canClose(post({ status: FORUM_STATUS.closed }), REPORTER).message).toBe('该主题已经关闭')
    expect(canClose(post(), REPORTER).allowed).toBe(true)

    expect(canRemove(post(), OTHER).message).toBe('只能删除自己发布的内容')
    expect(canRemove(post({ status: FORUM_STATUS.closed }), REPORTER).allowed).toBe(true)
  })
})

describe('发帖 / 回复前的客户端校验', () => {
  it('validatePostDraft 逐项提示', () => {
    expect(validatePostDraft({ board: 'nope', title: '', body: '', anonymous: false })).toEqual([
      '版块不在支持范围内',
      '请填写标题',
      '请填写正文',
    ])
    expect(
      validatePostDraft({ board: 'campus', title: 'x'.repeat(81), body: '正文', anonymous: false }),
    ).toEqual(['标题最多 80 个字'])
    expect(
      validatePostDraft({
        board: 'campus',
        title: '标题',
        body: 'x'.repeat(5001),
        anonymous: false,
      }),
    ).toEqual(['正文最多 5000 个字'])
    expect(
      validatePostDraft({ board: 'campus', title: '标题', body: '正文', anonymous: false }),
    ).toEqual([])
  })

  it('validateReplyDraft 只校验内容长度', () => {
    expect(validateReplyDraft({ body: '   ', anonymous: false })).toEqual(['请填写回复内容'])
    expect(validateReplyDraft({ body: 'x'.repeat(2001), anonymous: false })).toEqual([
      '回复内容最多 2000 个字',
    ])
    expect(validateReplyDraft({ body: '谢谢分享', anonymous: false })).toEqual([])
  })
})

describe('Mock 仓储 · 发帖与匿名', () => {
  it('未登录不能发帖（UNAUTHENTICATED）', async () => {
    const r = repo(null, [])
    const result = await r.createPost({ board: 'campus', title: '标题', body: '正文' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('实名发帖：作者来自登录主体，状态 published，计数从 0 起', async () => {
    const r = repo(REPORTER, [])
    const created = await r.createPost({
      board: 'study',
      title: '  高数资料共享  ',
      body: '  整理了三年的真题。  ',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.authorId).toBe(REPORTER)
    expect(created.value.anonHandle).toBeNull()
    expect(created.value.title).toBe('高数资料共享')
    expect(created.value.body).toBe('整理了三年的真题。')
    expect(created.value.status).toBe(FORUM_STATUS.published)
    expect(created.value.replyCount).toBe(0)
    expect(created.value.lastReplyAt).toBeNull()
  })

  it('匿名发帖：authorId 为 null，handle 由「帖子 id + 主体」派生且不含实名', async () => {
    const r = repo(REPORTER, [])
    const created = await r.createPost({
      board: 'treehole',
      title: '压力有点大',
      body: '想找人说说话。',
      anonymous: true,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.authorId).toBeNull()
    expect(created.value.anonHandle).toBe(deriveAnonHandle(`${created.value.id}:${REPORTER}`))
    expect(created.value.anonHandle).not.toContain(REPORTER)
  })

  it('非法版块 / 空标题 / 超长正文统一 VALIDATION_FAILED', async () => {
    const r = repo(REPORTER, [])
    const cases = [
      { board: 'nope', title: '标题', body: '正文' },
      { board: 'campus', title: '   ', body: '正文' },
      { board: 'campus', title: '标题', body: '  ' },
      { board: 'campus', title: 'x'.repeat(81), body: '正文' },
      { board: 'campus', title: '标题', body: 'x'.repeat(5001) },
    ]
    for (const input of cases) {
      const result = await r.createPost(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('Mock 仓储 · 回复与计数', () => {
  it('未登录不能回复（UNAUTHENTICATED）', async () => {
    const r = repo(null, [post()])
    const result = await r.reply('post-1', { body: '你好' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('空 / 超长回复 VALIDATION_FAILED', async () => {
    const r = repo(REPORTER, [post()])
    const empty = await r.reply('post-1', { body: '   ' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error.code).toBe('VALIDATION_FAILED')

    const tooLong = await r.reply('post-1', { body: 'x'.repeat(2001) })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.error.code).toBe('VALIDATION_FAILED')
  })

  it('回复写入后同一动作维护 replyCount / lastReplyAt', async () => {
    const r = repo(REPORTER, [post()])
    const created = await r.reply('post-1', { body: '谢谢，很有用' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.postId).toBe('post-1')

    const detail = await r.detail('post-1')
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.value.post.replyCount).toBe(1)
    expect(detail.value.post.lastReplyAt).toBe(NOW.toISOString())
    expect(detail.value.replies.items.map((item) => item.id)).toEqual([created.value.id])
  })

  it('匿名回复：authorId 为 null，handle 稳定派生', async () => {
    const r = repo(REPORTER, [post()])
    const created = await r.reply('post-1', { body: '匿名回一句', anonymous: true })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.authorId).toBeNull()
    expect(created.value.anonHandle).toBe(deriveAnonHandle(`${created.value.id}:${REPORTER}`))
  })

  it('已关闭主题不能回复（CONFLICT）', async () => {
    const r = repo(REPORTER, [post({ status: FORUM_STATUS.closed })])
    const result = await r.reply('post-1', { body: '还能回吗' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.message).toBe('该主题已关闭，无法回复')
    }
  })

  it('不存在的主题不能回复（NOT_FOUND）', async () => {
    const r = repo(REPORTER, [])
    const result = await r.reply('ghost', { body: '你好' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('Mock 仓储 · 关闭与删除的归属闸门', () => {
  it('实名作者可以关闭：published → closed', async () => {
    const r = repo(REPORTER, [post()])
    const closed = await r.close('post-1')
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.value.status).toBe(FORUM_STATUS.closed)

    const again = await r.close('post-1')
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect(again.error.message).toBe('该主题已经关闭')
    }
  })

  it('非作者关闭 / 删除 → FORBIDDEN', async () => {
    const r = repo(OTHER, [post()])
    const closed = await r.close('post-1')
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error.code).toBe('FORBIDDEN')

    const removed = await r.remove('post-1')
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.message).toBe('只能删除自己发布的内容')
  })

  it('匿名主题：原发布者也不能关闭 / 删除（FORBIDDEN，明确文案）', async () => {
    const anon = post({ authorId: null, anonHandle: '鸭友AAA' })
    const r = repo(REPORTER, [anon])
    const closed = await r.close('post-1')
    expect(closed.ok).toBe(false)
    if (!closed.ok) {
      expect(closed.error.code).toBe('FORBIDDEN')
      expect(closed.error.message).toBe('匿名主题不保存作者身份，出于隐私保护无法关闭')
    }

    const removed = await r.remove('post-1')
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.message).toBe('匿名主题不保存作者身份，出于隐私保护无法删除')
  })

  it('未登录关闭 / 删除 → UNAUTHENTICATED', async () => {
    const r = repo(null, [post()])
    const results = [await r.close('post-1'), await r.remove('post-1')]
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('删除会级联清掉该主题的全部回复（对齐 Prisma onDelete: Cascade）', async () => {
    const { repository, cache } = make(
      REPORTER,
      [post()],
      [reply({ id: 'r1' }), reply({ id: 'r2' }), reply({ id: 'r3', postId: 'post-2' })],
    )
    const removed = await repository.remove('post-1')
    expect(removed.ok).toBe(true)

    const store = cache.read<{ posts: ForumPost[]; replies: ForumReply[] }>(DB_KEY)
    expect(store?.posts.map((item) => item.id)).toEqual([])
    expect(store?.replies.map((item) => item.id)).toEqual(['r3'])

    const missing = await repository.detail('post-1')
    expect(missing.ok).toBe(false)
  })

  it('不存在的主题：detail / close / remove 统一 NOT_FOUND', async () => {
    const r = repo(REPORTER, [])
    const results = [await r.detail('ghost'), await r.close('ghost'), await r.remove('ghost')]
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })
})

describe('Mock 仓储 · 版块统计与列表', () => {
  it('boards 统计包含已关闭主题，并按契约顺序补齐 0', async () => {
    const r = repo(OTHER, [
      post({ id: 'a', board: 'campus' }),
      post({ id: 'b', board: 'campus', status: FORUM_STATUS.closed }),
      post({ id: 'c', board: 'study' }),
    ])
    const result = await r.boards()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((stat) => stat.board)).toEqual([...FORUM_BOARDS])
    expect(result.value.find((stat) => stat.board === 'campus')?.postCount).toBe(2)
    expect(result.value.find((stat) => stat.board === 'study')?.postCount).toBe(1)
    expect(result.value.find((stat) => stat.board === 'treehole')?.postCount).toBe(0)
  })

  it('列表默认只返回 published，关闭的主题要显式筛选', async () => {
    const r = repo(OTHER, [
      post({ id: 'open', status: FORUM_STATUS.published }),
      post({ id: 'closed', status: FORUM_STATUS.closed }),
    ])
    const defaulted = await r.list({ cursor: null, filters: {} })
    expect(defaulted.ok).toBe(true)
    if (defaulted.ok) expect(defaulted.value.items.map((item) => item.id)).toEqual(['open'])

    const closed = await r.list({ cursor: null, filters: { status: FORUM_STATUS.closed } })
    if (closed.ok) expect(closed.value.items.map((item) => item.id)).toEqual(['closed'])
  })

  it('版块与关键词可以叠加筛选', async () => {
    const r = repo(OTHER, [
      post({ id: 'a', board: 'campus', title: '图书馆闭馆时间', body: '周五几点关门' }),
      post({ id: 'b', board: 'study', title: '图书馆自习攻略', body: '占座技巧' }),
      post({ id: 'c', board: 'campus', title: '食堂新品', body: '二楼新窗口' }),
    ])
    const byBoard = await r.list({ cursor: null, filters: { board: 'campus' } })
    if (byBoard.ok) expect(byBoard.value.items.map((item) => item.id).sort()).toEqual(['a', 'c'])

    const byKeyword = await r.list({ cursor: null, filters: { keyword: '图书馆' } })
    if (byKeyword.ok) expect(byKeyword.value.items.map((item) => item.id).sort()).toEqual(['a', 'b'])

    const both = await r.list({ cursor: null, filters: { board: 'campus', keyword: '食堂' } })
    if (both.ok) expect(both.value.items.map((item) => item.id)).toEqual(['c'])
  })

  it('mine 只看自己的实名帖，匿名帖天然不参与', async () => {
    const r = repo(REPORTER, [
      post({ id: 'mine', authorId: REPORTER }),
      post({ id: 'theirs', authorId: OTHER }),
      post({ id: 'anon', authorId: null, anonHandle: '鸭友AAA' }),
    ])
    const result = await r.list({ cursor: null, filters: { mine: true } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((item) => item.id)).toEqual(['mine'])

    const anonymous = repo(null, [post({ id: 'mine', authorId: REPORTER })])
    const none = await anonymous.list({ cursor: null, filters: { mine: true } })
    if (none.ok) expect(none.value.items).toHaveLength(0)
  })

  it('非法版块 / 状态 / 排序 → VALIDATION_FAILED', async () => {
    const r = repo(OTHER, [post()])
    const results = await Promise.all([
      r.list({ cursor: null, filters: { board: 'nope' as never } }),
      r.list({ cursor: null, filters: { status: 'nope' as never } }),
      r.list({ cursor: null, filters: { sort: 'nope' as never } }),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('Mock 仓储 · 排序与分页', () => {
  const ordered = [
    post({ id: 'p1', createdAt: '2026-05-01T10:00:00.000Z', replyCount: 3, lastReplyAt: '2026-05-01T10:30:00.000Z' }),
    post({ id: 'p2', createdAt: '2026-05-01T12:00:00.000Z', replyCount: 1, lastReplyAt: null }),
    post({ id: 'p3', createdAt: '2026-05-01T11:00:00.000Z', replyCount: 3, lastReplyAt: '2026-05-01T11:30:00.000Z' }),
    post({ id: 'p4', createdAt: '2026-05-01T09:00:00.000Z', replyCount: 1, lastReplyAt: '2026-05-01T09:30:00.000Z' }),
  ]

  it('latest 按发布时间倒序（createdAt desc → id desc）', async () => {
    const r = repo(OTHER, ordered)
    const result = await r.list({ cursor: null, filters: { sort: 'latest' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((item) => item.id)).toEqual(['p2', 'p3', 'p1', 'p4'])
  })

  it('hot 按回复数优先，其次最近回复，空 lastReplyAt 排最后', async () => {
    const r = repo(OTHER, ordered)
    const result = await r.list({ cursor: null, filters: { sort: 'hot' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((item) => item.id)).toEqual(['p3', 'p1', 'p4', 'p2'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor（不返回 total）', async () => {
    const r = repo(OTHER, ordered)
    const first = await r.list({ cursor: null, limit: 2, filters: { sort: 'latest' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((item) => item.id)).toEqual(['p2', 'p3'])
    expect(first.value.nextCursor).toBe('p3')
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'p3', limit: 2, filters: { sort: 'latest' } })
    if (second.ok) {
      expect(second.value.items.map((item) => item.id)).toEqual(['p1', 'p4'])
      expect(second.value.nextCursor).toBeNull()
    }
  })

  it('详情按时间正序返回回复，并支持 replyCursor 翻页', async () => {
    const r = repo(
      OTHER,
      [post()],
      [
        reply({ id: 'r1', createdAt: '2026-05-01T10:01:00.000Z' }),
        reply({ id: 'r2', createdAt: '2026-05-01T10:02:00.000Z' }),
        reply({ id: 'r3', createdAt: '2026-05-01T10:03:00.000Z' }),
      ],
    )
    const first = await r.detail('post-1', { replyCursor: null, replyLimit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.replies.items.map((item) => item.id)).toEqual(['r1', 'r2'])
    expect(first.value.replies.nextCursor).toBe('r2')

    const second = await r.detail('post-1', { replyCursor: 'r2', replyLimit: 2 })
    if (second.ok) {
      expect(second.value.replies.items.map((item) => item.id)).toEqual(['r3'])
      expect(second.value.replies.nextCursor).toBeNull()
    }
  })
})

describe('Mock 仓储 · 持久化与演示控制', () => {
  it('数据落在 CachePort：新实例读到同一份数据（刷新页面不丢）', async () => {
    const cache = createMemoryStorage()
    const options = { cache, viewerId: () => REPORTER, latencyMs: 0, now: () => NOW }

    const first = createMockForumRepository(options)
    first.seed({ posts: [], replies: [] })
    const created = await first.createPost({ board: 'life', title: '校园卡挂失', body: '求流程' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = createMockForumRepository(options)
    const listed = await second.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toContain(created.value.id)
  })

  it('数据集与列表缓存使用不同的 key：写列表缓存不会覆盖数据集', async () => {
    const { repository, cache } = make(REPORTER)
    cache.write(StorageKeys.forumListCache, {
      items: [],
      nextCursor: null,
      updatedAt: NOW.toISOString(),
    })
    const listed = await repository.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toEqual(['post-1'])
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(REPORTER, [post()])
    r.failNextRequests(1)

    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const recovered = await r.list({ cursor: null, filters: {} })
    expect(recovered.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表，reset 又能恢复种子', async () => {
    const r = repo(REPORTER, [post()])
    r.clearAll()
    const cleared = await r.list({ cursor: null, filters: {} })
    if (cleared.ok) expect(cleared.value.items).toHaveLength(0)

    r.reset()
    const afterReset = await r.list({ cursor: null, filters: {} })
    if (afterReset.ok) expect(afterReset.value.items.length).toBeGreaterThan(0)
  })
})
