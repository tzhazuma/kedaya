import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  FORUM_REPLIES_DEFAULT_PAGE_SIZE,
  FORUM_REPLIES_PAGE_SIZE,
  FORUM_STATUS,
  boardProblem,
  bodyProblem,
  deriveAnonHandle,
  isForumBoard,
  isForumSort,
  isForumStatus,
  normalizeBoardStats,
  replyProblem,
  titleProblem,
} from '../../domain/models/forum'
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumBoardStat,
  ForumPost,
  ForumPostDetail,
  ForumPostFilters,
  ForumReply,
  ForumSort,
} from '../../domain/models/forum'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ForumDetailQuery,
  ForumRepository,
  ListForumPostsQuery,
} from '../../domain/ports/forumRepository'
import { StorageKeys } from '../storage/keys'

/**
 * Mock 论坛仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 它**复刻了后端 `ForumPostService` 的领域规则**：
 *   · 版块白名单 + `boards()` 按契约顺序补齐 0（与 groupBy 统计同语义）；
 *   · 匿名解耦：`anonymous: true` 时 `authorId` 存 null，改用**不含实名信息**的 handle；
 *   · 匿名帖不保存作者身份 ⇒ 关闭 / 删除一律 FORBIDDEN（连原发布者也不行）；
 *   · 状态机：published → closed；关闭后回复返回 CONFLICT；
 *   · 回复与帖子计数在**同一动作**里维护（replyCount + 1 / lastReplyAt），
 *     因此列表热度与详情回复数永远一致；
 *   · 列表默认只返回 published，`hot` 排序 = 回复数优先、其次最近回复。
 *
 * 数据落在 `CachePort`（默认 Taro Storage），因此**刷新页面后自己发的帖子还在**。
 * 存储 key 刻意与列表缓存 key 分开：列表缓存存的是
 * `{ items, nextCursor, updatedAt }`（契约 §8 hydrate 用），若共用同一个 key，
 * 一次 `list.load()` 就会把数据集覆盖成缓存载荷。
 */

export interface MockForumStore {
  posts: ForumPost[]
  replies: ForumReply[]
}

export interface MockForumRepositoryOptions {
  cache: CachePort
  viewerId: () => string | null
  latencyMs?: number
  now?: () => Date
}

export interface MockForumRepository extends ForumRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(store: { posts: readonly ForumPost[]; replies?: readonly ForumReply[] }): void
}

const MOCK_DB_KEY = `${StorageKeys.forumListCache}:mock-db`

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function emptyStore(): MockForumStore {
  return { posts: [], replies: [] }
}

/**
 * 种子数据 —— 「没有后端也能跑通」整个切片（契约 §7 硬规则 4）。
 *
 * `replyCount` / `lastReplyAt` 由回复列表**反推**，保证列表热度与详情一致，
 * 不会出现「显示 3 条回复、点进去只有 1 条」的假数据。
 */
