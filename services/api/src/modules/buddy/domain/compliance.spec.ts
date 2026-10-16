import { describe, expect, it } from 'vitest';
import {
  RETENTION_POLICY,
  assertRetentionRegistered,
  isRetentionRegistered,
  retentionForModule,
} from '../../../common/compliance/retention-policy';
import { FORBIDDEN_RESPONSE_FIELDS } from './views';
import { BUDDY_CONSTANTS } from '../buddy.controller';
import { CAMPUS_LOCATIONS, TAG_KEYS } from './tags';

/**
 * 跨模块与合规的**静态断言**（规格 §8.4 的 T29 / T31 能落地的那部分）
 *
 * ⚠️ 关于 T29 / T31 的诚实说明（写在测试里，而不是只写在交付说明里）：
 *
 * - **T31**（保留策略登记）：规格 §10 第 4 项指向
 *   `services/api/src/platform/retention/retention-policy.ts` —— **该路径在本仓不存在**
 *   （本仓合规层在 `src/common/compliance/`）。本次新建了
 *   `src/common/compliance/retention-policy.ts` 并登记 buddy 的三张表，
 *   本测试钉死"这三张表已登记"。其它模块的表尚未登记（已知缺口）。
 *
 * - **T29**（ai-portrait 禁读 buddy 三张表）：本仓的对应机制是
 *   `ai-portrait/domain/ai-portrait.domain.ts` 的 `FORBIDDEN_PORTRAIT_SOURCES`，
 *   它是**按模块 id**（`wellbeing` / `dorm-harmony`）而不是按表名禁读，
 *   且其内容被 `ai-portrait.service.spec.ts` 的断言钉死为恰好那两个。
 *   把 `buddy` 加进去会**改动另一个模块的语义并让它的测试变红** ——
 *   按契约 §3（跨作用域改动写进交付说明交给 Lead），本模块**不动它**。
 *   因此这里只断言"buddy 的三张表确实需要被禁读"这个事实本身，
 *   提醒 Lead 补进那张表。
 */
describe('保留策略登记（规格 §8.4 T31）', () => {
  it('buddy 的三张存个人信息的表已登记保留期', () => {
    expect(() =>
      assertRetentionRegistered(['BuddyProfile', 'BuddyMatchFeedback', 'BuddyQuestionnaireResponse']),
    ).not.toThrow();
  });

  it('每张表都是"与账号同生命周期 + 注销后 30 天硬删"（规格 §6.3）', () => {
    for (const table of ['BuddyProfile', 'BuddyMatchFeedback', 'BuddyQuestionnaireResponse']) {
      const rule = RETENTION_POLICY.find((item) => item.table === table);
      expect(rule, table).toBeDefined();
      expect(rule?.retention).toBe('account-lifetime');
      expect(rule?.purgeAfterDeletionDays).toBe(30);
      expect(rule?.module).toBe('buddy');
    }
  });

  it('低敏感模块**不审计**数据访问（规格 §6.3）', () => {
    for (const rule of retentionForModule('buddy')) {
      expect(rule.auditAccess).toBe(false);
    }
  });

  it('未登记的表会被 assertRetentionRegistered 拦下（这是"CI 失败"的落点）', () => {
    expect(isRetentionRegistered('SomeUnregisteredTable')).toBe(false);
    expect(() => assertRetentionRegistered(['SomeUnregisteredTable'])).toThrow(/没有登记数据保留策略/);
  });

  it('登记表里没有重复的表名（重复会让"以哪条为准"变成猜测）', () => {
    const tables = RETENTION_POLICY.map((rule) => rule.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe('ai-portrait 禁读域（规格 §8.4 T29 的已知缺口）', () => {
  it('buddy 的三张表属于"必须被 ai-portrait 禁读"的集合', () => {
    // 本模块**声明**这三张表不可进通用画像（规格 §6.3）。
    // 把它写进 ai-portrait 的 FORBIDDEN_PORTRAIT_SOURCES 是跨作用域改动，
    // 需要 Lead 处理 —— 见文件头。
    const buddySensitiveTables = ['BuddyProfile', 'BuddyMatchFeedback', 'BuddyQuestionnaireResponse'];
    expect(buddySensitiveTables).toHaveLength(3);
    // 反证：它们**不是**响应里可以出现的字段（否则就已经泄漏了）
    for (const table of buddySensitiveTables) {
      expect(FORBIDDEN_RESPONSE_FIELDS).not.toContain(table);
    }
  });
});

describe('契约 §11.2 的 5 个冻结 action 名（规格 §5.2）', () => {
  it('恰好是 join / leave / close / decide / feedback —— 不得自创', () => {
    expect(BUDDY_CONSTANTS.actions).toEqual(['join', 'leave', 'close', 'decide', 'feedback']);
  });

  it('刻意**没有** accept / reject（用一个 decide + body 表达，规格 §5.2）', () => {
    expect(BUDDY_CONSTANTS.actions).not.toContain('accept');
    expect(BUDDY_CONSTANTS.actions).not.toContain('reject');
  });

  it('刻意**没有** cancel —— CANCELLED 由 DELETE /items/:id 触发（动作名与状态名一一对应）', () => {
    expect(BUDDY_CONSTANTS.actions).not.toContain('cancel');
  });

  it('板块里没有 dating（规格 §1.3 明确不做）', () => {
    expect(BUDDY_CONSTANTS.sections).toEqual(['academic', 'daily', 'sport']);
  });
});

describe('封闭标签与地点白名单的规模约束（规格 §3.2 / U10）', () => {
  it('标签表非空且无重复', () => {
    expect(TAG_KEYS.length).toBeGreaterThan(20);
    expect(new Set(TAG_KEYS).size).toBe(TAG_KEYS.length);
  });

  it('校园地点白名单非空（U10 未决，但校验必须真的生效）', () => {
    expect(CAMPUS_LOCATIONS.length).toBeGreaterThan(5);
  });
});
