import { err, ok, type Result } from '@kedaya/shared'

import type { FaqArticle, FaqTicket } from '../../domain/models/faq'
import type { ForumBoard, ForumPost, ForumReport, ForumReply } from '../../domain/models/forum'
import type { AuthTokens, Session, UserProfile } from '../../domain/models/session'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  FaqArticlePage,
  FaqHelpfulVote,
  FaqRepository,
  ListFaqArticlesQuery,
  SubmitFaqTicketInput,
  VoteFaqHelpfulInput,
} from '../../domain/ports/faqRepository'
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostPage,
  ForumReplyPage,
  ForumRepository,
  ListForumPostsQuery,
  ListForumRepliesQuery,
  ReportForumContentInput,
} from '../../domain/ports/forumRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import type {
  ListWildlifeQuery,
  UploadMediaInput,
  WildlifePage,
} from '../../domain/ports/wildlifeRepository'
import type { WildlifeRepository } from '../../domain/ports/wildlifeRepository'
import type {
  CampusBasemap,
  WildlifeClassifyResult,
  WildlifeIndividual,
  WildlifeIndividualCreateBody,
  WildlifeMedia,
  WildlifeSighting,
  WildlifeSightingCreateBody,
  WildlifeSpecies,
  WildlifeSpot,
  WildlifeTrack,
  WildlifeZone,
} from '../../domain/models/wildlife'

/**
 * 测试替身（test doubles）—— 刻意**不** import `data/` 下的任何实现，
 * 保持 `application` 层的分层干净（契约 §7）。
 *
 * 放在 `__tests__/` 下但文件名不含 `.test.ts`，因此不会被 vitest 当成测试收集。
 */

/* ------------------------------------------------------------------ *
 * 基础替身
 * ------------------------------------------------------------------ */

export interface FakeCache extends CachePort {
  dump(): Record<string, unknown>
}

export function createFakeCache(seed?: Record<string, unknown>): FakeCache {
  const store = new Map<string, unknown>(Object.entries(seed ?? {}))
  return {
    read: <T>(key: string): T | null => (store.has(key) ? (store.get(key) as T) : null),
    write: <T>(key: string, value: T): void => {
      store.set(key, value)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
    dump: () => Object.fromEntries(store),
  }
}

export function fixedClock(iso: string): ClockPort {
  return { now: () => new Date(iso) }
}

export const TEST_NOW_ISO = '2026-10-16T12:00:00.000Z'

export const TEST_PROFILE: UserProfile = {
  id: 'u-me',
  nickname: '可达鸭测试号',
  studentId: '20260001',
  college: '信息科学与技术学院',
  campusBound: false,
}

/** 最小可用的 `SessionStorePort` 替身（只实现用例层真正用到的部分） */
export function createFakeSessionStore(profile: UserProfile | null = TEST_PROFILE): SessionStorePort {
  let snapshot: Session = { tokens: null, profile }
  const listeners = new Set<() => void>()

  function commit(next: Session): Session {
    snapshot = next
    for (const listener of listeners) listener()
    return next
  }

  return {
    read: () => snapshot,
    getSnapshot: () => snapshot,
    persist: (session: Session) => commit(session),
    clear: () => commit({ tokens: null, profile: null }),
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setTokens(tokens: AuthTokens | null): Session {
      return commit({ ...snapshot, tokens })
    },
    setProfile(next: UserProfile | null): Session {
      return commit({ ...snapshot, profile: next })
    },
    signOut(): Session {
      return commit({ tokens: null, profile: null })
    },
  }
}

/* ------------------------------------------------------------------ *
 * 数据构造器
 * ------------------------------------------------------------------ */

export function forumBoard(id: string, overrides: Partial<ForumBoard> = {}): ForumBoard {
  return {
    id,
    slug: id,
    name: `版块 ${id}`,
    description: '版块描述',
    visibility: 'public',
    postCount: 0,
    ...overrides,
  }
}

export function forumPost(id: string, overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id,
    boardId: 'fb-1',
    title: `主题 ${id}`,
    body: '主题正文',
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u-author',
    authorName: '作者',
    tags: [],
    replyCount: 0,
    likeCount: 0,
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:30:00.000Z',
    ...overrides,
  }
}

