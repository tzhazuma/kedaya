/**
 * 找搭子 · 资料用例（规格 §2.2 / §6.3，验收 T30）
 *
 * ## 隐私要点（这一段是本文件的规格）
 *
 * - `matchEnabled` **默认 false**：匹配需要把"我的兴趣/可用时段"交给算法，
 *   属于对个人信息的新用途，不默认开启（规格 §6.3）。
 * - `DELETE` 是**硬删该行**（含 embedding），立即从推荐池移除。
 * - `GET` 只返回**我自己**的资料，且不含 `embedding` / `embeddingModel` / `userId`。
 * - `BuddyProfile` 对**任何人**都不可见，包括发帖人（规格 §6.1）。
 */

import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/app-error';
import { toProfileView, type ProfileView } from '../domain/views';
import {
  BUDDY_PROFILE_REPOSITORY,
  type BuddyProfileModel,
  type BuddyProfileRepository,
  type UpsertBuddyProfileInput,
} from '../domain/buddy.domain';
import { BuddyMatchingService } from './buddy-matching.service';

@Injectable()
export class BuddyProfileService {
  constructor(
    @Inject(BUDDY_PROFILE_REPOSITORY) private readonly profiles: BuddyProfileRepository,
    @Inject(BuddyMatchingService) private readonly matching: BuddyMatchingService,
  ) {}

  /**
   * 读我的匹配资料。
   *
   * 不存在时返回 `NOT_FOUND` 而不是"空资料"：
   * 空资料会被客户端渲染成"你已填写 0 项"，掩盖"你还没创建"这个事实。
   */
  async get(userId: string): Promise<ProfileView> {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) throw new NotFoundError('还没有匹配资料，先填一份吧');
    return toProfileView(profile);
  }

  /** 整体替换（PUT）。写入后按当前模式维护 embedding。 */
  async put(userId: string, input: UpsertBuddyProfileInput): Promise<ProfileView> {
    const saved = await this.profiles.upsert(userId, input);
    // hash 档就地算向量；rule 档 no-op；vector 档等 Worker（见 BuddyMatchingService 文件头）
    await this.matching.ensureProfileEmbedding(userId, saved);
    return toProfileView(saved);
  }

  /**
   * 删除匹配资料（规格 §6.3 的"可随时撤回"）。
   *
   * 先清 embedding 再删行：这样即使行删除因某种原因没执行，
   * 向量也已经不在了（验收 T30 要求"embedding 列已置 NULL"）。
   * 幂等：没有资料时也返回成功（DELETE 的语义）。
   */
  async remove(userId: string): Promise<void> {
    await this.matching.clearEmbeddingFor(userId);
    await this.profiles.remove(userId);
  }

  /** 供推荐服务使用：读资料（可能为 null） */
  async findForMatching(userId: string): Promise<BuddyProfileModel | null> {
    return this.profiles.findByUserId(userId);
  }
}
