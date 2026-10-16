/**
 * 找搭子 · 推荐用例（规格 §3.7 端到端流程，验收 T4 / T5 / T6 / T11 / T13 / T32 / T35）
 *
 * ## 流程（逐段对应规格 §3.7 的时序图）
 *
 * ```
 * 1. 读我的 BuddyProfile（含 embedding）
 *    ├─ 没有资料 / matchEnabled=false → rule 档：按 startsAt 排序的开放帖子，
 *    │  reason 统一 "按时间排序"、score=0（规格 §5.7 末段，验收 T11）
 * 2. 解析实际模式（vector / hash / rule，由启动自检决定）
 * 3. 候选召回
 *    ├─ rule 档 → findRuleCandidates（纯 PostgreSQL，无需任何扩展，规格 §4.5）
 *    └─ vector/hash 档 → `<=>` 余弦召回（参数绑定）
 *       └─ 读不到"我的向量"时**整次请求**降级为 rule
 *          （绝不混用 hash 向量与真向量：两种向量空间不同，相似度毫无意义）
 * 4. 硬过滤 F1–F7（applyHardFilters，共享包）
 * 5. 读**该板块**的反馈（WHERE section = $section，验收 T6）
 * 6. 逐候选 ruleScore → fuseScore → reason
 * 7. MMR 重排（λ=0.7；无向量时诚实退回相关度排序）
 * ```
 *
 * ## 二次校验（规格 §3.7 末尾）
 *
 * 规格说缓存命中后要"返回前对每个 item 重新读一次 status，已失效的静默剔除"。
 * 本实现**每次请求都重新读库**（没有 Redis 缓存，见下），
 * 因此这一步是**内建**的：候选集本身就是刚从 DB 读出来的，
 * 且 `scoreCandidates` 会再跑一次 F1/F2。不存在"推荐列表里有已满活动"的问题。
 *
 * ## 为什么没有 Redis 缓存（有意偏离，记入交付说明）
 *
 * 规格 §3.7 要求 15 分钟 TTL 的 Redis 缓存。本仓 `docker-compose.yml` 里有
 * Redis 7，但 `services/api/package.json` **没有**任何 Redis 客户端依赖，
 * 也没有别的模块在用缓存。为了不引入一个新的运行时依赖、以及一段无法验证的
 * 缓存命中/失效逻辑，本实现选择**每次实时计算** —— 规格 §2.7 自己也说
 * "在只有几千用户、几百活跃帖子的规模下，实时算更快也更简单"。
 *
 * ## MMR 在 vector 档的取舍（诚实说明）
 *
 * MMR 需要**候选自己的向量**。`hash` 档可以就地算（纯计算，与写库的值一致）；
 * `vector` 档则要再查一次库把 embedding 读回来。本实现选择**不为 MMR 再查一次**：
 * `vector` 档下 MMR 退化为相关度排序，而 `hash` 档下 MMR 真正生效。
 * 理由：多一次全候选量的向量读取（每条 768 维文本）换来的是排序多样性，
 * 而当前规模下 `hash` 才是默认档；等 `vector` 档真的上线（需要 Worker，规格 U4）
 * 再按实测决定是否加这次查询。
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  overlapsAvailability,
  type BuddySection,
  type FeedbackRecord,
  type MatchMode,
} from '@kedaya/shared';
import { activitiesOf } from '../domain/section';
import { TIME_ORDER_REASON } from '../domain/reason';
import { scoreCandidates, type MatchCandidate } from '../domain/matching';
import { skillRank } from '../domain/tags';
import { isActiveApplication } from '../domain/buddy-application.state';
import {
  BUDDY_FEEDBACK_REPOSITORY,
  BUDDY_POST_REPOSITORY,
  BUDDY_PROFILE_REPOSITORY,
  toMatchSubject,
  type BuddyFeedbackRepository,
  type BuddyPostModel,
  type BuddyPostRepository,
  type BuddyProfileModel,
  type BuddyProfileRepository,
  type PostWithCreator,
} from '../domain/buddy.domain';
import { BuddyMatchingService } from './buddy-matching.service';

/** `durationMin` 缺失时的兜底时长（分钟），用于 F7 的时间窗判定 */
export const DEFAULT_DURATION_MIN = 60;