function defaultSeed(now: Date): MockForumStore {
  const iso = (minutesAgo: number): string =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString()

  const drafts: Array<{
    id: string
    board: string
    authorId: string | null
    title: string
    body: string
    status: string
    pinnedRank: number
    createdMinutesAgo: number
    replies: Array<{
      id: string
      authorId: string | null
      body: string
      minutesAgo: number
    }>
  }> = [
    {
      id: 'forum-demo-1',
      board: 'campus',
      authorId: 'mock-user-1',
      title: '图书馆周五晚上几点闭馆？',
      body: '想去自习，但不确定周五是不是提前闭馆，有同学知道吗？',
      status: FORUM_STATUS.published,
      pinnedRank: 0,
      createdMinutesAgo: 30,
      replies: [
        { id: 'forum-demo-1-r1', authorId: 'mock-user-2', body: '周五是 21:30，比平时早一小时。', minutesAgo: 18 },
        { id: 'forum-demo-1-r2', authorId: 'mock-user-3', body: '楼上正解，公众号也会提前通知。', minutesAgo: 6 },
      ],
    },
    {
      id: 'forum-demo-2',
      board: 'study',
      authorId: 'mock-user-2',
      title: '高数期末复习资料共享（附往年题）',
      body: '整理了三年的期末真题和一份公式速查表，需要的同学在下面回复，我按顺序私信链接。',
      status: FORUM_STATUS.published,
      pinnedRank: 0,
      createdMinutesAgo: 180,
      replies: [
        { id: 'forum-demo-2-r1', authorId: 'mock-user-4', body: '求一份，谢谢学长！', minutesAgo: 150 },
        { id: 'forum-demo-2-r2', authorId: 'mock-user-5', body: '同求，尤其是级数那部分。', minutesAgo: 120 },
        { id: 'forum-demo-2-r3', authorId: 'mock-user-1', body: '已私信，注意查收。', minutesAgo: 90 },
      ],
    },
    {
      id: 'forum-demo-3',
      board: 'treehole',
      authorId: null,
      title: '期末压力有点大，想找人说说话',
      body: '最近事情堆在一起，晚上总是睡不好。有同学愿意聊聊吗？',
      status: FORUM_STATUS.published,
      pinnedRank: 0,
      createdMinutesAgo: 90,
      replies: [
        { id: 'forum-demo-3-r1', authorId: null, body: '抱抱你，可以先去运动一下。', minutesAgo: 70 },
        { id: 'forum-demo-3-r2', authorId: 'mock-user-2', body: '心理咨询中心可以预约，在体育馆旁边。', minutesAgo: 60 },
        { id: 'forum-demo-3-r3', authorId: 'mock-user-4', body: '我在图书馆，需要的话可以一起自习。', minutesAgo: 40 },
        { id: 'forum-demo-3-r4', authorId: null, body: '谢谢你，明天就去问问看。', minutesAgo: 20 },
      ],
    },
    {
      id: 'forum-demo-4',
      board: 'trade',
      authorId: 'mock-user-4',
      title: '出一台闲置显示器（24 寸 1080p）',
      body: '毕业清仓，屏幕无坏点，带一根 HDMI 线，宿舍楼下面交。',
      status: FORUM_STATUS.published,
      pinnedRank: 0,
      createdMinutesAgo: 600,
      replies: [],
    },
    {
      id: 'forum-demo-5',
      board: 'help',
      authorId: 'mock-user-1',
      title: '求推荐靠谱的自行车维修店（已解决）',
      body: '后刹车有点磨，想找个不坑学生的店，已经按回复去了北门那家。',
      status: FORUM_STATUS.closed,
      pinnedRank: 0,
      createdMinutesAgo: 1_200,
      replies: [
        { id: 'forum-demo-5-r1', authorId: 'mock-user-5', body: '北门那家可以，换刹车片 30 元。', minutesAgo: 1_100 },
      ],
    },
    {
      id: 'forum-demo-6',
      board: 'lost',
      authorId: 'mock-user-5',
      title: '在体育馆捡到一副耳机（黑框蓝色镜盒）',
      body: '放在体育馆前台了，有同学丢的可以去认领。',
      status: FORUM_STATUS.published,
      pinnedRank: 0,
      createdMinutesAgo: 20,
      replies: [],
    },
    {
      id: 'forum-demo-7',
      board: 'life',
      authorId: 'mock-user-2',
      title: '【置顶】校园卡充值与挂失常见问题',
      body: '整理了校园卡充值失败、线上挂失、补办流程的常见问题，先看这里再发帖。',
      status: FORUM_STATUS.published,
      pinnedRank: 1,
      createdMinutesAgo: 3_000,
      replies: [
        { id: 'forum-demo-7-r1', authorId: 'mock-user-3', body: '补办要带身份证，在行政楼一楼。', minutesAgo: 2_000 },
        { id: 'forum-demo-7-r2', authorId: 'mock-user-1', body: '补充：挂失后原卡的余额会转到新卡。', minutesAgo: 1_500 },
      ],
    },
  ]

  const posts: ForumPost[] = []
  const replies: ForumReply[] = []

  for (const draft of drafts) {
    const createdAt = iso(draft.createdMinutesAgo)
    const postReplies: ForumReply[] = draft.replies.map((reply) => ({
      id: reply.id,
      postId: draft.id,
      authorId: reply.authorId,
      // 匿名回复的 handle 同样由「id + 匿名主体」派生，不含实名信息
      anonHandle:
        reply.authorId === null
          ? deriveAnonHandle(`${reply.id}:${draft.authorId ?? 'anonymous'}`)
          : null,
      body: reply.body,
      status: FORUM_STATUS.published,
      createdAt: iso(reply.minutesAgo),
    }))
    replies.push(...postReplies)

    const lastReplyAt = postReplies.reduce<string | null>(
      (latest, reply) => (latest === null || reply.createdAt > latest ? reply.createdAt : latest),
      null,
    )

    posts.push({
      id: draft.id,
      board: draft.board,
      authorId: draft.authorId,
      anonHandle: draft.authorId === null ? deriveAnonHandle(`${draft.id}:mock-user-3`) : null,
      title: draft.title,
      body: draft.body,
      // 演示数据不带图（与其它 mock 仓储一致）
      imageUrls: [],
      status: draft.status,
      pinnedRank: draft.pinnedRank,
      replyCount: postReplies.length,
      lastReplyAt,
      createdAt,
      updatedAt: lastReplyAt ?? createdAt,
    })
  }

  return { posts, replies }
}

/**
 * 热度排序 —— 与后端 `orderByFor('hot')` 同序：
 * `replyCount desc` → `lastReplyAt desc (nulls last)` → `id desc`。
 */
