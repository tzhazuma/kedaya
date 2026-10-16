/**
 * 找搭子 · data 层：申请（含行锁事务）/ 反馈 / 问卷 / 通知
 *
 * ## 并发正确性（规格 §5.5 / §5.6，验收 T22）——本文件的重点
 *
 * `join` 与 `decide` **必须**在一个事务里 `SELECT ... FOR UPDATE` 锁 `BuddyPost` 行，
 * 再检查/递增 `joinedCount`。**不得**用"先查后写"（会超员）。
 *
 * 两处容易写错的地方，这里显式写清楚：
 *
 * 1. **`join` 不递增 `joinedCount`**。`join` 是"申请"不是"入队"，
 *    名额在 `decide(ACCEPTED)` 时才递增。锁仍然必要：它防止
 *    "只剩 1 个名额但有 10 人同时申请"时发起人误接受超员。
 * 2. **`decide(ACCEPTED)` 必须重新在锁内检查名额**。申请提交时名额够，
 *    不代表接受时还够 —— 中间可能有别的申请被接受。这是 T22 的核心。
 *
 * ## 行锁为什么放在 data 层
 *
 * 锁是**数据库能力**，不是业务规则。把它放进 service 就得让 service 拿着
 * `tx` 对象（从而 import Prisma，违反契约 §7 的分层）。因此端口方法的语义是
 * "在事务里完成这件事"，返回一个**领域结果**（`JoinOutcome` / `DecideOutcome`），
 * service 只负责把结果翻译成契约错误码。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { FeedbackRecord } from '@kedaya/shared';
import { canTransition } from '../domain/buddy-post.state';
import type { BuddySection } from '../domain/section';
import {
  type BuddyApplicationModel,
  type BuddyApplicationRepository,
  type BuddyFeedbackModel,
  type BuddyFeedbackRepository,
  type BuddyNotifierPort,
  type BuddyPostModel,
  type BuddyQuestionnaireModel,
  type BuddyQuestionnaireRepository,
  type BuddyQuestionnaireResponseModel,
  type DecideOutcome,
  type JoinOutcome,
  type LeaveOutcome,
} from '../domain/buddy.domain';
import { toPostModel } from './buddy.repository';

/* ------------------------------------------------------------------ *
 * 行 → 领域模型
 * ------------------------------------------------------------------ */