export interface RecommendItem {
  post: {
    id: string;
    title: string;
    activity: string;
    startsAt: string;
    location: string;
    tags: string[];
    status: string;
    capacity: number;
    joinedCount: number;
  };
  /** 保留 3 位小数（对齐 `matching.py:466`） */
  score: number;
  /** 中文理由，**保证非空**（验收 T35） */
  reason: string;
}

export interface RecommendResult {
  /** `vector` / `hash` / `rule`。**必须暴露**，让前端能诚实展示（规格 §5.7） */
  matchMode: MatchMode;
  items: RecommendItem[];
  nextCursor: null;
}

/** 候选：帖子 + （仅向量档）余弦距离 */
interface Candidate {
  row: PostWithCreator;
  distance?: number;
}

@Injectable()
export class BuddyRecommendService {
  constructor(
    @Inject(BUDDY_PROFILE_REPOSITORY) private readonly profiles: BuddyProfileRepository,
    @Inject(BUDDY_POST_REPOSITORY) private readonly posts: BuddyPostRepository,
    @Inject(BUDDY_FEEDBACK_REPOSITORY) private readonly feedbacks: BuddyFeedbackRepository,
    @Inject(BuddyMatchingService) private readonly matching: BuddyMatchingService,
  ) {}

  async recommend(userId: string, section: BuddySection, limit: number): Promise<RecommendResult> {
    const now = new Date();
    const activities = activitiesOf(section);

    const profile = await this.profiles.findByUserId(userId);

    // —— 1. 没有资料 / 未开启匹配 → rule 档，按时间排序（验收 T11）——
    // 这保证"没填资料也能用"（规格 §5.7 末段）。
    if (!profile || !profile.matchEnabled) {
      const fallback = await this.posts.findRuleCandidates(activities, this.poolSize(limit), now);
      return {
        matchMode: 'rule',
        items: fallback.slice(0, limit).map((item) => this.timeOrderedItem(item.post)),
        nextCursor: null,
      };
    }

    // —— 2/3. 解析模式并取"我的向量" ——
    let mode = this.matching.mode;
    let embedding: number[] | null = null;

    if (mode !== 'rule') {
      embedding = await this.matching.viewerEmbedding(profile);
      // 读不到我的向量（vector 档但 Worker 还没算过）→ 整次请求降级为 rule。
      if (!embedding) mode = 'rule';
    }

    const candidates: Candidate[] =
      mode === 'rule'
        ? (await this.posts.findRuleCandidates(activities, this.poolSize(limit), now)).map((row) => ({ row }))
        : await this.vectorCandidates(embedding as number[], activities, now);

    // —— 4–7. 硬过滤 + 打分 + 融合 + MMR（算法在共享包，编排在 domain/matching.ts）——
    const postIds = candidates.map((item) => item.row.post.id);
    const [statuses, feedbacks, creatorProfiles] = await Promise.all([
      this.posts.findMyApplicationStatuses(userId, postIds),
      // ⚠️ section 是**查询条件**（规格 §3.6 / 验收 T6）：
      // academic 的 dislike 绝不能影响 daily 的排序。
      this.feedbacks.listByUserAndSection(userId, section),
      this.profiles.findEnabledByUserIds(candidates.map((item) => item.row.post.creatorId)),
    ]);

    const scored = scoreCandidates({
      section,
      me: toMatchSubject(profile, []),
      viewerId: userId,
      viewerSkillLevel: profile.skillLevel,
      candidates: candidates.map((item) =>
        this.toMatchCandidate(
          item,
          profile,
          statuses.get(item.row.post.id),
          mode,
          creatorProfiles.get(item.row.post.creatorId),
        ),
      ),
      feedbacks: feedbacks as FeedbackRecord[],
      mode,
      now,
      mmrLambda: this.matching.config.BUDDY_MMR_LAMBDA,
      limit,
      skillRank,
    });

    const byId = new Map(candidates.map((item) => [item.row.post.id, item.row.post]));
    const items: RecommendItem[] = [];
    for (const match of scored.items) {
      const post = byId.get(match.postId);
      if (!post) continue;
      items.push({ post: this.postBrief(post), score: match.score, reason: match.reason });
    }

    return { matchMode: mode, items, nextCursor: null };
  }

