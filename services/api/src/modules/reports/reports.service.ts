import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { truncateByCodePoint } from '../../common/text/truncate';
import {
  REPORT_ESCALATION_THRESHOLD,
  REPORT_REASON_LABELS,
  isReportReason,
  isReportTargetType,
  truncateReportDetail,
  type ReportModel,
  type ReportReason,
  type ReportTargetType,
} from './domain/reports.domain';
import { REPORT_REPOSITORY, type ReportRepository } from './data/reports.repository';

export interface CreateReportInput {
  targetType: string;
  targetId: string;
  reason: string;
  detail?: string;
}

/**
 * 举报服务。
 *
 * 这一层要做的是**把"提交举报"这件事做成可信的**：
 *   · 举报必须指向真实存在的内容（否则队列里全是垃圾，值班的人会直接放弃看队列）；
 *   · 同一个人不能对同一对象刷举报（唯一索引 + 可读的 409）；
 *   · 不能举报自己的内容（没有治理意义，只会污染统计）；
 *   · 达到阈值就**升级并打日志**（这是"及时处理"在没有人做后台时的可执行版本）。
 *
 * 刻意**不做**的：直接下架内容。理由见 domain 注释 —— 自动下架是能被武器化的。
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(@Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository) {}

  async create(reporterId: string, input: CreateReportInput): Promise<ReportModel> {
    const targetType = input.targetType.trim();
    const reason = input.reason.trim();
    const targetId = input.targetId.trim();

    // 白名单校验放在最前面：非法的 targetType 不该触发任何数据库查询
    if (!isReportTargetType(targetType)) {
      throw new ValidationError('不支持举报这类内容');
    }
    if (!isReportReason(reason)) {
      throw new ValidationError('请选择一个举报原因');
    }
    if (targetId.length === 0) {
      throw new ValidationError('缺少被举报内容的标识');
    }

    const target = await this.repository.resolveTarget(targetType, targetId);
    if (target === null) {
      // 内容已经被作者删掉（或 id 就是编的）：告诉举报人"内容不存在"，
      // 而不是默默收下 —— 后者会让用户以为举报成功了，实际什么都没发生。
      throw new NotFoundError('内容不存在或已被删除');
    }

    if (target.authorId !== null && target.authorId === reporterId) {
      throw new ValidationError('不能举报自己发布的内容');
    }

    const existing = await this.repository.findExisting(reporterId, targetType, targetId);
    if (existing !== null) {
      throw new ConflictError('你已经举报过这条内容，我们正在处理');
    }

    const detail = input.detail === undefined ? null : truncateReportDetail(input.detail.trim());

    const created = await this.repository.create({
      targetType,
      targetId,
      targetAuthorId: target.authorId,
      targetTitle: truncateByCodePoint(target.title, 80),
      reporterId,
      reason,
      detail,
    });

    const escalated = await this.maybeEscalate(targetType, targetId);
    if (escalated) created.escalated = true;

    // 结构化日志：没有后台复核界面时，这是"有人需要处理这条内容"的唯一告警出口。
    // 用 WARN（而不是 LOG）：它需要被值班的人看到，而不是沉在信息流里。
    // 日志里用**中文标签**而不是原始 key：这条日志是给值班的人直接看的，
    // `原因=fraud` 还得回去翻代码才知道是什么。
    this.logger.warn(
      `[moderation] 收到举报 ${targetType}/${targetId}「${truncateByCodePoint(target.title, 40)}」` +
        `原因=${REPORT_REASON_LABELS[reason]}` +
        (escalated ? ` ⚠️ 已达阈值 ${REPORT_ESCALATION_THRESHOLD} 人，需人工复核` : ''),
    );

    return toModel(created);
  }

  async listMine(reporterId: string, limit: number): Promise<ReportModel[]> {
    const rows = await this.repository.listByReporter(reporterId, limit);
    return rows.map(toModel);
  }

  /**
   * 阈值检查：达到就一次性给该对象的**全部**举报记录打标。
   *
   * 返回 `true` 表示"本次操作触发了升级"（只有第一次会返回 true，
   * 因为之后的记录已经是 escalated 了）。这样调用方就知道要不要告警，
   * 而不是每条举报都刷一遍 WARN。
   */
  private async maybeEscalate(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    const reporters = await this.repository.countDistinctReporters(targetType, targetId);
    if (reporters < REPORT_ESCALATION_THRESHOLD) return false;

    const updated = await this.repository.markEscalated(targetType, targetId);
    return updated > 0;
  }
}

/** Prisma 记录 → HTTP 响应形状（原因翻译成中文标签，客户端不必再维护一份映射） */
function toModel(record: {
  id: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  reason: string;
  detail: string | null;
  escalated: boolean;
  createdAt: Date;
}): ReportModel {
  const reason: ReportReason = isReportReason(record.reason) ? record.reason : 'other';
  return {
    id: record.id,
    targetType: record.targetType as ReportTargetType,
    targetId: record.targetId,
    targetTitle: record.targetTitle,
    reason,
    detail: record.detail,
    escalated: record.escalated,
    createdAt: record.createdAt,
  };
}