export function forumReply(id: string, overrides: Partial<ForumReply> = {}): ForumReply {
  return {
    id,
    postId: 'fp-1',
    body: `回复 ${id}`,
    status: 'PUBLISHED',
    anonymous: false,
    authorId: 'u-replier',
    authorName: '回复者',
    createdAt: '2026-10-16T10:00:00.000Z',
    ...overrides,
  }
}

export function faqArticle(id: string, overrides: Partial<FaqArticle> = {}): FaqArticle {
  return {
    id,
    slug: id,
    question: `问题 ${id}？`,
    answer: `答案 ${id}`,
    category: '账号与登录',
    status: 'PUBLISHED',
    helpfulCount: 0,
    unhelpfulCount: 0,
    updatedAt: '2026-10-16T08:00:00.000Z',
    ...overrides,
  }
}

export function faqTicket(id: string, overrides: Partial<FaqTicket> = {}): FaqTicket {
  return {
    id,
    userId: TEST_PROFILE.id,
    contact: 'student@shanghaitech.edu.cn',
    question: `工单 ${id}`,
    status: 'OPEN',
    createdAt: '2026-10-16T08:00:00.000Z',
    updatedAt: '2026-10-16T08:00:00.000Z',
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * 论坛仓储替身
 * ------------------------------------------------------------------ */

export interface FakeForumRepository extends ForumRepository {
  boardsQueue: Array<Result<ForumBoard[], RepositoryError>>
  postsQueue: Array<Result<ForumPostPage, RepositoryError>>
  repliesQueue: Array<Result<ForumReplyPage, RepositoryError>>
  postDetailResult: Result<ForumPost, RepositoryError>
  createPostResult: Result<ForumPost, RepositoryError>
  createReplyResult: Result<ForumReply, RepositoryError>
  reportResult: Result<ForumReport, RepositoryError>
  /** 记录调用参数，供断言 */
  postsQueries: ListForumPostsQuery[]
  repliesQueries: Array<{ postId: string; query: ListForumRepliesQuery }>
  createdPosts: CreateForumPostInput[]
  createdReplies: CreateForumReplyInput[]
  reports: ReportForumContentInput[]
}

export interface FakeForumRepositoryOptions {
  boards?: Array<Result<ForumBoard[], RepositoryError>>
  posts?: Array<Result<ForumPostPage, RepositoryError>>
  replies?: Array<Result<ForumReplyPage, RepositoryError>>
  postDetail?: Result<ForumPost, RepositoryError>
  createPost?: Result<ForumPost, RepositoryError>
  createReply?: Result<ForumReply, RepositoryError>
  report?: Result<ForumReport, RepositoryError>
}

export function createFakeForumRepository(
  options: FakeForumRepositoryOptions = {},
): FakeForumRepository {
  const boardsQueue = [...(options.boards ?? [])]
  const postsQueue = [...(options.posts ?? [])]
  const repliesQueue = [...(options.replies ?? [])]

  return {
    boardsQueue,
    postsQueue,
    repliesQueue,
    postDetailResult: options.postDetail ?? ok(forumPost('fp-1')),
    createPostResult: options.createPost ?? ok(forumPost('fp-new')),
    createReplyResult: options.createReply ?? ok(forumReply('fr-new')),
    reportResult:
      options.report ??
      ok({
        id: 'frep-1',
        targetType: 'POST',
        targetId: 'fp-1',
        reason: 'spam',
        status: 'PENDING',
        reporterId: TEST_PROFILE.id,
        anonymous: false,
        createdAt: TEST_NOW_ISO,
      }),
    postsQueries: [],
    repliesQueries: [],
    createdPosts: [],
    createdReplies: [],
    reports: [],

    async listBoards() {
      const next = boardsQueue.shift()
      return next ?? ok([])
    },

    async listPosts(query: ListForumPostsQuery = {}) {
      this.postsQueries.push(query)
      const next = postsQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },

    async postDetail() {
      return this.postDetailResult
    },

    async listReplies(postId: string, query: ListForumRepliesQuery = {}) {
      this.repliesQueries.push({ postId, query })
      const next = repliesQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },

    async createPost(input: CreateForumPostInput) {
      this.createdPosts.push(input)
      return this.createPostResult
    },

    async createReply(input: CreateForumReplyInput) {
      this.createdReplies.push(input)
      return this.createReplyResult
    },

    async report(input: ReportForumContentInput) {
      this.reports.push(input)
      return this.reportResult
    },
  }
}

/* ------------------------------------------------------------------ *
 * FAQ 仓储替身
 * ------------------------------------------------------------------ */

export interface FakeFaqRepository extends FaqRepository {
  articlesQueue: Array<Result<FaqArticlePage, RepositoryError>>
  ticketsQueue: Array<Result<FaqTicket[], RepositoryError>>
  voteResult: Result<FaqHelpfulVote, RepositoryError>
  submitResult: Result<FaqTicket, RepositoryError>
  articlesQueries: ListFaqArticlesQuery[]
  votes: VoteFaqHelpfulInput[]
  submitted: SubmitFaqTicketInput[]
  ticketUserIds: Array<string | null>
}

export interface FakeFaqRepositoryOptions {
  articles?: Array<Result<FaqArticlePage, RepositoryError>>
  tickets?: Array<Result<FaqTicket[], RepositoryError>>
  vote?: Result<FaqHelpfulVote, RepositoryError>
  submit?: Result<FaqTicket, RepositoryError>
}

export function createFakeFaqRepository(options: FakeFaqRepositoryOptions = {}): FakeFaqRepository {
  return {
    articlesQueue: [...(options.articles ?? [])],
    ticketsQueue: [...(options.tickets ?? [])],
    voteResult: options.vote ?? ok({ articleId: 'faq-1', helpfulCount: 1, applied: true }),
    submitResult: options.submit ?? ok(faqTicket('ft-new')),
    articlesQueries: [],
    votes: [],
    submitted: [],
    ticketUserIds: [],

    async listArticles(query: ListFaqArticlesQuery = {}) {
      this.articlesQueries.push(query)
      const next = this.articlesQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },

    async voteHelpful(input: VoteFaqHelpfulInput) {
      this.votes.push(input)
      return this.voteResult
    },

    async listMyTickets(userId: string | null) {
      this.ticketUserIds.push(userId)
      const next = this.ticketsQueue.shift()
      return next ?? ok([])
    },

    async submitTicket(input: SubmitFaqTicketInput) {
      this.submitted.push(input)
      return this.submitResult
    },
  }
}

/** 构造一个「上游不可用」失败，供错误态断言复用 */
export function upstreamError(message = '网络不可用'): RepositoryError {
  return { code: 'UPSTREAM_UNAVAILABLE', message }
}

export function notFoundError(message = '不存在'): Result<never, RepositoryError> {
  return err({ code: 'NOT_FOUND', message })
}

/* ------------------------------------------------------------------ *
 * wildlife（猫 / 鸟 / 黑天鹅）仓储替身
 * ------------------------------------------------------------------ */

export function wildlifeSpecies(id: string, overrides: Partial<WildlifeSpecies> = {}): WildlifeSpecies {
  return {
    id,
    scientificName: `Species ${id}`,
    commonNameZh: `物种 ${id}`,
    taxonRank: 'species',
    parentId: null,
    isProtected: false,
    isNestingSensitive: false,
    nestingMonths: [],
    defaultFeedingPolicy: 'discouraged',
    ...overrides,
  }
}

export function wildlifeIndividual(
  id: string,
  overrides: Partial<WildlifeIndividual> = {},
): WildlifeIndividual {
  return {
    id,
    name: `个体 ${id}`,
    speciesId: 'sp-1',
    status: 'PUBLISHED',
    ...overrides,
  }
}

export function wildlifeZone(id: string, overrides: Partial<WildlifeZone> = {}): WildlifeZone {
  return {
    id,
    name: `区域 ${id}`,
    speciesIds: ['sp-1'],
    centerLat: 31.1795,
    centerLng: 121.591,
    radiusM: 80,
    feedingPolicy: 'discouraged',
    fuzzRadiusM: 50,
    isSensitive: false,
    sortOrder: 0,
    ...overrides,
  }
}

export function wildlifeSpot(id: string, overrides: Partial<WildlifeSpot> = {}): WildlifeSpot {
  return {
    id,
    speciesId: 'sp-1',
    zoneId: 'wz-1',
    // WGS84（校园内）
    fuzzedGeo: { lat: 31.1795, lng: 121.591 },
    sightingCount: 10,
    distinctReporters: 4,
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-10-14T00:00:00.000Z',
    // 比 TEST_NOW_ISO 早 48h → 满足 E10 的 24h 延迟
    computedAt: '2026-10-14T12:00:00.000Z',
    confidence: 0.7,
    ...overrides,
  }
}

export function wildlifeSighting(
  id: string,
  overrides: Partial<WildlifeSighting> = {},
): WildlifeSighting {
  return {
    id,
    speciesId: 'sp-1',
    speciesSource: 'manual',
    observedAt: '2026-10-16T06:00:00.000Z',
    fuzzedGeo: { lat: 31.1795, lng: 121.591 },
    zoneId: 'wz-1',
    fuzzLevel: 'grid',
    mediaIds: [],
    status: 'PUBLISHED',
    isInferred: false,
    healthConcern: false,
    isAnonymous: false,
    reporterName: '同学',
    createdAt: '2026-10-16T07:00:00.000Z',
    ...overrides,
  }
}

export function wildlifeTrack(id: string, overrides: Partial<WildlifeTrack> = {}): WildlifeTrack {
  return {
    id,
    speciesId: 'sp-1',
    individualId: null,
    isInferred: true,
    points: [
      { lat: 31.1795, lng: 121.591, observedAt: '2026-10-10T00:00:00.000Z' },
      { lat: 31.1805, lng: 121.592, observedAt: '2026-10-12T00:00:00.000Z' },
    ],
    pointCount: 2,
    startedAt: '2026-10-10T00:00:00.000Z',
    endedAt: '2026-10-12T00:00:00.000Z',
    disclaimer: '本轨迹由 9 次同学上报推断得出，并非实测运动路径。',
    method: 'dbscan-chain',
    sightingCount: 9,
    totalDistanceM: 130,
    confidence: 0.5,
    algorithmVersion: 'dbscan-v1',
    computedAt: '2026-10-14T12:00:00.000Z',
    ...overrides,
  }
}

export function wildlifeBasemap(overrides: Partial<CampusBasemap> = {}): CampusBasemap {
  return {
    version: 'v1',
    imageUrl: 'https://cdn.example/basemap.png',
    widthPx: 1600,
    heightPx: 1200,
    affine: [1, 0, 0, 0, -1, 0],
    calibrationRmsePx: 3.5,
    controlPointCount: 8,
    attribution: '自绘示意图',
    license: 'original',
    ...overrides,
  }
}

export interface FakeWildlifeRepository extends WildlifeRepository {
  basemapResult: Result<CampusBasemap, RepositoryError>
  speciesQueue: Array<Result<WildlifeSpecies[], RepositoryError>>
  zonesQueue: Array<Result<WildlifeZone[], RepositoryError>>
  spotsQueue: Array<Result<WildlifePage<WildlifeSpot>, RepositoryError>>
  tracksQueue: Array<Result<WildlifePage<WildlifeTrack>, RepositoryError>>
  individualsQueue: Array<Result<WildlifeIndividual[], RepositoryError>>
  sightingsQueue: Array<Result<WildlifePage<WildlifeSighting>, RepositoryError>>
  trackDetailResult: Result<WildlifeTrack, RepositoryError>
  sightingDetailResult: Result<WildlifeSighting, RepositoryError>
  uploadResult: Result<WildlifeMedia, RepositoryError>
  createSightingResult: Result<WildlifeSighting, RepositoryError>
  createIndividualResult: Result<WildlifeIndividual, RepositoryError>
  classifyResult: Result<WildlifeClassifyResult, RepositoryError>
  /** 断言用：记录全部调用参数 */
  uploadedPhotos: UploadMediaInput[]
  createdSightings: Array<{
    body: WildlifeSightingCreateBody
    idempotencyKey: string | undefined
  }>
  createdIndividuals: Array<{
    body: WildlifeIndividualCreateBody
    idempotencyKey: string | undefined
  }>
  classifyCalls: string[]
  zonesQueries: Array<ListWildlifeQuery | undefined>
}

export interface FakeWildlifeRepositoryOptions {
  basemap?: Result<CampusBasemap, RepositoryError>
  species?: Array<Result<WildlifeSpecies[], RepositoryError>>
  zones?: Array<Result<WildlifeZone[], RepositoryError>>
  spots?: Array<Result<WildlifePage<WildlifeSpot>, RepositoryError>>
  tracks?: Array<Result<WildlifePage<WildlifeTrack>, RepositoryError>>
  individuals?: Array<Result<WildlifeIndividual[], RepositoryError>>
  sightings?: Array<Result<WildlifePage<WildlifeSighting>, RepositoryError>>
  trackDetail?: Result<WildlifeTrack, RepositoryError>
  sightingDetail?: Result<WildlifeSighting, RepositoryError>
  upload?: Result<WildlifeMedia, RepositoryError>
  createSighting?: Result<WildlifeSighting, RepositoryError>
  createIndividual?: Result<WildlifeIndividual, RepositoryError>
  classify?: Result<WildlifeClassifyResult, RepositoryError>
}

export function createFakeWildlifeRepository(
  options: FakeWildlifeRepositoryOptions = {},
): FakeWildlifeRepository {
  return {
    basemapResult: options.basemap ?? ok(wildlifeBasemap()),
    speciesQueue: [...(options.species ?? [])],
    zonesQueue: [...(options.zones ?? [])],
    spotsQueue: [...(options.spots ?? [])],
    tracksQueue: [...(options.tracks ?? [])],
    individualsQueue: [...(options.individuals ?? [])],
    sightingsQueue: [...(options.sightings ?? [])],
    trackDetailResult: options.trackDetail ?? ok(wildlifeTrack('wt-1')),
    sightingDetailResult: options.sightingDetail ?? ok(wildlifeSighting('ws-1')),
    uploadResult:
      options.upload ??
      ok({
        mediaId: 'wm-1',
        thumbUrl: 'https://cdn.example/thumb.webp',
        exifStripped: true,
        widthPx: 100,
        heightPx: 100,
        byteSize: 1000,
        mimeType: 'image/jpeg',
        sha256: 'sha',
        clientPhotoId: 'cp-1',
      }),
    createSightingResult: options.createSighting ?? ok(wildlifeSighting('ws-new', { status: 'PENDING' })),
    createIndividualResult:
      options.createIndividual ??
      ok({ id: 'wi-new', name: '大橘', speciesId: 'sp-1', status: 'PENDING' }),
    classifyResult: options.classify ?? ok({ suggestions: [], degraded: true }),
    uploadedPhotos: [],
    createdSightings: [],
    createdIndividuals: [],
    classifyCalls: [],
    zonesQueries: [],

    async basemap() {
      return this.basemapResult
    },
    async listSpecies() {
      const next = this.speciesQueue.shift()
      return next ?? ok([])
    },
    async listZones() {
      const next = this.zonesQueue.shift()
      return next ?? ok([])
    },
    async zoneDetail() {
      const next = this.zonesQueue.shift()
      if (next === undefined) return err({ code: 'NOT_FOUND', message: '区域不存在' })
      if (!next.ok) return next
      const first = next.value[0]
      return first === undefined
        ? err({ code: 'NOT_FOUND', message: '区域不存在' })
        : ok(first)
    },
    async listSpots(query) {
      this.zonesQueries.push(query)
      const next = this.spotsQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },
    async listTracks() {
      const next = this.tracksQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },
    async trackDetail() {
      return this.trackDetailResult
    },
    async listIndividuals() {
      const next = this.individualsQueue.shift()
      return next ?? ok([])
    },
    async listSightings() {
      const next = this.sightingsQueue.shift()
      return next ?? ok({ items: [], nextCursor: null, total: 0 })
    },
    async sightingDetail() {
      return this.sightingDetailResult
    },
    async uploadMedia(input) {
      this.uploadedPhotos.push(input)
      return this.uploadResult
    },
    async createSighting(body, idempotencyKey) {
      this.createdSightings.push({ body, idempotencyKey })
      return this.createSightingResult
    },
    async createIndividual(body, idempotencyKey) {
      this.createdIndividuals.push({ body, idempotencyKey })
      return this.createIndividualResult
    },
    async classify(mediaId) {
      this.classifyCalls.push(mediaId)
      return this.classifyResult
    },
  }
}
