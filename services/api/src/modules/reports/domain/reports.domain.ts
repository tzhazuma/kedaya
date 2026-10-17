/**
 * 内容举报的领域约定（纯 TypeScript，零框架依赖）。
 *
 * ## 为什么这个模块必须存在
 *
 * 这是 **UGC 小程序的合规底线**：只要用户能发布内容，平台就必须提供
 * 「举报 / 投诉入口」并在收到后处理（微信小程序运营规范里对 UGC 的明确要求）。
 * 没有举报入口的二手交易 / 论坛类小程序，提审阶段大概率被驳回 ——
 * 而且这不是"为了过审走个形式"：没有举报，被骚扰的用户唯一的出路是卸载。
 *
 * ## 三条设计原则
 *
 * 1. **举报内容不直接下架**。
 *    自动下架 = 给任何人一个"三个人就能删掉你的帖子"的按钮。
 *    在没有人工复核流程的前提下，自动下架造成的伤害大于收益。
 *    因此这里做的是：**记录 + 去重 + 达到阈值就升级**（升级 = 打标 + 打日志告警），
 *    下架动作留在人工复核后（SQL 一条 UPDATE，见 `docs/deploy.md`）。
 * 2. **原因必须来自白名单**。
 *    自由文本无法聚合、无法统计、无法自动分流；
 *    而且举报人写的第一个词往往是情绪化的，直接入库对复核没有帮助。
 *    补充说明作为**可选**的 detail 附在原因之后。
 * 3. **不能举报自己**。
 *    自我举报没有治理意义，却会污染统计（有人会用它来测试或刷量）。
 */

import { truncateByCodePoint } from '../../../common/text/truncate';

/** 可被举报的对象类型（白名单；新增类型必须同时改客户端 `reportTargetTypes`） */
export const REPORT_TARGET_TYPES = [
  'flea-item',
  'errand-task',
  'buddy-group',
  'lost-found-item',
  'forum-post',
  'forum-reply',
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/**
 * 举报原因（白名单）。
 *
 * 顺序即客户端展示顺序：**最严重、最需要优先处理的放前面**
 * （违法违规 / 色情低俗 / 人身攻击），"其它"放最后。
 * 这决定了值班的人先看到什么。
 */
export const REPORT_REASONS = [
  'illegal',
  'porn',
  'harassment',
  'fraud',
  'privacy',
  'spam',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** 原因的中文标签（服务端也保留一份：日志与后续可能的复核界面都要用） */
export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  illegal: '违法违规内容',
  porn: '色情低俗',
  harassment: '侮辱谩骂 / 人身攻击',
  fraud: '诈骗或虚假交易',
  privacy: '泄露他人隐私',
  spam: '垃圾广告 / 刷屏',
  other: '其它',
};

export const REPORT_LIMITS = {
  /** 补充说明的长度上限（超长直接截断，不报错） */
  detail: 300,
  /** 同一举报人对同一对象只能有一条有效举报（见 ContentReport 的唯一索引） */
  reasonsPerReport: 1,
} as const;

/**
 * 升级阈值：同一对象被 **N 个不同的人** 举报后打上 `escalated` 标记。
 *
 * 为什么是"不同的人"：同一个人重复举报没有新信息，
 * 而"三个互不相识的人都觉得这条内容有问题"才是有意义的信号。
 * 为什么是 3：2 太容易被吵架双方凑齐，5 会让恶劣内容在队列里躺太久。
 * 这是**给人工复核用的排序信号**，不是自动下架 —— 阈值再高一点也不会出事，
 * 但值班的人需要知道"这条已经有三个人在骂了"。
 */
export const REPORT_ESCALATION_THRESHOLD = 3;

/** 归一化后的举报内容（可以安全落库） */
export interface NormalizedReport {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail: string | null;
}

export function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

/** 按码点截断（共用 `common/text/truncate.ts`，避免两处实现各切坏一次代理对） */
export function truncateReportDetail(text: string): string {
  return truncateByCodePoint(text, REPORT_LIMITS.detail);
}

export interface CreateReportInput {
  targetType: string;
  targetId: string;
  reason: string;
  detail?: string;
}

/** 举报落库后的形状（`GET /reports/mine` 返回它） */
export interface ReportModel {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  /** 举报时的内容标题快照 —— 内容之后被删掉也能看懂当初举报的是什么 */
  targetTitle: string;
  reason: ReportReason;
  detail: string | null;
  /** 是否已升级（阈值触发）；客户端据此显示「已加急」 */
  escalated: boolean;
  createdAt: Date;
}

/** 被举报对象的解析结果 */
export interface ReportTarget {
  /** 内容作者的 userId；匿名帖为 null */
  authorId: string | null;
  title: string;
}