function compareHot(a: ForumPost, b: ForumPost): number {
  if (a.replyCount !== b.replyCount) return b.replyCount - a.replyCount
  if (a.lastReplyAt !== b.lastReplyAt) {
    if (a.lastReplyAt === null) return 1
    if (b.lastReplyAt === null) return -1
    return b.lastReplyAt.localeCompare(a.lastReplyAt)
  }
  return b.id.localeCompare(a.id)
}

export function createMockForumRepository(options: MockForumRepositoryOptions): MockForumRepository {
  const { cache, viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): MockForumStore {
    const stored = cache.read<unknown>(MOCK_DB_KEY)
    if (isStore(stored)) return stored
    const seeded = defaultSeed(now())
    cache.write(MOCK_DB_KEY, seeded)
    return seeded
  }

  function save(store: MockForumStore): void {
    cache.write(MOCK_DB_KEY, store)
  }

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  function findPost(store: MockForumStore, id: string): ForumPost | null {
    return store.posts.find((post) => post.id === id) ?? null
  }

  function nextId(prefix: string): string {
    return `${prefix}-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`
  }

  /**
   * 匿名帖的 `authorId` 是 null：平台**无法**证明请求者就是作者，
   * 因此出于隐私保护直接拒绝，而不是要求提交任何身份线索（与后端同语义）。
   */
  function assertRealAuthor(
    post: ForumPost,
    action: '关闭' | '删除',
  ): RepositoryError | null {
    const viewer = viewerId()
    if (viewer === null) return { code: 'UNAUTHENTICATED', message: '请先登录' }
    if (post.authorId === null) {
      return {
        code: 'FORBIDDEN',
        message: `匿名主题不保存作者身份，出于隐私保护无法${action}`,
      }
    }
    if (post.authorId !== viewer) {
      return { code: 'FORBIDDEN', message: `只能${action}自己发布的内容` }
    }
    return null
  }

  return {
    kind: 'mock',

    boards(): Promise<Result<ForumBoardStat[], RepositoryError>> {
      return guard(() => {
        // 后端 `boardCounts()` 不带 where：关闭的主题同样计入统计
        const counts = new Map<string, number>()
        for (const post of load().posts) {
          counts.set(post.board, (counts.get(post.board) ?? 0) + 1)
        }
        return ok(
          normalizeBoardStats(
            [...counts].map(([board, postCount]) => ({ board, postCount })),
          ),
        )
      })
    },

    list(query: ListForumPostsQuery): Promise<Result<Page<ForumPost>, RepositoryError>> {
      return guard(() => {
        const filters: ForumPostFilters = query.filters
        const viewer = viewerId()

        if (filters.board !== undefined && !isForumBoard(filters.board)) {
          return err({ code: 'VALIDATION_FAILED', message: '版块不在支持范围内' })
        }
        if (filters.status !== undefined && !isForumStatus(filters.status)) {
          return err({ code: 'VALIDATION_FAILED', message: '主题状态不在支持范围内' })
        }
        const sort: ForumSort = filters.sort ?? 'latest'
        if (!isForumSort(sort)) {
          return err({ code: 'VALIDATION_FAILED', message: '排序方式不支持' })
        }

        let posts = load().posts
        // 默认只查 published：关闭的主题要显式带 status 才能看到（与后端一致）
        const status = filters.status ?? FORUM_STATUS.published
        posts = posts.filter((post) => post.status === status)

        if (filters.board !== undefined) {
          posts = posts.filter((post) => post.board === filters.board)
        }
        if (filters.mine === true) {
          // 匿名帖没有 authorId，天然不计入「我的帖子」
          posts = viewer === null ? [] : posts.filter((post) => post.authorId === viewer)
        }
        if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
          const keyword = filters.keyword.trim().toLowerCase()
          posts = posts.filter(
            (post) =>
              post.title.toLowerCase().includes(keyword) ||
              post.body.toLowerCase().includes(keyword),
          )
        }

        posts =
          sort === 'hot'
            ? [...posts].sort(compareHot)
            : [...posts].sort((a, b) => {
                const diff = a.createdAt.localeCompare(b.createdAt)
                return -diff || b.id.localeCompare(a.id)
              })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, posts.findIndex((post) => post.id === query.cursor) + 1)
        const visible = posts.slice(start, start + limit)
        const hasMore = start + limit < posts.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string, query?: ForumDetailQuery): Promise<Result<ForumPostDetail, RepositoryError>> {
      return guard(() => {
        const store = load()
        const post = findPost(store, id)
        if (post === null) return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })

        const limit = Math.min(
          query?.replyLimit ?? FORUM_REPLIES_DEFAULT_PAGE_SIZE,
          FORUM_REPLIES_PAGE_SIZE,
        )
        const replyCursor = query?.replyCursor ?? null
        const all = store.replies
          .filter((reply) => reply.postId === id && reply.status === FORUM_STATUS.published)
          // 回复按时间正序（最早在前），id 为第二排序键
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

        const start =
          replyCursor === null
            ? 0
            : Math.max(0, all.findIndex((reply) => reply.id === replyCursor) + 1)
        const visible = all.slice(start, start + limit)
        const hasMore = start + limit < all.length

        return ok({
          post,
          replies: {
            items: visible,
            nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
          },
        })
      })
    },

    createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发帖' })

        const board = boardProblem(input.board)
        if (board !== null) return err({ code: 'VALIDATION_FAILED', message: board })
        const title = titleProblem(input.title)
        if (title !== null) return err({ code: 'VALIDATION_FAILED', message: title })
        const body = bodyProblem(input.body)
        if (body !== null) return err({ code: 'VALIDATION_FAILED', message: body })

        const anonymous = input.anonymous === true
        const id = nextId('forum-local')
        const timestamp = now().toISOString()
        const post: ForumPost = {
          id,
          board: input.board,
          // 实名身份只能来自登录主体；匿名时**不落库**
          authorId: anonymous ? null : viewer,
          // handle 需要帖子 id，因此创建后再补写（与后端 `create` 之后的 `update` 一致）
          anonHandle: anonymous ? deriveAnonHandle(`${id}:${viewer}`) : null,
          title: input.title.trim(),
          body: input.body.trim(),
          imageUrls: input.imageUrls ?? [],
          status: FORUM_STATUS.published,
          pinnedRank: 0,
          replyCount: 0,
          lastReplyAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        const store = load()
        save({ posts: [post, ...store.posts], replies: store.replies })
        return ok(post)
      })
    },

    reply(id: string, input: CreateForumReplyInput): Promise<Result<ForumReply, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录后再回复' })

        const problem = replyProblem(input.body)
        if (problem !== null) return err({ code: 'VALIDATION_FAILED', message: problem })

        const store = load()
        const post = findPost(store, id)
        if (post === null) return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })
        if (post.status !== FORUM_STATUS.published) {
          return err({ code: 'CONFLICT', message: '该主题已关闭，无法回复' })
        }

        const anonymous = input.anonymous === true
        const replyId = nextId('forum-reply-local')
        const createdAt = now().toISOString()
        const reply: ForumReply = {
          id: replyId,
          postId: id,
          authorId: anonymous ? null : viewer,
          anonHandle: anonymous ? deriveAnonHandle(`${replyId}:${viewer}`) : null,
          body: input.body.trim(),
          status: FORUM_STATUS.published,
          createdAt,
        }

        // 回复落库 + 帖子热度自增，是**同一个动作**（后端用事务保证）
        const nextPost: ForumPost = {
          ...post,
          replyCount: post.replyCount + 1,
          lastReplyAt: createdAt,
          updatedAt: createdAt,
        }

        save({
          posts: store.posts.map((item) => (item.id === id ? nextPost : item)),
          replies: [...store.replies, reply],
        })
        return ok(reply)
      })
    },

    close(id: string): Promise<Result<ForumPost, RepositoryError>> {
      return guard(() => {
        const store = load()
        const post = findPost(store, id)
        if (post === null) return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })

        const author = assertRealAuthor(post, '关闭')
        if (author !== null) return err(author)

        if (post.status === FORUM_STATUS.closed) {
          return err({ code: 'CONFLICT', message: '该主题已经关闭' })
        }

        const next: ForumPost = {
          ...post,
          status: FORUM_STATUS.closed,
          updatedAt: now().toISOString(),
        }
        save({ posts: store.posts.map((item) => (item.id === id ? next : item)), replies: store.replies })
        return ok(next)
      })
    },

    remove(id: string): Promise<Result<{ id: string }, RepositoryError>> {
      return guard(() => {
        const store = load()
        const post = findPost(store, id)
        if (post === null) return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })

        const author = assertRealAuthor(post, '删除')
        if (author !== null) return err(author)

        // 与数据库的 onDelete: Cascade 一致：删帖同时删掉它的回复
        save({
          posts: store.posts.filter((item) => item.id !== id),
          replies: store.replies.filter((item) => item.postId !== id),
        })
        return ok({ id })
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(MOCK_DB_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save(emptyStore())
    },

    seed(store): void {
      save({ posts: [...store.posts], replies: [...(store.replies ?? [])] })
    },
  }
}

/** 缓存里的数据集形状守卫：旧版本写入的内容不可信 */
function isStore(value: unknown): value is MockForumStore {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { posts?: unknown; replies?: unknown }
  return Array.isArray(candidate.posts) && Array.isArray(candidate.replies)
}
