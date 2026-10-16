/**
 * 找搭子 · 申请用例（规格 §5.5 / §5.6 / §6.1，验收 T22 / T23）
 *
 * 本文件只做**结果翻译**：把 data 层在事务+行锁里得出的 `JoinOutcome` /
 * `DecideOutcome` 翻成契约错误码。业务判断（名额、状态、身份）都在
 * `buddy-application.repository.ts` 的锁内完成 —— 那是唯一能保证
 * "检查与写入之间没有别人插进来"的位置。
 *
 * ## 错误码映射（逐条对应规格 §5.5 / §5.6 的错误表）
 *
 * | 结果 | HTTP | code | details.reason |
 * | --- | --- | --- | --- |
 * | POST_NOT_FOUND | 404 | NOT_FOUND | — |
 * | POST_NOT_OPEN | 409 | CONFLICT | POST_NOT_OPEN |
 * | POST_FULL | 409 | CONFLICT | POST_FULL |
 * | ALREADY_APPLIED | 409 | CONFLICT | ALREADY_APPLIED |
 * | CANNOT_JOIN_OWN_POST | 409 | CONFLICT | CANNOT_JOIN_OWN_POST |
 * | NOT_CREATOR | 403 | FORBIDDEN | — |
 * | APPLICATION_NOT_PENDING | 409 | CONFLICT | APPLICATION_NOT_PENDING |
 *
 * 规格 §5.5 还列了两个 403：`GENDER_PREFERENCE_MISMATCH` 与
 * `SKILL_LEVEL_TOO_LOW`。**两者当前都不可达**，理由见 `genderCompatible` 与
 * `skillLevelOk` 的注释 —— 这是数据可得性问题，不是实现遗漏。
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors/app-error';
import { skillRank } from '../domain/tags';
import { toApplicationView, type ApplicationView } from '../domain/views';
import {
  BUDDY_APPLICATION_REPOSITORY,
  BUDDY_NOTIFIER,
  BUDDY_POST_REPOSITORY,
  BUDDY_PROFILE_REPOSITORY,
  type BuddyApplicationRepository,
  type BuddyNotifierPort,
  type BuddyPostRepository,
  type BuddyProfileRepository,
} from '../domain/buddy.domain';

export interface DecideResult {
  application: ApplicationView;
  post: { id: string; status: string; joinedCount: number; capacity: number };
}

export interface MyApplicationItem {
  application: ApplicationView;
  post: { id: string; title: string; activity: string; startsAt: string; status: string; location: string };
}

@Injectable()
export class BuddyApplicationService {
  constructor(
    @Inject(BUDDY_APPLICATION_REPOSITORY) private readonly applications: BuddyApplicationRepository,
    @Inject(BUDDY_POST_REPOSITORY) private readonly posts: BuddyPostRepository,
    @Inject(BUDDY_PROFILE_REPOSITORY) private readonly profiles: BuddyProfileRepository,
    @Inject(BUDDY_NOTIFIER) private readonly notifier: BuddyNotifierPort,
  ) {}

  /**
   * 申请加入。
   *
   * 名额与身份检查在**锁内**（规格 §5.5 硬要求：不得"先查后写"，会超员）。
   * 注意 `join` **不递增** `joinedCount` —— 它是申请，不是入队。
   */
  async join(postId: string, applicantId: string, message?: string | null): Promise<ApplicationView> {
    // 先做两个"读得到、锁外"的准入检查：它们不需要事务
    // （即使并发下状态变了，锁内还会再查一次，不会放过任何人）。
    await this.assertAdmissible(postId, applicantId);

    const outcome = await this.applications.createLocked({ postId, applicantId, message });

    if (outcome.kind === 'FAILED') {
      switch (outcome.reason) {
        case 'POST_NOT_FOUND':
          throw new NotFoundError('活动不存在或已被删除');
        case 'POST_NOT_OPEN':
          throw new ConflictError('这个活动已经不能申请了', { reason: 'POST_NOT_OPEN' });
        case 'POST_FULL':
          throw new ConflictError('这个活动已经满员了', { reason: 'POST_FULL' });
        case 'ALREADY_APPLIED':
          throw new ConflictError('你已经申请过这个活动了', { reason: 'ALREADY_APPLIED' });
        case 'CANNOT_JOIN_OWN_POST':
          throw new ConflictError('不能申请自己发布的活动', { reason: 'CANNOT_JOIN_OWN_POST' });
        default:
          throw new ConflictError('无法申请该活动');
      }
    }

    return toApplicationView(outcome.application);
  }

  /**
   * 准入检查（F5 / F6 对应的两个 403）。
   *
   * ## 诚实说明：这两条检查当前**永远不会命中**
   *
   * - `GENDER_PREFERENCE_MISMATCH`：`genderPreference` 是契约冻结的准入约束，
   *   但**本仓没有任何地方采集性别**（`User` 没有 gender 字段，`BuddyProfile`
   *   按规格 §6.3 明确不采集）。拿不到我的性别就无法判定，只能保守放行。
   *   一旦 `profile` 模块提供该字段，把 `myGender` 填上即可生效 ——
   *   判定逻辑本身在 `isGenderCompatible` 里且已被单测覆盖。
   * - `SKILL_LEVEL_TOO_LOW`：**已实现且可达**（读我的 `BuddyProfile.skillLevel`
   *   与帖子的 `minSkillLevel` 比序），没有资料时按"无等级"放行
   *   （不因为用户没填资料就禁止他参加运动活动）。
   */
  private async assertAdmissible(postId: string, applicantId: string): Promise<void> {
    const found = await this.posts.findById(postId);
    if (!found) throw new NotFoundError('活动不存在或已被删除');

    // F5：性别准入。**当前不可达**（见方法注释）。
    if (!isGenderCompatible(found.post.genderPreference, null, null)) {
      throw new ForbiddenError('这个活动的性别要求与你不符', {
        reason: 'GENDER_PREFERENCE_MISMATCH',
      });
    }

    // F6：运动水平准入（仅 sport）。没有资料时不拦。
    if (found.post.minSkillLevel) {
      const profile = await this.profiles.findByUserId(applicantId);
      const myLevel = profile?.skillLevel ?? null;
      if (myLevel && skillRank(myLevel) < skillRank(found.post.minSkillLevel)) {
        throw new ForbiddenError('这个活动要求的运动水平比你高', { reason: 'SKILL_LEVEL_TOO_LOW' });
      }
    }
  }

  /** 撤回申请：`PENDING → WITHDRAWN` */
  async leave(postId: string, applicantId: string): Promise<ApplicationView> {
    const outcome = await this.applications.withdraw({ postId, applicantId });

    if (outcome.kind === 'FAILED') {
      switch (outcome.reason) {
        case 'POST_NOT_FOUND':
          throw new NotFoundError('活动不存在或已被删除');
        case 'APPLICATION_NOT_FOUND':
          throw new NotFoundError('你没有申请过这个活动');
        default:
          throw new ConflictError('当前状态不能撤回申请', { reason: 'APPLICATION_NOT_PENDING' });
      }
    }

    return toApplicationView(outcome.application);
  }

  /**
   * 接受 / 拒绝（仅发起人，验收 T23）。
   *
   * `ACCEPTED` 的副作用：`joinedCount += 1`；满员则 `status = FULL`；
   * 给申请人发通知（**载荷不含联系方式**，规格 §6.2 / U8）。
   */
  async decide(
    postId: string,
    applicationId: string,
    creatorId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<DecideResult> {
    const outcome = await this.applications.decideLocked({
      postId,
      applicationId,
      creatorId,
      decision,
    });

    if (outcome.kind === 'FAILED') {
      switch (outcome.reason) {
        case 'POST_NOT_FOUND':
          throw new NotFoundError('活动不存在或已被删除');
        case 'APPLICATION_NOT_FOUND':
          throw new NotFoundError('申请不存在');
        case 'NOT_CREATOR':
          throw new ForbiddenError('只有发起人可以处理申请');
        case 'APPLICATION_NOT_PENDING':
          throw new ConflictError('这条申请已经处理过了', { reason: 'APPLICATION_NOT_PENDING' });
        case 'POST_FULL':
          throw new ConflictError('这个活动已经满员了', { reason: 'POST_FULL' });
        default:
          throw new ConflictError('无法处理该申请');
      }
    }

    const post = outcome.post;
    const title = await this.titleOf(postId);

    if (outcome.kind === 'ACCEPTED') {
      await this.notifier.applicationAccepted({
        postId,
        creatorId,
        applicantId: outcome.application.applicantId,
        title,
      });
    } else {
      await this.notifier.applicationRejected({
        postId,
        creatorId,
        applicantId: outcome.application.applicantId,
        title,
      });
    }

    return {
      application: toApplicationView(outcome.application),
      post: {
        id: post.id,
        status: post.status,
        joinedCount: post.joinedCount,
        capacity: post.capacity,
      },
    };
  }

  /** 我的申请列表（规格 §5.1 端点 13） */
  async listMine(applicantId: string): Promise<MyApplicationItem[]> {
    const rows = await this.applications.listByApplicant(applicantId);
    return rows.map(({ application, post }) => ({
      application: toApplicationView(application),
      post: {
        id: post.id,
        title: post.title,
        activity: post.activity,
        startsAt: post.startsAt.toISOString(),
        status: post.status,
        location: post.location,
      },
    }));
  }

  /**
   * 某活动的申请列表。
   *
   * ⚠️ **仅发起人可见**（规格 §6.1 可见性矩阵："申请人列表：未登录 ❌ / 已登录他人 ❌ /
   * 发起人 ✅ / 申请人仅自己"）。
   *
   * ⚠️ 规格 §5.1 的端点总表**没有**这个端点，但矩阵要求它存在 ——
   * 否则 `decide` 无法使用（发起人拿不到 `applicationId`）。
   * 这是本模块对规格的**补充**，记入交付说明。
   */
  async listByPost(postId: string, viewerId: string): Promise<ApplicationView[]> {
    const found = await this.posts.findById(postId);
    if (!found) throw new NotFoundError('活动不存在或已被删除');
    if (found.post.creatorId !== viewerId) {
      // 不是发起人 → 403 而不是"空列表"：空列表会让"这个活动有 10 个申请人"
      // 变成一个可以推断出来的事实（枚举面，规格 §6.4）。
      throw new ForbiddenError('只有发起人可以看到申请人列表');
    }
    const rows = await this.applications.listByPost(postId);
    return rows.map(toApplicationView);
  }

  private async titleOf(postId: string): Promise<string> {
    const found = await this.posts.findById(postId);
    return found?.post.title ?? '活动';
  }
}

/**
 * 性别准入判定（规格 §3.3 F5）。
 *
 * 语义：`genderPreference` 是**发起人的准入约束**，不是打分特征（规格 §1.2 N5）。
 * - `any` → 总是相容；
 * - `same` → 需要双方性别都已知且相同；
 * - `other` → 需要双方性别都已知且不同；
 * - **任一方性别未知 → 相容**（保守放行）。
 *
 * 最后一条是刻意的：本仓没有任何地方采集性别（规格 §6.3 明确不采集），
 * 如果"未知"判定为不相容，所有 `same`/`other` 的活动将**无法被任何人申请** ——
 * 那是比"放行"严重得多的产品故障。
 */
export function isGenderCompatible(
  preference: string,
  myGender: string | null,
  creatorGender: string | null,
): boolean {
  if (preference === 'any' || !preference) return true;
  if (!myGender || !creatorGender) return true;
  if (preference === 'same') return myGender === creatorGender;
  if (preference === 'other') return myGender !== creatorGender;
  return true;
}
