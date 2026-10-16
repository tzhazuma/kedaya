/**
 * 数据保留策略登记表（契约 §9 数据最小化 / `05-security-privacy.md:473` 要求）
 *
 * ## 为什么需要一张"登记表"
 *
 * `05-security-privacy.md:473` 要求每张存个人信息的表都必须**显式登记保留期**，
 * 否则 CI 失败。这个要求的价值在于：保留期一旦只写在文档里，
 * 它就会在第一次重构时被忘掉 —— 而"忘了删"和"没打算删"在事故复盘里
 * 是完全不同的两件事。
 *
 * ## 当前状态（如实声明）
 *
 * 本文件是**新增**的：在此之前，本仓**不存在**任何 `retention-policy.ts`
 * （规格 §10 第 4 项把它列为需要 Lead 处理的跨作用域改动，但那个路径
 * `services/api/src/platform/retention/retention-policy.ts` 在本仓并不存在，
 * 本仓的合规层在 `src/common/compliance/`）。
 *
 * 因此这里做两件事，而不是假装它已经完成：
 *   1. 建立登记表与 `assertRetentionRegistered` 校验入口；
 *   2. **只登记 buddy 的三张表** —— 本模块的责任范围。
 *      其它模块的表**尚未登记**，这是已知缺口，需要各模块负责人补齐
 *      （补齐方式：往 `RETENTION_POLICY` 里加一行 + 一条测试）。
 *
 * ## 为什么不在本模块里自建一份
 *
 * 保留期是**跨模块的合规属性**，放在模块目录下会让"有没有登记"变成
 * 每个模块各自的私事 —— 那就等于没有登记表。
 */

/** 保留策略：与账号同生命周期，还是固定天数 */
export interface RetentionRule {
  /** 表名（Prisma `@@map` 的名字，与数据库里的表名一致） */
  table: string;
  /** 归属模块（契约 §4 的模块 id） */
  module: string;
  /**
   * 保留期。
   * - `'account-lifetime'`：与 `User` 同生命周期；账号注销后 30 天内硬删
   *   （对齐 `05-security-privacy.md:456`）
   * - 数字：固定天数
   */
  retention: 'account-lifetime' | number;
  /** 注销后多久硬删（天）。仅 `account-lifetime` 有意义 */
  purgeAfterDeletionDays?: number;
  /** 依据（文档行号或 ADR），便于审计追溯 */
  basis: string;
  /** 是否需要审计访问 */
  auditAccess: boolean;
}

/**
 * 登记表。
 *
 * ⚠️ **只有 buddy 已登记**。这不是"其它模块不需要登记"，
 * 而是"本模块只对自己负责"（跨作用域改动必须由对应负责人做，契约 §3）。
 */
export const RETENTION_POLICY: readonly RetentionRule[] = [
  {
    table: 'BuddyProfile',
    module: 'buddy',
    retention: 'account-lifetime',
    purgeAfterDeletionDays: 30,
    basis: 'docs/features/buddy-matching.md §6.3（与 User 同生命周期；注销后 30 天内硬删）',
    // 规格 §6.3：「审计：**不审计**（低敏感模块）。仅审计管理员的下架操作」
    auditAccess: false,
  },
  {
    table: 'BuddyMatchFeedback',
    module: 'buddy',
    retention: 'account-lifetime',
    purgeAfterDeletionDays: 30,
    basis: 'docs/features/buddy-matching.md §6.3（同上；反馈随账号生命周期）',
    auditAccess: false,
  },
  {
    table: 'BuddyQuestionnaireResponse',
    module: 'buddy',
    retention: 'account-lifetime',
    purgeAfterDeletionDays: 30,
    basis: 'docs/features/buddy-matching.md §6.3（同上；答案随账号生命周期）',
    auditAccess: false,
  },
];

const REGISTERED_TABLES = new Set(RETENTION_POLICY.map((rule) => rule.table));

/** 某张表是否已登记保留期 */
export function isRetentionRegistered(table: string): boolean {
  return REGISTERED_TABLES.has(table);
}

/**
 * 校验一组表全部已登记保留期。
 *
 * 这是"CI 失败"那条要求的落点：各模块的测试调用它，
 * 新增一张存个人信息的表却忘了登记时，测试会红。
 */
export function assertRetentionRegistered(tables: readonly string[]): void {
  const missing = tables.filter((table) => !isRetentionRegistered(table));
  if (missing.length > 0) {
    throw new Error(
      `以下表没有登记数据保留策略（05-security-privacy.md:473 要求）：${missing.join(', ')}。` +
        '请在 src/common/compliance/retention-policy.ts 的 RETENTION_POLICY 里补一行。',
    );
  }
}

/** 按模块取登记项（审计/巡检用） */
export function retentionForModule(moduleId: string): RetentionRule[] {
  return RETENTION_POLICY.filter((rule) => rule.module === moduleId);
}
