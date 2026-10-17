import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ReportTarget, ReportTargetType } from '../domain/reports.domain';

/**
 * 举报数据的落库端口 + 被举报对象的解析。
 *
 * ## 为什么要单独一个「解析器」
 *
 * 举报是**跨模块**的能力（跳蚤 / 跑腿 / 搭子 / 失物 / 论坛 × 帖子 / 回复）。
 * 两种做法：
 *   a) 让每个模块自己实现「我被举报时怎么处理」—— 六个模块各写一遍，
 *      新增模块必然忘记接；
 *   b) 由举报模块集中读取（本文件的 `resolveTarget`）—— 一处收口，
 *      新增模块只需要在这里加一个分支 + 白名单里加一个类型。
 *
 * 选 b。代价是举报模块直接依赖了业务表（跨模块读），
 * 换来的是「举报能不能用」只有一个答案，不会出现"论坛能举报、跑腿漏了"。
 * 即便如此也**只读**（authorId + title），不写业务表 ——
 * 下架是人工复核后的动作（见 domain 注释）。
 */

export interface CreateReportRecord {
  targetType: ReportTargetType;
  targetId: string;
  targetAuthorId: string | null;
  targetTitle: string;
  reporterId: string;
  reason: string;
  detail: string | null;
}

export interface ReportRecord {
  id: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  reason: string;
  detail: string | null;
  escalated: boolean;
  createdAt: Date;
}

export interface ReportRepository {
  /** 被举报对象是否存在；不存在返回 null（→ 404，而不是写一条垃圾举报） */
  resolveTarget(targetType: ReportTargetType, targetId: string): Promise<ReportTarget | null>;
  /** 该用户是否已经举报过这个对象（唯一索引的另一道可读化检查，便于给出友好错误） */
  findExisting(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ReportRecord | null>;
  create(record: CreateReportRecord): Promise<ReportRecord>;
  /** 该对象当前有多少**不同的人**举报过（用于阈值升级；含本次之前的历史，不含本次） */
  countDistinctReporters(targetType: ReportTargetType, targetId: string): Promise<number>;
  /** 把同一对象的全部举报记录标为已升级（阈值达成后一次性打标，避免重复扫描） */
  markEscalated(targetType: ReportTargetType, targetId: string): Promise<number>;
  listByReporter(reporterId: string, limit: number): Promise<ReportRecord[]>;
}

export const REPORT_REPOSITORY = Symbol('REPORT_REPOSITORY');

@Injectable()
export class ReportPrismaRepository implements ReportRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveTarget(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ReportTarget | null> {
    switch (targetType) {
      case 'flea-item': {
        const row = await this.prisma.fleaItem.findUnique({
          where: { id: targetId },
          select: { sellerId: true, title: true },
        });
        return row === null ? null : { authorId: row.sellerId, title: row.title };
      }
      case 'errand-task': {
        const row = await this.prisma.errandTask.findUnique({
          where: { id: targetId },
          select: { requesterId: true, title: true },
        });
        return row === null ? null : { authorId: row.requesterId, title: row.title };
      }
      case 'buddy-group': {
        const row = await this.prisma.buddyGroup.findUnique({
          where: { id: targetId },
          select: { ownerId: true, title: true },
        });
        return row === null ? null : { authorId: row.ownerId, title: row.title };
      }
      case 'lost-found-item': {
        const row = await this.prisma.lostFoundItem.findUnique({
          where: { id: targetId },
          select: { reporterId: true, title: true },
        });
        return row === null ? null : { authorId: row.reporterId, title: row.title };
      }
      case 'forum-post': {
        const row = await this.prisma.forumPost.findUnique({
          where: { id: targetId },
          select: { authorId: true, title: true },
        });
        // 匿名帖 authorId 为 null —— 不是"作者不存在"，仍然可以被举报
        return row === null ? null : { authorId: row.authorId, title: row.title };
      }
      case 'forum-reply': {
        const row = await this.prisma.forumReply.findUnique({
          where: { id: targetId },
          select: { authorId: true, body: true },
        });
        if (row === null) return null;
        // 回复没有标题：用正文前若干字做快照，复核时才知道举报的是哪一条
        return { authorId: row.authorId, title: [...row.body].slice(0, 40).join('') };
      }
      case 'canteen-dish': {
        const row = await this.prisma.canteenDish.findUnique({
          where: { id: targetId },
          select: { name: true, canteen: true },
        });
        // 共建条目没有作者字段：无从"不能举报自己"，也不需要
        return row === null ? null : { authorId: null, title: `${row.canteen} · ${row.name}` };
      }
      case 'faq-entry': {
        const row = await this.prisma.faqEntry.findUnique({
          where: { id: targetId },
          select: { question: true },
        });
        return row === null ? null : { authorId: null, title: row.question };
      }
      case 'wildlife-spot': {
        const row = await this.prisma.wildlifeSpot.findUnique({
          where: { id: targetId },
          select: { species: true, place: true, reportedBy: true },
        });
        return row === null
          ? null
          : { authorId: row.reportedBy, title: `${row.species} @ ${row.place}` };
      }
    }
  }

  async findExisting(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ReportRecord | null> {
    const row = await this.prisma.contentReport.findUnique({
      where: {
        reporterId_targetType_targetId: { reporterId, targetType, targetId },
      },
    });
    return row === null ? null : toRecord(row);
  }

  async create(record: CreateReportRecord): Promise<ReportRecord> {
    const row = await this.prisma.contentReport.create({ data: record });
    return toRecord(row);
  }

  async countDistinctReporters(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<number> {
    // distinct 是必须的：同一个人重复举报不能凑够阈值
    const rows = await this.prisma.contentReport.findMany({
      where: { targetType, targetId },
      select: { reporterId: true },
      distinct: ['reporterId'],
    });
    return rows.length;
  }

  async markEscalated(targetType: ReportTargetType, targetId: string): Promise<number> {
    const result = await this.prisma.contentReport.updateMany({
      where: { targetType, targetId, escalated: false },
      data: { escalated: true },
    });
    return result.count;
  }

  async listByReporter(reporterId: string, limit: number): Promise<ReportRecord[]> {
    const rows = await this.prisma.contentReport.findMany({
      where: { reporterId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }
}

/** Prisma 行 → 领域记录（集中在这里，避免每个方法各写一遍字段映射） */
function toRecord(row: {
  id: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  reason: string;
  detail: string | null;
  escalated: boolean;
  createdAt: Date;
}): ReportRecord {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    reason: row.reason,
    detail: row.detail,
    escalated: row.escalated,
    createdAt: row.createdAt,
  };
}