interface ApplicationRow {
  id: string;
  postId: string;
  applicantId: string;
  status: string;
  message: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LockedPostRow {
  id: string;
  creatorId: string;
  status: string;
  capacity: number;
  joinedCount: number;
}

export function toApplicationModel(row: ApplicationRow): BuddyApplicationModel {
  return {
    id: row.id,
    postId: row.postId,
    applicantId: row.applicantId,
    status: row.status,
    message: row.message,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ *
 * 申请
 * ------------------------------------------------------------------ */

@Injectable()
export class BuddyApplicationPrismaRepository implements BuddyApplicationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 锁住帖子行。返回 `null` 表示帖子不存在/已删除。
   *
   * `FOR UPDATE` 是**悲观行锁**：并发 join/decide 在这里串行化。
   * 这条 SQL 是参数绑定的（`${postId}` → `$1`），不是字符串拼接。
   */
  private async lockPost(tx: Prisma.TransactionClient, postId: string): Promise<LockedPostRow | null> {
    const rows = await tx.$queryRaw<LockedPostRow[]>(Prisma.sql`
      SELECT "id", "creatorId", "status", "capacity", "joinedCount"
      FROM "BuddyPost"
      WHERE "id" = ${postId} AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  async createLocked(input: {
    postId: string;
    applicantId: string;
    message?: string | null;
  }): Promise<JoinOutcome> {
    const { postId, applicantId, message } = input;

    return this.prisma.$transaction(async (tx) => {
      const post = await this.lockPost(tx, postId);
      if (!post) return { kind: 'FAILED', reason: 'POST_NOT_FOUND' } as JoinOutcome;
      if (post.creatorId === applicantId) return { kind: 'FAILED', reason: 'CANNOT_JOIN_OWN_POST' };
      if (post.status !== 'OPEN') return { kind: 'FAILED', reason: 'POST_NOT_OPEN' };
      if (post.joinedCount >= post.capacity) return { kind: 'FAILED', reason: 'POST_FULL' };

      const existing = (await tx.buddyApplication.findUnique({
        where: { postId_applicantId: { postId, applicantId } },
      })) as ApplicationRow | null;

      if (existing && (existing.status === 'PENDING' || existing.status === 'ACCEPTED')) {
        return { kind: 'FAILED', reason: 'ALREADY_APPLIED' } as JoinOutcome;
      }

      // 撤回/被拒之后重新申请：**复用同一行**回 PENDING（规格 U7），
      // 而不是插新行 —— 唯一约束 (postId, applicantId) 在 DB 层挡着。
      if (existing) {
        const updated = (await tx.buddyApplication.update({
          where: { id: existing.id },
          data: { status: 'PENDING', message: message ?? null, decidedAt: null, decidedBy: null },
        })) as ApplicationRow;
        return { kind: 'REACTIVATED', application: toApplicationModel(updated) } as JoinOutcome;
      }

      const created = (await tx.buddyApplication.create({
        data: { postId, applicantId, status: 'PENDING', message: message ?? null },
      })) as ApplicationRow;
      return { kind: 'CREATED', application: toApplicationModel(created) } as JoinOutcome;
    });
  }

  async withdraw(input: { postId: string; applicantId: string }): Promise<LeaveOutcome> {
    const { postId, applicantId } = input;
    return this.prisma.$transaction(async (tx) => {
      const post = await this.lockPost(tx, postId);
      if (!post) return { kind: 'FAILED', reason: 'POST_NOT_FOUND' } as LeaveOutcome;

      const existing = (await tx.buddyApplication.findUnique({
        where: { postId_applicantId: { postId, applicantId } },
      })) as ApplicationRow | null;

      if (!existing) return { kind: 'FAILED', reason: 'APPLICATION_NOT_FOUND' } as LeaveOutcome;
      if (existing.status !== 'PENDING') {
        return { kind: 'FAILED', reason: 'APPLICATION_NOT_PENDING' } as LeaveOutcome;
      }

      const updated = (await tx.buddyApplication.update({
        where: { id: existing.id },
        data: { status: 'WITHDRAWN' },
      })) as ApplicationRow;
      return { kind: 'WITHDRAWN', application: toApplicationModel(updated) } as LeaveOutcome;
    });
  }

  async decideLocked(input: {
    postId: string;
    applicationId: string;
    creatorId: string;
    decision: 'ACCEPTED' | 'REJECTED';
  }): Promise<DecideOutcome> {
    const { postId, applicationId, creatorId, decision } = input;

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockPost(tx, postId);
      if (!locked) return { kind: 'FAILED', reason: 'POST_NOT_FOUND' } as DecideOutcome;
      if (locked.creatorId !== creatorId) return { kind: 'FAILED', reason: 'NOT_CREATOR' };

      const application = (await tx.buddyApplication.findUnique({
        where: { id: applicationId },
      })) as ApplicationRow | null;

      // 申请不存在 **或** 不属于这个帖子 → 都算 APPLICATION_NOT_FOUND：
      // 区分会让"用别的帖子的 applicationId 试探"变成信息泄漏面（规格 §6.4）。
      if (!application || application.postId !== postId) {
        return { kind: 'FAILED', reason: 'APPLICATION_NOT_FOUND' } as DecideOutcome;
      }
      if (application.status !== 'PENDING') {
        return { kind: 'FAILED', reason: 'APPLICATION_NOT_PENDING' } as DecideOutcome;
      }

      let joinedCount = locked.joinedCount;
      let status = locked.status;

      if (decision === 'ACCEPTED') {
        // ⚠️ 必须在**锁内**重新检查名额（验收 T22）：
        // 申请提交时够，不代表现在够 —— 中间可能有别的申请被接受。
        if (locked.joinedCount >= locked.capacity) {
          return { kind: 'FAILED', reason: 'POST_FULL' } as DecideOutcome;
        }
        joinedCount = locked.joinedCount + 1;
        status = joinedCount >= locked.capacity ? 'FULL' : locked.status;
      }

      const updatedApplication = (await tx.buddyApplication.update({
        where: { id: applicationId },
        data: { status: decision, decidedAt: new Date(), decidedBy: creatorId },
      })) as ApplicationRow;

      let updatedPost = locked as unknown as BuddyPostModel;
      if (joinedCount !== locked.joinedCount || status !== locked.status) {
        // 状态流转必须走纯函数（契约 `02-domain-model.md:36` 规则 2 / 验收 T3）。
        // 只有真的变状态时才写 status，避免自反转移（canTransition 一律 false）。
        if (status !== locked.status && !canTransition(locked.status, status)) {
          throw new Error(`BuddyPost 不允许的状态流转：${locked.status} → ${status}`);
        }
        const row = await tx.buddyPost.update({
          where: { id: postId },
          data: { joinedCount, ...(status !== locked.status ? { status } : {}) },
        });
        updatedPost = toPostModel(row as Parameters<typeof toPostModel>[0]);
      }

      return {
        kind: decision,
        application: toApplicationModel(updatedApplication),
        post: updatedPost,
      } as DecideOutcome;
    });
  }

  async listByApplicant(
    applicantId: string,
  ): Promise<Array<{ application: BuddyApplicationModel; post: BuddyPostModel }>> {
    const applications = (await this.prisma.buddyApplication.findMany({
      where: { applicantId },
      orderBy: { createdAt: 'desc' },
    })) as ApplicationRow[];
    if (applications.length === 0) return [];

    const posts = (await this.prisma.buddyPost.findMany({
      where: { id: { in: [...new Set(applications.map((row) => row.postId))] } },
    })) as Array<Parameters<typeof toPostModel>[0]>;
    const byId = new Map(posts.map((row) => [row.id, toPostModel(row)]));

    return applications
      .map((row) => {
        const post = byId.get(row.postId);
        return post ? { application: toApplicationModel(row), post } : null;
      })
      .filter((item): item is { application: BuddyApplicationModel; post: BuddyPostModel } => item !== null);
  }

  async listByPost(postId: string): Promise<BuddyApplicationModel[]> {
    const rows = (await this.prisma.buddyApplication.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
    })) as ApplicationRow[];
    return rows.map(toApplicationModel);
  }

  async findById(id: string): Promise<BuddyApplicationModel | null> {
    const row = (await this.prisma.buddyApplication.findUnique({ where: { id } })) as ApplicationRow | null;
    return row ? toApplicationModel(row) : null;
  }
}

/* ------------------------------------------------------------------ *
 * 反馈
 * ------------------------------------------------------------------ */

@Injectable()
export class BuddyFeedbackPrismaRepository implements BuddyFeedbackRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsert(input: {
    userId: string;
    targetPostId: string;
    section: BuddySection;
    action: string;
  }): Promise<BuddyFeedbackModel> {
    // UPSERT 语义由 DB 的唯一索引 (userId, targetPostId, section) 保证：
    // 覆盖而非累积（规格 D11）。不靠应用层"先查后写"。
    const row = (await this.prisma.buddyMatchFeedback.upsert({
      where: {
        userId_targetPostId_section: {
          userId: input.userId,
          targetPostId: input.targetPostId,
          section: input.section,
        },
      },
      create: {
        userId: input.userId,
        targetPostId: input.targetPostId,
        section: input.section,
        action: input.action,
      },
      update: { action: input.action },
    })) as {
      id: string;
      userId: string;
      targetPostId: string;
      section: string;
      action: string;
      createdAt: Date;
    };

    return {
      id: row.id,
      userId: row.userId,
      targetPostId: row.targetPostId,
      section: row.section,
      action: row.action,
      createdAt: row.createdAt,
    };
  }

  async listByUserAndSection(userId: string, section: BuddySection): Promise<FeedbackRecord[]> {
    // ⚠️ `section` 是查询条件的一部分，**不是**在内存里过滤（规格 §3.6 / 验收 T6）。
    // 在内存里过滤会让"跨板块污染"在上层看起来是对的，但代价是读全表。
    const rows = (await this.prisma.buddyMatchFeedback.findMany({
      where: { userId, section },
      orderBy: { createdAt: 'asc' },
    })) as Array<{ targetPostId: string; action: string; createdAt: Date }>;

    return rows.map((row) => ({
      targetPostId: row.targetPostId,
      action: row.action as FeedbackRecord['action'],
      createdAt: row.createdAt,
    }));
  }
}

/* ------------------------------------------------------------------ *
 * 问卷
 * ------------------------------------------------------------------ */

interface QuestionnaireRow {
  id: string;
  slug: string;
  title: string;
  section: string;
  description: string | null;
  questions: unknown;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface QuestionnaireResponseRow {
  id: string;
  questionnaireId: string;
  userId: string;
  answers: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BuddyQuestionnairePrismaRepository implements BuddyQuestionnaireRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActive(section?: BuddySection): Promise<BuddyQuestionnaireModel[]> {
    const rows = (await this.prisma.buddyQuestionnaire.findMany({
      where: { isActive: true, ...(section ? { section } : {}) },
      orderBy: { createdAt: 'asc' },
    })) as QuestionnaireRow[];
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      section: row.section,
      description: row.description,
      questions: row.questions,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async findBySlug(slug: string): Promise<BuddyQuestionnaireModel | null> {
    const row = (await this.prisma.buddyQuestionnaire.findUnique({
      where: { slug },
    })) as QuestionnaireRow | null;
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      section: row.section,
      description: row.description,
      questions: row.questions,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertResponse(input: {
    questionnaireId: string;
    userId: string;
    answers: unknown;
    version: number;
  }): Promise<BuddyQuestionnaireResponseModel> {
    const row = (await this.prisma.buddyQuestionnaireResponse.upsert({
      where: {
        questionnaireId_userId: {
          questionnaireId: input.questionnaireId,
          userId: input.userId,
        },
      },
      create: {
        questionnaireId: input.questionnaireId,
        userId: input.userId,
        answers: input.answers as object,
        version: input.version,
      },
      update: { answers: input.answers as object, version: input.version },
    })) as QuestionnaireResponseRow;

    return {
      id: row.id,
      questionnaireId: row.questionnaireId,
      userId: row.userId,
      answers: row.answers,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findResponse(
    questionnaireId: string,
    userId: string,
  ): Promise<BuddyQuestionnaireResponseModel | null> {
    const row = (await this.prisma.buddyQuestionnaireResponse.findUnique({
      where: { questionnaireId_userId: { questionnaireId, userId } },
    })) as QuestionnaireResponseRow | null;
    if (!row) return null;
    return {
      id: row.id,
      questionnaireId: row.questionnaireId,
      userId: row.userId,
      answers: row.answers,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/* ------------------------------------------------------------------ *
 * 通知（规格 §6.2）
 * ------------------------------------------------------------------ */

/**
 * 通知适配器。
 *
 * ⚠️ **只发"结果通知"，载荷里不带任何联系方式**（规格 U8）：
 * "匹配成功后可见的联系方式"字段属于 `profile` 模块，本模块拿不到它。
 * 把联系方式硬编码进通知 = 绕过 §6.2 的设计。
 */
@Injectable()
export class BuddyNotificationAdapter implements BuddyNotifierPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async applicationAccepted(input: {
    postId: string;
    creatorId: string;
    applicantId: string;
    title: string;
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: input.applicantId,
        title: '你的申请通过了',
        body: `「${input.title}」的发起人接受了你的申请，可以在活动页查看详情。`,
        channel: 'inapp',
      },
    });
  }

  async applicationRejected(input: {
    postId: string;
    creatorId: string;
    applicantId: string;
    title: string;
  }): Promise<void> {
    // ⚠️ **不给出拒绝理由**（规格 §5.6）：发起人无义务解释，
    // 且理由文本会成为骚扰面。这里连"被拒绝"都不写得刺眼。
    await this.prisma.notification.create({
      data: {
        userId: input.applicantId,
        title: '申请结果',
        body: `「${input.title}」这次没有通过，再看看其他活动吧。`,
        channel: 'inapp',
      },
    });
  }
}
