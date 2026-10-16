/**
 * 找搭子 · 匹配模式与向量的编排（规格 §3.5 / §4.4）
 *
 * 三件事：
 *   1. **启动自检**（`OnModuleInit`）：探测 pgvector / embedding 列 →
 *      `resolveMatchingMode` → 降级时打 WARN，**绝不抛异常**（契约 §8 启动不阻塞）。
 *   2. 把"实际生效的模式"暴露给推荐服务与响应（`matchMode` 字段必须诚实）。
 *   3. **hash 档的向量生成**：无模型时用共享包的 `hashVector`。
 *
 * ## 关于 `vector` 档的 embedding 从哪来（诚实说明）
 *
 * 规格 §4.4 明确："不在请求路径上做 embedding 推理，否则发布帖子的 P95
 * 会被模型推理拖到秒级"，embedding 由 **Worker 异步生成**。
 * 本仓**没有**这个 Worker，也**没有**中文 embedding 模型的实现（规格 U4：
 * "本规格默认 hash，未做实测"）。因此：
 *
 * - `hash` 档：本服务**就地**生成（`hashVector` 是 O(文本长度) 的纯计算，
 *   不是模型推理，放在请求路径上没有问题）；
 * - `vector` 档：本服务**只读**已存的向量。读不到时推荐服务会把该次请求
 *   降级到 `rule` 并把 `matchMode` 报成 `rule`（**不混用** hash 向量与真向量 ——
 *   两种向量空间不同，混用得到的相似度毫无意义）。
 *
 * 这样 `vector` 档的代码路径在测试里是可达的（DB 测试直接注入真向量），
 * 而生产上它需要先有一个 Worker —— 这条依赖写进交付说明，不假装已完成。
 */

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashVector, profileText, type MatchMode } from '@kedaya/shared';
import { readBuddyConfig, type BuddyConfig } from '../../../config/buddy.config';
import {
  BUDDY_CAPABILITY_PROBE,
  BUDDY_PROFILE_REPOSITORY,
  BUDDY_VECTOR_REPOSITORY,
  type BuddyCapabilityProbePort,
  type BuddyPostModel,
  type BuddyProfileModel,
  type BuddyProfileRepository,
  type BuddyVectorRepository,
  type VectorCandidate,
} from '../domain/buddy.domain';
import { resolveMatchingMode, type ResolvedMatchingMode } from '../domain/matching-mode';

/** hash 档写入 `embeddingModel` 的标识。模型变更时据此判断是否需要重算。 */
export const HASH_EMBEDDING_MODEL = 'hash-v1';

@Injectable()
export class BuddyMatchingService implements OnModuleInit {
  private readonly logger = new Logger(BuddyMatchingService.name);
  readonly config: BuddyConfig;