  /**
   * vector / hash 档候选：`<=>` 余弦召回，再补全帖子与发起人。
   *
   * 顺序按距离升序（`<=>` 越小越相似）。
   */
  private async vectorCandidates(
    embedding: number[],
    activities: string[],
    now: Date,
  ): Promise<Candidate[]> {
    const hits = await this.matching.findSimilarPosts(embedding, activities, this.poolSize(0));
    if (hits.length === 0) return [];

    const distanceById = new Map(hits.map((hit) => [hit.postId, hit.distance]));
    const rows = await this.posts.findByIds(hits.map((hit) => hit.postId));

    return rows
      .map((row) => ({ row, distance: distanceById.get(row.post.id) ?? 1 }))
      .filter(
        (entry) =>
          entry.row.post.status === 'OPEN' && entry.row.post.startsAt.getTime() > now.getTime(),
      )
      .sort((a, b) => (a.distance as number) - (b.distance as number));
  }

  /** 候选池上限（规格 §3.1 第 3 步的 200） */
  private poolSize(limit: number): number {
    return Math.max(this.matching.config.BUDDY_CANDIDATE_POOL, limit);
  }

  private toMatchCandidate(
    candidate: Candidate,
    profile: BuddyProfileModel,
    applicationStatus: string | undefined,
    mode: MatchMode,
    creatorProfile: BuddyProfileModel | undefined,
  ): MatchCandidate {
    const post = candidate.row.post;
    const durationMin = post.durationMin ?? DEFAULT_DURATION_MIN;

    return {
      post: {
        id: post.id,
        title: post.title,
        activity: post.activity,
        startsAt: post.startsAt,
        location: post.location,
        tags: post.tags,
        status: post.status,
        joinedCount: post.joinedCount,
        capacity: post.capacity,
        creatorId: post.creatorId,
        durationMin: post.durationMin,
        minSkillLevel: post.minSkillLevel,
      },
      // 发起人特征：只用 matchEnabled=true 的资料（仓储已过滤掉其余），
      // 帖子的公开 tags 一定参与（规格 §2.3："tags 是匹配打分的主特征"）。
      creator: toMatchSubject(creatorProfile, post.tags),
      distance: candidate.distance,
      // MMR 用候选自己的向量。hash 档就地算（纯计算，与写库的值完全一致）；
      // vector 档刻意不为此再查一次库（见文件头"MMR 在 vector 档的取舍"）。
      vector: mode === 'hash' ? this.matching.hashVectorOf(this.matching.postTextOf(post)) : undefined,
      alreadyApplied: applicationStatus ? isActiveApplication(applicationStatus) : false,
      // F5：性别准入在**申请**路径判定（`join`）。推荐路径不做过滤 ——
      // 本仓不采集性别，判定只能保守放行（见 buddy-application.service.ts 的注释）。
      genderCompatible: true,
      availabilityOverlaps: overlapsAvailability(profile.availability, post.startsAt, durationMin),
    };
  }

  private postBrief(post: BuddyPostModel): RecommendItem['post'] {
    return {
      id: post.id,
      title: post.title,
      activity: post.activity,
      startsAt: post.startsAt.toISOString(),
      location: post.location,
      tags: [...post.tags],
      status: post.status,
      capacity: post.capacity,
      joinedCount: post.joinedCount,
    };
  }

  /** 未开启匹配时的条目：score 0、reason "按时间排序"（规格 §5.7 末段） */
  private timeOrderedItem(post: BuddyPostModel): RecommendItem {
    return { post: this.postBrief(post), score: 0, reason: TIME_ORDER_REASON };
  }
}