  /** 启动时算出的实际模式；在 `onModuleInit` 之前默认取配置里的请求值 */
  private resolved: ResolvedMatchingMode;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(BUDDY_CAPABILITY_PROBE) private readonly probe: BuddyCapabilityProbePort,
    @Inject(BUDDY_VECTOR_REPOSITORY) private readonly vectors: BuddyVectorRepository,
    @Inject(BUDDY_PROFILE_REPOSITORY) private readonly profiles: BuddyProfileRepository,
  ) {
    this.config = readBuddyConfig(config);
    this.resolved = {
      requested: this.config.BUDDY_MATCHING_MODE,
      effective: this.config.BUDDY_MATCHING_MODE,
      degraded: false,
      reason: null,
    };
  }

  /**
   * 启动自检。
   *
   * ⚠️ **任何异常都必须被吞掉**：数据库连不上时 `probe()` 内部已兜底，
   * 但这里再加一层 try/catch —— 启动路径上的异常会让整个 API 起不来，
   * 而 buddy 是低敏感模块，它没有这个权力（契约 §8）。
   */
  async onModuleInit(): Promise<void> {
    try {
      const caps = await this.probe.probe();
      this.resolved = resolveMatchingMode(this.config.BUDDY_MATCHING_MODE, {
        hasPgvectorExtension: caps.hasPgvectorExtension,
        hasEmbeddingColumn: caps.hasEmbeddingColumn,
        hasEmbeddingModel: this.config.BUDDY_EMBEDDING_MODEL.length > 0,
      });

      if (this.resolved.degraded) {
        this.logger.warn(
          `匹配模式已降级：请求 ${this.resolved.requested} → 生效 ${this.resolved.effective}（${this.resolved.reason}）`,
        );
      } else {
        this.logger.log(`匹配模式：${this.resolved.effective}`);
      }
    } catch (error) {
      this.resolved = {
        requested: this.config.BUDDY_MATCHING_MODE,
        effective: 'rule',
        degraded: true,
        reason: `启动自检异常，已按最低档 rule 运行：${error instanceof Error ? error.message : String(error)}`,
      };
      this.logger.warn(this.resolved.reason ?? '启动自检异常');
    }
  }

  /** 实际生效的模式（响应里的 `matchMode` 必须用它，而不是配置值） */
  get mode(): MatchMode {
    return this.resolved.effective;
  }

  get resolution(): ResolvedMatchingMode {
    return this.resolved;
  }

  get vectorDim(): number {
    return this.config.BUDDY_VECTOR_DIM;
  }

  /** 资料的画像文本（规格 §3.5 的 `buildProfileText`，只用匹配特征） */
  profileTextOf(profile: BuddyProfileModel): string {
    return profileText({
      bio: profile.bio,
      interestTags: profile.interestTags,
      activityTags: profile.activityTags,
    });
  }

  /**
   * 帖子的画像文本。
   *
   * ⚠️ 标题被折进 `description` 槽位：共享包的 `profileText` 没有 `title` 参数，
   * 而规格 §3.5 的 `buildProfileText` 要求拼入 `post.title`。
   * 在这里再写一个文本构造器会制造**第二个真相**（共享包那份是给客户端用的），
   * 所以选择复用同一个函数、把标题并进唯一的自由文本槽位。
   */
  postTextOf(post: Pick<BuddyPostModel, 'title' | 'description' | 'tags'>): string {
    return profileText({
      description: [post.title, post.description ?? ''].filter(Boolean).join(' '),
      tags: post.tags,
    });
  }

  /** hash 档：就地算向量（纯计算，不是模型推理） */
  hashVectorOf(text: string): number[] {
    return hashVector(text, this.config.BUDDY_VECTOR_DIM);
  }

  /**
   * 取"我的画像向量"。
   *
   * - `rule` 档 → `null`（没有向量可言，权重归零）
   * - `hash` 档 → 就地算（不依赖 DB 里有没有存过）
   * - `vector` 档 → 读已存的真向量；读不到返回 `null`，
   *   由调用方把该次请求降级为 `rule`（**不混用两种向量空间**）
   */
  async viewerEmbedding(profile: BuddyProfileModel): Promise<number[] | null> {
    if (this.mode === 'rule') return null;
    if (this.mode === 'hash') return this.hashVectorOf(this.profileTextOf(profile));
    return this.vectors.findProfileEmbedding(profile.userId);
  }

  /**
   * 保证资料行里有向量（`hash` 档写入；其他档是 no-op）。
   *
   * `rule` 档是 no-op 因为"没有 embedding 列"；`vector` 档是 no-op 因为
   * 真模型推理属于 Worker（规格 §4.4），不在请求路径上。
   */
  async ensureProfileEmbedding(userId: string, profile: BuddyProfileModel): Promise<void> {
    if (this.mode !== 'hash') return;
    const vector = this.hashVectorOf(this.profileTextOf(profile));
    await this.vectors.setProfileEmbedding(userId, vector, HASH_EMBEDDING_MODEL);
  }

  /**
   * 保证帖子行里有向量（`hash` 档写入；其他档是 no-op，理由同上）。
   */
  async ensurePostEmbedding(
    post: Pick<BuddyPostModel, 'id' | 'title' | 'description' | 'tags'>,
  ): Promise<void> {
    if (this.mode !== 'hash') return;
    const vector = this.hashVectorOf(this.postTextOf(post));
    await this.vectors.setPostEmbedding(post.id, vector, HASH_EMBEDDING_MODEL);
  }

  /**
   * 余弦距离召回候选（`<=>` + 参数绑定，规格 §4.4）。
   *
   * 透传给向量仓储而不是让调用方直接注入仓储：推荐服务只需要"拿候选"，
   * 不需要知道 pgvector 的存在。
   */
  async findSimilarPosts(
    embedding: readonly number[],
    activities: readonly string[],
    limit: number,
  ): Promise<VectorCandidate[]> {
    return this.vectors.findSimilarPosts(embedding, activities, limit);
  }

  /**
   * 清空资料的向量（撤回匹配资料时用，验收 T30）。
   *
   * `rule` 档是 no-op：那个档位下 `embedding` **列不存在**（没有 pgvector），
   * 执行 `UPDATE ... SET embedding = NULL` 会直接报错 ——
   * 一个"撤回资料"的动作不该因为数据库没装扩展而失败。
   */
  async clearEmbeddingFor(userId: string): Promise<void> {
    if (this.mode === 'rule') return;
    await this.vectors.clearProfileEmbedding(userId);
  }
}
